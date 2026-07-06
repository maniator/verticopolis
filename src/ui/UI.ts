import { ALL_KINDS, FACILITIES } from "../engine/facilities";
import type { Simulation, LogEntry, BatchTarget, BatchRentOptions, BatchRentResult } from "../engine/Simulation";
import { TOWER_FILE_EXT, type SlotInfo } from "../storage/SaveGame";
import type { FacilityCategory, FacilityKind, GameMode } from "../engine/types";
import { escapeHtml } from "./escape";
import type { UpdateInfo } from "../pwa";

export type Tool = { type: "build"; kind: FacilityKind } | { type: "bulldoze" } | { type: "inspect" };

/** Hard ceiling on rendered bulletin lines. The DOM node count is held CONSTANT
 *  at this — append the newest, prune the oldest — so scrollback is generous
 *  (~a session's worth) yet a long session can never grow the log big enough to
 *  jank a slow phone. Pair with the engine's log buffer cap ({@link Simulation}). */
const LOG_DOM_CAP = 300;

/** Most toasts kept on screen at once — and the most fired in a single render.
 *  A catch-up tick can flush a big batch; only the newest few pop (older ones
 *  would be pruned off-screen instantly anyway), so we never spawn a burst of
 *  transient nodes+timers on resume. */
const TOAST_MAX = 5;

const GROUPS: { title: string; cats: FacilityCategory[] }[] = [
  { title: "Structure", cats: ["structure"] },
  { title: "Transport", cats: ["transport"] },
  { title: "Commercial", cats: ["office", "retail", "food"] },
  { title: "Living", cats: ["residential", "hotel"] },
  { title: "Leisure", cats: ["entertainment"] },
  { title: "Services", cats: ["service"] },
  { title: "Special", cats: ["special"] },
];

export interface UICallbacks {
  onSelectTool(tool: Tool): void;
  onSpeed(speed: number): void;
  onSave(): void;
  onLoad(): void;
  onExport(): void;
  /** A picked file's text contents — a .vctower export (or a legacy raw-JSON one). */
  onImport(data: string): void;
  onImportLegacy(buffer: ArrayBuffer, filename: string): void;
  onNew(mode: GameMode): void;
  onToggleAudio(): boolean; // returns new muted state
  onUndo(): void;
  onRedo(): void;
  onEditAction(action: string, root: HTMLElement): void;
  /** Toggle reduced motion; returns the new effective state. */
  onToggleReducedMotion(): boolean;
  onReplayOnboarding(): void;
  onRenameTower(name: string): void;
  onShowStats(): void;
  /** Set the colored stats overlay to a mode by its select value ("congestion"
   *  / "occupancy" / "satisfaction", or "" for off). */
  onSetOverlay(mode: string): void;
  onShowSaves(): void;
  /** The inspector card's ✕ was clicked — dismiss it and latch it closed. */
  onInspectorClose(): void;
  onSaveSlot(slot: number): void;
  onLoadSlot(slot: number | "auto"): void;
  onDeleteSlot(slot: number): void;
}

/** Owns all DOM controls outside the canvas and keeps them in sync. */
export class UI {
  tool: Tool = { type: "inspect" };
  private cb: UICallbacks;
  private lastLogSeq = 0;
  private toastTimers: number[] = [];

  private el = {
    money: document.getElementById("stat-money")!,
    pop: document.getElementById("stat-pop")!,
    star: document.getElementById("stat-star")!,
    time: document.getElementById("stat-time")!,
    date: document.getElementById("stat-date")!,
    palette: document.getElementById("palette-scroll")!,
    toolInfo: document.getElementById("tool-info")!,
    towerStats: document.getElementById("tower-stats")!,
    log: document.getElementById("log")!,
    toast: document.getElementById("toast-wrap")!,
    inspector: document.getElementById("inspector")!,
    editor: document.getElementById("editor")!,
    modal: document.getElementById("modal")!,
    audioToggle: document.getElementById("audio-toggle")!,
    towerName: document.getElementById("tower-name") as HTMLInputElement,
  };

  constructor(cb: UICallbacks) {
    this.cb = cb;
    this.buildPalette();
    this.wireControls();
    this.selectTool({ type: "inspect" });
    // While the pointer is pressed inside the editor card, suppress the periodic
    // rebuild — otherwise a refresh landing between press and release would
    // replace the button mid-click and swallow it (the "+ rent sometimes does
    // nothing" bug). The container itself persists across innerHTML swaps.
    this.el.editor.addEventListener("pointerdown", () => (this.editorBusy = true));
    const release = () => (this.editorBusy = false);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
  }

  /** True while the user is pressing something inside the editor card. */
  private editorBusy = false;
  isEditorBusy(): boolean {
    return this.editorBusy;
  }

  private buildPalette(): void {
    const frag = document.createDocumentFragment();

    // Tools row (inspect + bulldoze).
    const toolsTitle = document.createElement("div");
    toolsTitle.className = "pal-group-title";
    toolsTitle.textContent = "Tools";
    frag.appendChild(toolsTitle);
    frag.appendChild(this.toolButton("inspect", "🔍 Inspect", "#9aa6bd"));
    frag.appendChild(this.toolButton("bulldoze", "🧨 Bulldoze", "#ff6b6b"));

    for (const group of GROUPS) {
      const title = document.createElement("div");
      title.className = "pal-group-title";
      title.textContent = group.title;
      frag.appendChild(title);
      for (const kind of ALL_KINDS) {
        const f = FACILITIES[kind];
        if (!group.cats.includes(f.category)) continue;
        frag.appendChild(this.facilityButton(kind));
      }
    }
    this.el.palette.appendChild(frag);
  }

  /** Make a palette div behave like a button for mouse AND keyboard users:
   * focusable, role=button, and activatable with Enter/Space (F48 — a
   * keyboard-only play path). */
  private makeActivatable(item: HTMLElement, label: string, onActivate: () => void): void {
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", label);
    item.addEventListener("click", onActivate);
    item.addEventListener("keydown", (e) => {
      if (e.repeat) return; // a held key must not fire repeatedly (native button semantics)
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        e.stopPropagation(); // don't also reach the global build-cursor handler
        onActivate();
      }
    });
  }

  private toolButton(type: "inspect" | "bulldoze", label: string, color: string): HTMLElement {
    const item = document.createElement("div");
    item.className = "pal-item";
    item.dataset.tool = type;
    item.innerHTML = `<span class="pal-swatch" style="background:${color}"></span><span class="pal-name">${label}</span>`;
    this.makeActivatable(item, label, () => this.selectTool({ type } as Tool));
    return item;
  }

  private facilityButton(kind: FacilityKind): HTMLElement {
    const f = FACILITIES[kind];
    const item = document.createElement("div");
    item.className = "pal-item";
    item.dataset.kind = kind;
    item.innerHTML =
      `<span class="pal-swatch" style="background:${f.color}"></span>` +
      `<span class="pal-name">${f.name}</span>` +
      `<span class="pal-cost">$${shortMoney(f.cost)}</span>`;
    this.makeActivatable(item, `${f.name}, $${shortMoney(f.cost)}`, () => {
      if (item.classList.contains("locked")) {
        this.toast(`${f.name} unlocks at ${f.minStar}★.`, "bad");
        return;
      }
      this.selectTool({ type: "build", kind });
    });
    return item;
  }

  private wireControls(): void {
    document.querySelectorAll<HTMLButtonElement>("#speed button[data-speed]").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#speed button[data-speed]").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        this.cb.onSpeed(Number(b.dataset.speed));
      });
    });

    this.el.audioToggle.addEventListener("click", () => {
      const muted = this.cb.onToggleAudio();
      this.el.audioToggle.textContent = muted ? "🔇" : "🔊";
    });
    document.getElementById("btn-undo")?.addEventListener("click", () => this.cb.onUndo());
    document.getElementById("btn-redo")?.addEventListener("click", () => this.cb.onRedo());

    document.getElementById("panel-toggle")?.addEventListener("click", () => {
      document.body.classList.toggle("panels-open");
    });
    const closePanels = () => document.body.classList.remove("panels-open");
    document.getElementById("panel-close")?.addEventListener("click", closePanels);
    document.getElementById("scrim")?.addEventListener("click", closePanels);

    document.getElementById("btn-save")!.addEventListener("click", () => this.cb.onSave());
    document.getElementById("btn-load")!.addEventListener("click", () => this.cb.onShowSaves());
    document.getElementById("btn-new")!.addEventListener("click", () => {
      // The toolbar always has a live tower to abandon, so the picker shows its
      // fold-in abandon warning; the mode choice and the confirm are one step.
      this.newTowerModal({ hasSave: true, onFound: (mode) => this.cb.onNew(mode) });
    });
    document.getElementById("btn-export")!.addEventListener("click", () => this.confirmExport());
    document.getElementById("btn-import")!.addEventListener("click", () => this.openImport());
    document.getElementById("btn-help")!.addEventListener("click", () => this.showHelp());
    document.getElementById("btn-stats")!.addEventListener("click", () => this.cb.onShowStats());
    document.getElementById("overlay-mode")?.addEventListener("change", (e) => {
      this.cb.onSetOverlay((e.currentTarget as HTMLSelectElement).value);
    });

    this.el.towerName.addEventListener("change", () => {
      this.cb.onRenameTower(this.el.towerName.value.trim() || "Tower One");
    });
  }

  // ---- Selected-facility editor -----------------------------------------

  /** Cached panel sizes so per-frame anchoring never reads layout (no thrash);
   *  re-measured only when the content changes. */
  private editorSize = { w: 0, h: 0 };
  private inspectorSize = { w: 0, h: 0 };
  /** The shape currently built into the editor card (see refreshEditor's key). */
  private editorKey: string | null = null;

  /** Render the editor for a selection. If its shape (`key`) is unchanged, only
   *  the volatile `data-field` cells are patched in place — the buttons and
   *  rename input keep their identity, so a refresh can never land mid-click and
   *  swallow it. A new shape does a full (re)build. */
  renderEditor(key: string, build: () => string, volatile: Record<string, string>): void {
    if (key !== this.editorKey) {
      this.showEditor(build());
      this.editorKey = key;
    } else {
      patchVolatile(this.el.editor, volatile);
    }
  }

  /** Show the editor card for a selected facility with type-specific actions. */
  showEditor(html: string): void {
    this.el.editor.innerHTML = html;
    this.el.editor.classList.remove("hidden");
    this.el.editor.querySelectorAll<HTMLElement>("[data-edit]").forEach((b) => {
      b.addEventListener("click", () => this.cb.onEditAction(b.dataset.edit!, this.el.editor));
    });
    this.el.editor.querySelector(".ed-close")?.addEventListener("click", () => this.hideEditor());
    this.editorSize = { w: this.el.editor.offsetWidth, h: this.el.editor.offsetHeight };
  }

  hideEditor(): void {
    this.el.editor.classList.add("hidden");
    this.el.editor.innerHTML = "";
    this.editorKey = null; // force a full rebuild when it's next opened
  }

  isEditorOpen(): boolean {
    return !this.el.editor.classList.contains("hidden");
  }

  isInspectorOpen(): boolean {
    return !this.el.inspector.classList.contains("hidden");
  }

  /** Anchor the editor card beside a facility's on-screen rect, preferring its
   *  right side, flipping left and clamping so it always stays on screen. */
  anchorEditor(rect: { x: number; y: number; w: number }, viewW: number, viewH: number): void {
    const { left, top } = anchorBeside(rect, this.editorSize, viewW, viewH);
    this.placePanel(this.el.editor, left, top);
  }

  /** Anchor the inspector tooltip just off a facility's corner, clamped. */
  anchorInspector(x: number, y: number, viewW: number, viewH: number): void {
    const { w, h } = this.inspectorSize;
    const gap = 8;
    const left = Math.max(gap, Math.min(x + 12, viewW - w - gap));
    const top = Math.max(gap, Math.min(y, viewH - h - gap));
    this.placePanel(this.el.inspector, left, top);
  }

  /** Drop the inline anchor so the panels fall back to their CSS-docked layout
   *  (used on mobile, where floating would fight the bottom palette strip). */
  clearPanelAnchors(): void {
    for (const el of [this.el.editor, this.el.inspector]) {
      el.style.left = el.style.top = el.style.right = el.style.bottom = "";
    }
  }

  private placePanel(el: HTMLElement, left: number, top: number): void {
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  showStats(html: string): void {
    const box = this.openModal(`<h2>Tower Statistics</h2>${html}
      <div class="modal-actions"><button class="btn primary" data-act="close">Close</button></div>`);
    this.wireActions(box);
  }

  /** Saves manager: auto-save + numbered slots, plus export/import. */
  showSaves(slots: SlotInfo[]): void {
    const fmtWhen = (ms?: number) =>
      ms ? new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";
    const row = (s: SlotInfo): string => {
      const name = s.slot === "auto" ? "Auto-save" : `Slot ${s.slot}`;
      const detail = s.exists
        ? `<div class="slot-detail">${escapeHtml(s.towerName ?? "Tower")} · ${s.star === 6 ? "TOWER" : (s.star ?? 1) + "★"} · pop ${(s.population ?? 0).toLocaleString()} · $${Math.round(s.funds ?? 0).toLocaleString()}<br><span class="slot-when">${fmtWhen(s.savedAt)}</span></div>`
        : `<div class="slot-detail slot-empty">empty</div>`;
      const saveBtn =
        s.slot === "auto" ? "" : `<button class="btn" data-save="${s.slot}">Save</button>`;
      const loadBtn = s.exists ? `<button class="btn" data-load="${s.slot}">Load</button>` : "";
      const delBtn =
        s.exists && s.slot !== "auto"
          ? `<button class="btn danger" data-del="${s.slot}" aria-label="Delete save slot ${s.slot}">✕</button>`
          : "";
      return `<div class="slot"><div class="slot-head"><b>${name}</b>${detail}</div><div class="slot-actions">${saveBtn}${loadBtn}${delBtn}</div></div>`;
    };
    const box = this.openModal(`
      <h2>Saved Towers</h2>
      <div class="slots well">${slots.map(row).join("")}</div>
      <div class="modal-actions">
        <button class="btn" data-act="export">Export to file</button>
        <button class="btn" data-act="import">Import from file</button>
        <button class="btn primary" data-act="close">Close</button>
      </div>`);
    box.querySelectorAll<HTMLElement>("[data-save]").forEach((b) =>
      b.addEventListener("click", () => {
        this.cb.onSaveSlot(Number(b.dataset.save));
        this.cb.onShowSaves();
      }),
    );
    box.querySelectorAll<HTMLElement>("[data-load]").forEach((b) =>
      b.addEventListener("click", () => {
        const v = b.dataset.load!;
        this.cb.onLoadSlot(v === "auto" ? "auto" : Number(v));
        this.closeModal();
      }),
    );
    box.querySelectorAll<HTMLElement>("[data-del]").forEach((b) =>
      b.addEventListener("click", () => {
        this.cb.onDeleteSlot(Number(b.dataset.del));
        this.cb.onShowSaves();
      }),
    );
    // Close the saves dialog first: <dialog>'s top layer paints over the toast
    // rail, so export feedback would be invisible behind the open modal — and
    // the confirm dialog / file picker replace it rather than stacking on it.
    this.wireActions(box, {
      export: () => {
        this.closeModal();
        this.confirmExport();
      },
      import: () => {
        this.closeModal();
        this.openImport();
      },
    });
  }

  setTowerName(name: string): void {
    if (document.activeElement !== this.el.towerName) this.el.towerName.value = name;
  }

  /** Per-floor stop configuration for an elevator (express service). */
  showStopsDialog(
    title: string,
    floors: { floor: number; stop: boolean; lobby: boolean }[],
    onToggle: (floor: number, stop: boolean) => void,
  ): void {
    const rowsHtml = floors
      .map((fl) => {
        const label = fl.floor > 0 ? `Floor ${fl.floor}` : `B${-fl.floor}`;
        const tag = fl.lobby ? ' <span class="stop-lobby">lobby</span>' : "";
        return `<label class="stop-row"><input type="checkbox" data-floor="${fl.floor}" ${fl.stop ? "checked" : ""}/> <span>${label}${tag}</span></label>`;
      })
      .join("");
    const box = this.openModal(`
      <h2>${escapeHtml(title)} — Stops</h2>
      <p style="color:var(--muted);font-size:12px">Untick a floor to make the car skip it (express service). The top and bottom stay connected.</p>
      <div class="stop-list well">${rowsHtml}</div>
      <div class="modal-actions"><button class="btn primary" data-act="close">Done</button></div>`);
    box.querySelectorAll<HTMLInputElement>("input[data-floor]").forEach((cb) => {
      cb.addEventListener("change", () => onToggle(Number(cb.dataset.floor), cb.checked));
    });
    this.wireActions(box);
  }

  selectTool(tool: Tool): void {
    this.tool = tool;
    this.cb.onSelectTool(tool);
    document.querySelectorAll(".pal-item").forEach((x) => x.classList.remove("active"));
    if (tool.type === "build") {
      document.querySelector(`.pal-item[data-kind="${tool.kind}"]`)?.classList.add("active");
      const f = FACILITIES[tool.kind];
      this.el.toolInfo.innerHTML =
        `<div class="ti-name">${f.name}</div>` +
        `<div>Cost: $${f.cost.toLocaleString()}</div>` +
        (f.population ? `<div>Capacity: ${f.population}</div>` : "") +
        `<p style="margin-top:6px;color:var(--muted)">${f.description}</p>`;
    } else {
      document.querySelector(`.pal-item[data-tool="${tool.type}"]`)?.classList.add("active");
      this.el.toolInfo.innerHTML =
        tool.type === "bulldoze"
          ? "<div class='ti-name'>Bulldoze</div><p style='color:var(--muted)'>Click a room or shaft to sell it for half its cost.</p>"
          : "<div class='ti-name'>Inspect</div><p style='color:var(--muted)'>Hover the tower to read a facility's status.</p>";
    }
  }

  /** Refresh status bar, palette locks, tower stats and the bulletin log. */
  update(sim: Simulation): void {
    this.el.money.textContent = `$${Math.round(sim.money).toLocaleString()}`;
    this.el.money.style.color = sim.money < 0 ? "var(--bad)" : "var(--money)";
    this.el.pop.textContent = sim.population.toLocaleString();
    this.el.star.textContent = sim.star >= 6 ? "TOWER" : "★".repeat(sim.star) + "☆".repeat(5 - sim.star);
    this.el.time.textContent = sim.clock.format();
    this.el.date.textContent = sim.clock.formatRetroDate();

    // Palette unlock state.
    document.querySelectorAll<HTMLElement>(".pal-item[data-kind]").forEach((item) => {
      const kind = item.dataset.kind as FacilityKind;
      const locked = !sim.isUnlocked(kind);
      const affordable = sim.money >= FACILITIES[kind].cost;
      // Dimming lives entirely in CSS (.locked / .unaffordable) so there's a
      // single source of truth for the styling.
      item.classList.toggle("locked", locked);
      item.classList.toggle("unaffordable", !locked && !affordable);
    });

    this.setTowerName(sim.tower.towerName);

    const s = sim.stats();
    this.el.towerStats.innerHTML = `
      <span class="k">Floors</span><span class="v">${s.floors} / B${s.basements}</span>
      <span class="k">Offices</span><span class="v">${s.occupiedOffices}/${s.offices}</span>
      <span class="k">Condos sold</span><span class="v">${s.soldCondos}/${s.condos}</span>
      <span class="k">Hotel (in use)</span><span class="v">${s.occupiedHotel}/${s.hotelRooms}</span>
      <span class="k">Rooms to clean</span><span class="v" style="color:${s.dirty ? "var(--bad)" : "inherit"}">${s.dirty}</span>
      <span class="k">Shops / Food</span><span class="v">${s.shops} / ${s.restaurants}</span>
      <span class="k">Transports</span><span class="v">${s.transports}</span>
      <span class="k">Vacancies</span><span class="v">${s.vacant}</span>`;

    this.renderLog(sim.log, sim.logSeq);
  }

  private renderLog(log: LogEntry[], logSeq: number): void {
    if (logSeq === this.lastLogSeq) return;
    // Count new entries by the monotonic logSeq, NOT log.length: the engine caps
    // the log (push+shift), so length stops changing while entries keep flowing —
    // diffing on length froze this pump (and every toast) after the cap. Clamp to
    // what's still in the buffer: anything older was shifted out.
    const fresh = Math.min(logSeq - this.lastLogSeq, log.length);
    this.lastLogSeq = logSeq;
    if (fresh <= 0) return;
    // slice(length - fresh), never slice(-fresh): a fresh of 0 would make -0 → 0
    // and re-render the WHOLE buffer (the guard above already covers it, but this
    // keeps the slice honest regardless).
    const batch = log.slice(log.length - fresh);
    // Toast only the most-recent good/bad lines of the batch. A catch-up tick
    // (fast-forward / backgrounded tab) can flush a big batch at once; toast()
    // already keeps ≤ TOAST_MAX on screen, so firing one per line would spawn
    // hundreds of transient nodes+timers just to prune them. The bulletin below
    // still records EVERY line for scrollback.
    const toastAt = new Set(
      batch.flatMap((e, i) => (e.kind === "good" || e.kind === "bad" ? [i] : [])).slice(-TOAST_MAX),
    );
    batch.forEach((e, i) => {
      // Append the bulletin line FIRST — it's the durable record; a throwing
      // toast() must never drop it or stall the rest of the batch.
      this.el.log.appendChild(this.logLine(e)); // column-reverse ⇒ newest lands on top
      if (toastAt.has(i)) {
        try {
          this.toast(e.text, e.kind);
        } catch {
          /* a toast failure is cosmetic — never let it interrupt the pump */
        }
      }
    });
    // APPEND + PRUNE, never rebuild: the bulletin keeps accepting new lines
    // forever (it never freezes at the cap — the whole bug) while the DOM node
    // count stays CONSTANT, so a long session can't grow it big enough to jank a
    // slow phone. Oldest is the first child under column-reverse.
    while (this.el.log.childElementCount > LOG_DOM_CAP) this.el.log.firstElementChild!.remove();
  }

  /** One bulletin line. `textContent` auto-escapes — never interpolate engine
   *  text into innerHTML (the old renderLog leaned on escapeHtml for this). */
  private logLine(e: LogEntry): HTMLDivElement {
    const d = document.createElement("div");
    d.className = `log-line ${e.kind}`;
    d.textContent = e.text;
    return d;
  }

  /** Adopt a freshly-swapped tower's log baseline (load / import / new / undo /
   *  redo): take its logSeq so we neither replay its old entries as toasts nor
   *  skip its next one against a stale cursor, and rebuild the (bounded) bulletin. */
  resetLog(sim: Simulation): void {
    this.lastLogSeq = sim.logSeq;
    this.el.log.replaceChildren(...sim.log.slice(-LOG_DOM_CAP).map((e) => this.logLine(e)));
  }

  showInspector(html: string | null): void {
    if (!html) {
      this.el.inspector.classList.add("hidden");
      return;
    }
    this.el.inspector.classList.remove("hidden");
    this.el.inspector.innerHTML = html;
    // ✕ in the title strip (shown on mobile only, via CSS): the docked card has
    // no hover-away to dismiss it there. The card itself stays click-through.
    // Routed through the app so it can latch the dismissal — otherwise the
    // very next hover pick over the same facility re-opens the card.
    const h4 = this.el.inspector.querySelector("h4");
    h4?.appendChild(this.titleBarClose("insp-close btn xs", () => this.cb.onInspectorClose()));
    this.inspectorSize = { w: this.el.inspector.offsetWidth, h: this.el.inspector.offsetHeight };
  }

  toast(text: string, kind: LogEntry["kind"] = "info"): void {
    const t = document.createElement("div");
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toast.appendChild(t);
    const timer = window.setTimeout(() => {
      t.style.transition = "opacity .3s";
      t.style.opacity = "0";
      window.setTimeout(() => t.remove(), 300);
    }, 3600);
    this.toastTimers.push(timer);
    while (this.el.toast.children.length > TOAST_MAX) this.el.toast.firstElementChild?.remove();
  }

  /** Batch-pricing dialog, pre-scoped to one priced kind. Live honest preview
   *  (same engine core as apply); Apply is disabled at zero changes. */
  showBatchPricingDialog(
    ctx: { kind: FacilityKind; kindLabel: string; band: { default: number; min: number; max: number; step: number } },
    cb: {
      preview: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
      apply: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
      onApplied: (summary: string) => void;
    },
  ): void {
    const { kind, band } = ctx;
    const noun = ctx.kindLabel.toLowerCase() + "s";
    const priceWord = kind === "condo" ? "price" : "rent";
    const money = (n: number) => `$${n.toLocaleString()}`;
    const box = this.openModal(`
      <h2>Set all ${noun}</h2>
      <div class="batch-modes">
        <label><input type="radio" name="bp-mode" value="set" checked /> Set ${priceWord} to</label>
        <span class="bp-amount"><button type="button" class="btn" data-bp="dec" aria-label="decrease">–</button>
          <input id="bp-price" class="field" type="number" inputmode="numeric" value="${band.default}" min="${band.min}" max="${band.max}" step="${band.step}" />
          <button type="button" class="btn" data-bp="inc" aria-label="increase">+</button></span>
        <div class="bp-band">Range ${money(band.min)}–${money(band.max)}</div>
        <label><input type="radio" name="bp-mode" value="default" /> Reset to default (${money(band.default)})</label>
      </div>
      <label class="bp-only"><input id="bp-only" type="checkbox" /> Only ${noun} still on the default price</label>
      <p id="bp-preview" class="bp-preview" aria-live="polite"></p>
      <div class="modal-actions">
        <button class="btn primary" id="bp-apply" data-act="apply">Apply</button>
        <button class="btn" data-act="close">Cancel</button>
      </div>`);
    const priceEl = box.querySelector<HTMLInputElement>("#bp-price")!;
    const onlyEl = box.querySelector<HTMLInputElement>("#bp-only")!;
    const previewEl = box.querySelector<HTMLElement>("#bp-preview")!;
    const applyBtn = box.querySelector<HTMLButtonElement>("#bp-apply")!;
    const mode = () => box.querySelector<HTMLInputElement>('input[name="bp-mode"]:checked')!.value;
    // Snap a typed price to the band's step grid, so batch matches the ± adjuster's
    // granularity (a typed 12,345 becomes 12,000 for a $1,000-step office).
    const snap = (v: number) => {
      const stepped = Math.round((v - band.min) / band.step) * band.step + band.min;
      return Math.max(band.min, Math.min(band.max, stepped));
    };
    const target = (): BatchTarget => (mode() === "default" ? "default" : snap(Number(priceEl.value) || 0));
    const opts = (): BatchRentOptions => ({ onlyDefaultPriced: onlyEl.checked });
    const priceText = (t: BatchTarget) => (t === "default" ? `the default (${money(band.default)})` : money(t as number));

    let resetArmed = false; // bulk "Reset to default" needs a confirming second click
    const refresh = () => {
      priceEl.disabled = mode() === "default";
      resetArmed = false;
      applyBtn.textContent = "Apply";
      const r = cb.preview(target(), opts());
      let msg = `Set ${r.changed} of ${r.matched} ${noun} to ${priceText(target())}.`;
      if (r.skippedCustom) msg += ` ${r.skippedCustom} custom-priced left as-is.`;
      if (r.customOverwritten) msg += ` ${r.customOverwritten} custom price${r.customOverwritten === 1 ? "" : "s"} will be overwritten.`;
      if (r.skippedSold) msg += ` ${r.skippedSold} sold skipped.`;
      if (r.clampedHigh) msg += ` Clamped to the ${money(band.max)} max.`;
      if (r.clampedLow) msg += ` Clamped to the ${money(band.min)} min.`;
      previewEl.textContent = msg;
      applyBtn.disabled = r.changed === 0;
    };
    const step = (dir: 1 | -1) => {
      priceEl.value = String(Math.max(band.min, Math.min(band.max, (Number(priceEl.value) || 0) + dir * band.step)));
      refresh();
    };
    box.querySelector('[data-bp="inc"]')!.addEventListener("click", () => step(1));
    box.querySelector('[data-bp="dec"]')!.addEventListener("click", () => step(-1));
    priceEl.addEventListener("input", refresh);
    // On commit (blur/Enter), normalize the field to the snapped value it will
    // actually apply, so the input never shows a number different from the result.
    priceEl.addEventListener("change", () => {
      if (mode() !== "default") priceEl.value = String(snap(Number(priceEl.value) || 0));
      refresh();
    });
    onlyEl.addEventListener("change", refresh);
    box.querySelectorAll('input[name="bp-mode"]').forEach((el) => el.addEventListener("change", refresh));
    this.wireActions(box);
    applyBtn.addEventListener("click", () => {
      // A bulk reset clears everyone's custom price — require a confirming click.
      if (mode() === "default" && !resetArmed) {
        resetArmed = true;
        applyBtn.textContent = "Confirm reset";
        return;
      }
      const r = cb.apply(target(), opts());
      cb.onApplied(`Set ${r.changed} ${noun} to ${priceText(target())}.`);
      this.closeModal();
    });
    refresh();
  }

  // ---- Modals ------------------------------------------------------------

  private openModal(html: string): HTMLElement {
    const dialog = this.el.modal as HTMLDialogElement;
    dialog.innerHTML = `<div class="modal-box win">${html}</div>`;
    const box = dialog.firstElementChild as HTMLElement;
    // Every dialog's TOP-LEVEL h2 is the window title bar; classing it here
    // keeps the rule in one place instead of in every caller's template.
    // :scope > h2 so an h2 nested in body content is never skinned.
    const h2 = box.querySelector(":scope > h2");
    h2?.classList.add("win-title");
    if (!dialog.open) dialog.showModal();
    // Win-style ✕ in the title bar (same affordance as the editor card) so
    // long dialogs can be dismissed without scrolling to the bottom button.
    // It routes through the dialog's cancel path (same as Esc) rather than
    // closeModal() directly, so modals that override oncancel to resolve a
    // pending choice (e.g. the emergency modal) still resolve. Appended AFTER
    // showModal(): it must not be the first focusable element, or keyboard
    // users would land on ✕ and Enter would dismiss (declining emergencies)
    // instead of activating the primary action.
    if (h2) {
      // cancelable, like the native Esc-key cancel event, so an oncancel
      // handler could preventDefault() it without behaving differently here.
      h2.appendChild(
        this.titleBarClose("modal-x btn xs", () => dialog.dispatchEvent(new Event("cancel", { cancelable: true }))),
      );
    }
    // Click outside the box (on the backdrop) closes the dialog.
    dialog.onclick = (e) => {
      if (e.target === dialog) this.closeModal();
    };
    dialog.oncancel = () => this.closeModal(); // Esc key
    return box;
  }
  closeModal(): void {
    const dialog = this.el.modal as HTMLDialogElement;
    if (dialog.open) dialog.close();
    dialog.innerHTML = "";
  }

  /** Bind click handlers to a dialog's [data-act] buttons. Every lookup is
   *  loud (non-null) so a template typo throws at open instead of shipping a
   *  dead button — including the default close binding. Dialogs that render
   *  no close button (confirm, emergency) disable it via opts.close: false. */
  private wireActions(box: HTMLElement, handlers: Record<string, () => void> = {}, opts: { close?: boolean } = {}): void {
    if (opts.close !== false && !("close" in handlers)) {
      box.querySelector('[data-act="close"]')!.addEventListener("click", () => this.closeModal());
    }
    for (const [act, fn] of Object.entries(handlers)) {
      box.querySelector(`[data-act="${act}"]`)!.addEventListener("click", fn);
    }
  }

  /** The one way to build a title-bar ✕ (see docs/design-system.md): every
   * dismissible window's close button comes from here so they can't drift. */
  private titleBarClose(className: string, onClick: () => void): HTMLButtonElement {
    const x = document.createElement("button");
    x.type = "button";
    x.className = className;
    x.setAttribute("aria-label", "Close");
    x.textContent = "✕";
    x.addEventListener("click", onClick);
    return x;
  }

  confirmModal(title: string, body: string, onYes: () => void, yesLabel = "Confirm"): void {
    const box = this.openModal(
      `<h2>${title}</h2><p>${body}</p>
       <div class="modal-actions"><button class="btn" data-act="no">Cancel</button><button class="btn primary" data-act="yes">${yesLabel}</button></div>`,
    );
    this.wireActions(
      box,
      {
        no: () => this.closeModal(),
        yes: () => {
          this.closeModal();
          onYes();
        },
      },
      // No [data-act="close"] button in this template to bind — the title-bar
      // ✕ still exists and closes through the dialog's cancel path.
      { close: false },
    );
  }

  /**
   * The New Tower rule-set picker. The mode is founded here and is PERMANENT for
   * the tower's life (never a settings toggle), so the card says so plainly —
   * the one contract we must never break is that a chosen mode can't drift. When
   * a readable tower already exists, the abandon warning folds into this same
   * dialog so founding is a single, honest confirmation. `onFound` fires only
   * once the player commits; the caller does the actual swap.
   */
  newTowerModal(opts: { hasSave: boolean; onFound: (mode: GameMode) => void }): void {
    const abandon = opts.hasSave
      ? `<p class="nt-abandon">⚠️ This abandons your current tower (it is not auto-saved).</p>`
      : "";
    const box = this.openModal(
      `<h2>Found a New Tower</h2>
       <p class="nt-lede">Choose your rule-set. This is set once and <b>cannot be changed</b> for this tower — start another to play the other way.</p>
       <div class="nt-modes">
         <label class="nt-mode">
           <input type="radio" name="nt-mode" value="classic" checked />
           <span class="nt-mode-body">
             <span class="nt-mode-name">Classic <span class="nt-badge">1994</span></span>
             <span class="nt-mode-desc">Pixel-faithful SimTower. Every condo houses a family of 3 and sells at 2×–2.5× its build cost; lose an owner to neglect and you buy the condo back at full price.</span>
           </span>
         </label>
         <label class="nt-mode">
           <input type="radio" name="nt-mode" value="modern" />
           <span class="nt-mode-body">
             <span class="nt-mode-name">Modern <span class="nt-badge alt">new</span></span>
             <span class="nt-mode-desc">Everything in Classic, plus features the original couldn't do:</span>
             <span class="nt-feature"><b>Variant households</b> — a condo draws a 2–5 person family. Bigger families pay more but lean harder on your elevators, so each sale is a real bet.</span>
           </span>
         </label>
       </div>
       ${abandon}
       <div class="modal-actions">
         <button class="btn" data-act="cancel">Cancel</button>
         <button class="btn primary" data-act="found">Found Tower</button>
       </div>`,
    );
    this.wireActions(
      box,
      {
        cancel: () => this.closeModal(),
        found: () => {
          const picked = box.querySelector<HTMLInputElement>('input[name="nt-mode"]:checked')?.value;
          const mode: GameMode = picked === "modern" ? "modern" : "classic";
          this.closeModal();
          opts.onFound(mode);
        },
      },
      { close: false },
    );
  }

  /** Export is deliberately two-step: the tower is not serialized, packed, or
   *  downloaded until the player actually clicks Export in this dialog. */
  private confirmExport(): void {
    this.confirmModal(
      "Export tower?",
      `Your tower will be packed into a <b>${TOWER_FILE_EXT}</b> file and downloaded.`,
      () => this.cb.onExport(),
      "Export",
    );
  }

  /** Hand the player a file download (the export path). Pure DOM plumbing:
   *  callers decide the name and contents (see SaveGame.export). */
  downloadFile(filename: string, contents: string): void {
    // octet-stream (not application/json — the payload isn't) so the browser
    // downloads our made-up .vctower type instead of trying to display it.
    const blob = new Blob([contents], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    // Revoking in the same task can abort the download on engines that fetch
    // the blob URL asynchronously (Safari/Firefox) — and this is the ONLY way
    // to get a tower out now. Give the navigation a generous head start.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Import goes straight to the file picker — exports are .vctower downloads
   *  now, so there is deliberately no paste-a-save textarea anymore. */
  private openImport(): void {
    const input = document.getElementById("import-file") as HTMLInputElement;
    // Single source of truth for our own extension (TOWER_FILE_EXT); the
    // octet-stream entry keeps .vctower selectable on pickers that filter by
    // MIME type and drop extensions they can't map (Android). Content is
    // validated on load either way.
    input.accept = `${TOWER_FILE_EXT},application/octet-stream,.json,application/json,.twr,.TWR`;
    input.value = "";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      // A file that vanishes or errors mid-read must not fail silently — the
      // launching dialog is already gone by the time the read runs.
      reader.onerror = () => this.toast("Couldn't read that file — please try again.", "bad");
      // Binary .TWR legacy saves are read as bytes; tower files as text.
      if (/\.twr$/i.test(file.name)) {
        reader.onload = () => this.cb.onImportLegacy(reader.result as ArrayBuffer, file.name);
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = () => this.cb.onImport(String(reader.result));
        reader.readAsText(file);
      }
    };
    input.click();
  }

  showHelp(): void {
    // Replaying the intro is meaningless while the title screen is still up (the
    // handler no-ops behind #splash), so disable that button there.
    const onSplash = !!document.getElementById("splash");
    const replayAttr = onSplash ? ' disabled title="Start a tower first, then you can replay the intro."' : "";
    const box = this.openModal(`
      <h2>How to play</h2>
      <p>Build a thriving high-rise and earn your way to a coveted <b>TOWER</b> rating.</p>
      <ul>
        <li><b>Floors first.</b> Lay <b>Floor</b> tiles, then place rooms on them.</li>
        <li><b>Move people.</b> Every floor needs an <b>elevator</b> or <b>stairs</b> chain back to the ground lobby, or tenants leave.</li>
        <li><b>Make money.</b> Offices pay quarterly rent, condos sell once, hotels earn nightly, shops &amp; restaurants earn from foot traffic.</li>
        <li><b>Grow your rating.</b> 2★ at 300 pop, 3★ at 1,000 (needs Security), 4★ at 5,000 (needs Medical, enough Recycling, suites &amp; a VIP), 5★ at 10,000 (needs a Metro).</li>
        <li><b>Take out the trash.</b> One <b>Recycling Center</b> processes ~2,500 population — it visibly fills through the day and a garbage truck empties it each morning. Outgrow your centers and 4★ locks until you build more.</li>
        <li><b>Win.</b> At 5★ with a Metro station, build the <b>Wedding Hall</b> on floor 100 and pass the VIP inspection — the <b>TOWER</b> rank needs 15,000 occupants (office workers + residents).</li>
        <li><b>Two rides, tops.</b> People take at most <b>two</b> elevator/stair rides to reach a floor — add <b>sky lobbies</b> (every ~15 floors) so distant floors are one transfer away, or nobody comes.</li>
        <li><b>Parking</b> spaces only work when they touch a <b>Parking Ramp</b> or a connected space — chain them off a ramp, or they sit empty. Offices want a space per ~12 workers from 3★, and every hotel suite needs one of its own (the VIP drives).</li>
        <li><b>Book the films.</b> Cinemas book a film monthly — a <b>Blockbuster</b> costs twice as much but pulls a far bigger crowd (great in a busy tower, a money-loser in a quiet one). Leave it on <b>Auto</b> or set a policy on the cinema.</li>
        <li><b>Price in bulk.</b> Inspect any office, condo or hotel room and use <b>“Set all …”</b> to re-price every unit of that kind at once (or reset them to the default) — no need to edit each room. A preview shows how many change before you apply.</li>
        <li><b>Rule-set (Classic vs Modern).</b> You pick this when you <b>found a tower</b>, and it's fixed for that tower's life. <b>Classic</b> is the faithful 1994 game: every condo is a family of 3, sells at 2×–2.5× its build cost, and an owner lost to neglect costs you a full-price buy-back. <b>Modern</b> adds <b>variant households</b> — a condo draws a 2–5 person family that sets its sale price and how demanding it is (a big family pays more but bails sooner if the elevators can't cope). Want the other rule-set? Start a new tower — and if there's a "what the original couldn't do" behavior Modern doesn't have yet, suggest it below.</li>
      </ul>
      <p style="color:var(--muted)">Mouse: drag to pan, scroll to zoom, click to build, Inspect tool to edit a room. Made a mistake? <b>Undo with Ctrl+Z</b> (or the ↩ button) — redo with Ctrl+Shift+Z. Music changes with whatever part of the tower you're viewing — try scrolling around!</p>
      <h3>Keyboard play</h3>
      <p style="color:var(--muted)">Play entirely without a mouse — pick a tool in the palette (Tab to it, Enter to select), then:</p>
      <ul class="help-keys">
        <li><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> (or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>) move the build cursor — hold <kbd>Shift</kbd> for ×10</li>
        <li><kbd>Enter</kbd> / <kbd>Space</kbd> build (or inspect) at the cursor. For an elevator or stairway, press once to anchor and again at the far end to size the shaft</li>
        <li><kbd>Delete</kbd> / <kbd>Backspace</kbd> / <kbd>X</kbd> bulldoze at the cursor · <kbd>Esc</kbd> cancel</li>
        <li><kbd>+</kbd> / <kbd>−</kbd> zoom · <kbd>C</kbd> re-center · <kbd>0</kbd>–<kbd>3</kbd> game speed · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</li>
      </ul>
      <h3>Found a bug? Have an idea?</h3>
      <p style="color:var(--muted)">Help us improve Verticopolis — report a bug, request a feature, or flag anything that doesn't match the 1994 original.</p>
      <p class="help-report"><a class="btn" target="_blank" rel="noopener noreferrer" href="https://github.com/maniator/verticopolis/issues/new/choose">Let us know…<span class="visually-hidden"> (opens GitHub in a new tab)</span></a></p>
      <h3>About</h3>
      <p style="color:var(--muted)">An unofficial, from-scratch homage to SimTower (1994). Original code and art — no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.<br>Verticopolis v${escapeHtml(typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev")}</p>
      <div class="modal-actions"><button class="btn" data-act="reduce-motion"></button><button class="btn" data-act="replay-onboard"${replayAttr}>Replay Getting Started</button><button class="btn primary" data-act="close" autofocus>Got it</button></div>
    `);
    const rm = box.querySelector<HTMLButtonElement>('[data-act="reduce-motion"]')!;
    // When the OS forces reduced motion on, the user pref can't override it — show
    // it as on-by-system and disable the toggle (so it isn't a silent no-op).
    const osForced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const label = (on: boolean) => {
      rm.textContent = `Reduced motion: ${on ? "On" : "Off"}${osForced ? " (system)" : ""}`;
      rm.setAttribute("aria-pressed", String(on));
    };
    rm.disabled = osForced;
    label(document.documentElement.classList.contains("reduce-motion"));
    rm.addEventListener("click", () => label(this.cb.onToggleReducedMotion()));
    this.wireActions(box);
    // Only wire replay when it can actually run (not while the splash is up).
    if (!onSplash) {
      box.querySelector('[data-act="replay-onboard"]')!.addEventListener("click", () => this.cb.onReplayOnboarding());
    }
  }

  /** A two-choice emergency modal (fire rescue / bomb ransom). Calls `onResolve`
   * with the player's pick. */
  showEventChoice(message: string, costLabel: string, onResolve: (opt: "accept" | "decline") => void): void {
    const box = this.openModal(`
      <h2>⚠️ Emergency</h2>
      <p>${message}</p>
      <div class="modal-actions">
        <button class="btn primary" data-act="accept">Pay ${costLabel}</button>
        <button class="btn" data-act="decline">Decline</button>
      </div>
    `);
    const dialog = this.el.modal as HTMLDialogElement;
    // The choice MUST resolve exactly once, no matter how the modal closes —
    // buttons, Esc, or a backdrop click — or the sim (frozen while a choice is
    // open) would deadlock. Dismissing counts as declining.
    let done = false;
    const finish = (opt: "accept" | "decline") => {
      if (done) return;
      done = true;
      this.closeModal();
      onResolve(opt);
    };
    this.wireActions(box, { accept: () => finish("accept"), decline: () => finish("decline") }, { close: false });
    dialog.onclick = (e) => { if (e.target === dialog) finish("decline"); }; // backdrop
    dialog.oncancel = () => finish("decline"); // Esc
  }

  /** True while any modal is on screen (the shared `<dialog>` is open). Callers
   *  use this to avoid opening a second modal, which would wipe the first's DOM
   *  and its pending handlers. */
  isModalOpen(): boolean {
    return (this.el.modal as HTMLDialogElement).open;
  }

  /**
   * "A new build is ready" prompt. `onUpdateNow` saves and reloads onto the new
   * assets; `onLater` defers (the build applies on the next reload). Dismissing
   * by Esc, the ✕, or a backdrop click all count as "Later" — the safe choice —
   * and, like the emergency modal, the outcome fires exactly once no matter how
   * the modal closes.
   *
   * `info` (optional) describes the incoming build: a muted "Build …" caption is
   * shown when a version/sha is known, and up to three player-facing `notes`
   * render as a compact "What's new" list. Both degrade to nothing when absent —
   * most builds ship with no notes, and silence is the correct empty state.
   */
  showUpdatePrompt(
    onUpdateNow: () => void | Promise<void>,
    onLater: () => void | Promise<void>,
    info?: UpdateInfo | null,
  ): void {
    const notes = (info?.notes ?? []).slice(0, 3);
    // Wrap the heading + list so the `.win-title.sm` strip is a GRANDCHILD of
    // `.modal-box.win` — a direct child would inherit the dialog title bar's
    // full-bleed (`.win > .win-title`) and sticky (`.modal-box > .win-title`)
    // treatment and overlap the body text. Same nesting the Statistics dialog
    // uses for its section strips.
    const notesBlock = notes.length
      ? `<div class="whatsnew"><h3 class="win-title sm">What's new</h3><ul>${notes
          .map((n) => `<li>${escapeHtml(n)}</li>`)
          .join("")}</ul></div>`
      : "";
    // Keep a real sha (it anchors a bug report to an exact build) but drop the
    // "unknown" placeholder a non-git build would stamp, so players never see
    // "Build 1.1.1 · unknown".
    const sha = info?.sha && info.sha !== "unknown" ? info.sha : undefined;
    const idText = [info?.version, sha].filter(Boolean).map((s) => escapeHtml(s!)).join(" · ");
    const buildLine = idText ? `<p class="build-id">Build ${idText}</p>` : "";
    const box = this.openModal(`
      <h2>Update available</h2>
      <p>A newer version of Verticopolis is ready. Update now saves your tower and reloads onto it — you won't lose any progress.</p>
      <p>Or keep playing: it'll apply next time you reopen.</p>
      ${notesBlock}
      ${buildLine}
      <div class="modal-actions">
        <button class="btn" data-act="later">Later</button>
        <button class="btn primary" data-act="update">Update now</button>
      </div>
    `);
    const dialog = this.el.modal as HTMLDialogElement;
    let done = false;
    // The handlers may be async (Update now saves then reloads); we invoke them
    // fire-and-forget — the modal is already closing and there's nothing here to
    // await. Route through Promise.resolve().then(...).catch(...) so that BOTH a
    // synchronous throw and a rejected promise are contained here instead of
    // escaping as an `unhandledrejection` on the window. (The handlers already
    // guard their own failures; this is a belt-and-suspenders safety net.)
    const fireAndForget = (cb: () => void | Promise<void>) => {
      void Promise.resolve()
        .then(cb)
        .catch(() => {});
    };
    const later = () => {
      if (done) return;
      done = true;
      this.closeModal();
      fireAndForget(onLater);
    };
    const update = () => {
      if (done) return;
      done = true;
      this.closeModal();
      fireAndForget(onUpdateNow);
    };
    this.wireActions(box, { later, update }, { close: false });
    dialog.onclick = (e) => {
      if (e.target === dialog) later();
    }; // backdrop
    dialog.oncancel = () => later(); // Esc / ✕
  }

  /** Reveal the persistent "Update" chip in the speed toolbar (idempotent) and
   *  wire its click. Announced politely for screen readers. The chip is the
   *  durable way back to the update prompt after the player defers, and the
   *  fallback if a calm moment to auto-surface the modal never comes. */
  showUpdateChip(onClick: () => void): void {
    const btn = document.getElementById("btn-update") as HTMLButtonElement | null;
    if (!btn) return;
    btn.onclick = onClick;
    btn.hidden = false; // reveal (idempotent — safe to call again while shown)
    // Announce on EVERY call, not just the first reveal: a newer build arriving
    // while the chip is already visible should still reach screen-reader users.
    // Clear first, then set on the next frame so an identical message re-fires in
    // the polite live region instead of being coalesced into a no-op.
    const live = document.getElementById("a11y-live");
    if (live) {
      live.textContent = "";
      const announce = () => (live.textContent = "An update is ready.");
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(announce);
      else announce();
    }
  }

  congratsTower(): void {
    const box = this.openModal(`
      <h2>🏆 TOWER achieved!</h2>
      <p>Your skyscraper has earned the legendary <b>TOWER</b> rating. Wedding bells ring out over the city from the hall on the 100th floor. Congratulations, master builder!</p>
      <div class="modal-actions"><button class="btn primary" data-act="close">Continue</button></div>
    `);
    this.wireActions(box);
  }
}

function shortMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

/**
 * Place a panel of `size` beside a facility's screen `rect`: prefer the rect's
 * right side, flip to the left when there isn't room, and clamp so the panel
 * always stays fully inside the viewport (with an 8px margin). Pure so the
 * placement logic is unit-testable without a DOM.
 */
/**
 * Update the volatile cells of a container in place: for each `data-field` key
 * in `volatile`, set that cell's innerHTML (only when it actually changed).
 * Buttons, inputs and static rows are untouched, so an in-flight click is never
 * clobbered. Pure over its `container`, so it's unit-testable without the app.
 */
export function patchVolatile(container: HTMLElement, volatile: Record<string, string>): void {
  for (const field in volatile) {
    const node = container.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (node && node.innerHTML !== volatile[field]) node.innerHTML = volatile[field];
  }
}

export function anchorBeside(
  rect: { x: number; y: number; w: number },
  size: { w: number; h: number },
  viewW: number,
  viewH: number,
  gap = 8,
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  let left = rect.x + rect.w + gap; // prefer the facility's right
  if (left + size.w > viewW - gap) left = rect.x - size.w - gap; // no room → flip left
  return {
    left: clamp(left, gap, Math.max(gap, viewW - size.w - gap)),
    top: clamp(rect.y, gap, Math.max(gap, viewH - size.h - gap)),
  };
}
