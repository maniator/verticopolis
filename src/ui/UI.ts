import { FACILITIES, isCommercialKind } from "../engine/facilities";
import type {
  Simulation,
  LogEntry,
  BatchTarget,
  BatchRentOptions,
  BatchRentResult,
} from "../engine/Simulation";
import type { SlotInfo } from "../storage/SaveGame";
import type { ExportReport } from "../storage/tdtExport";
import type { ImportReport } from "../storage/tdtImport";
import type { FacilityKind, GameMode } from "../engine/types";
import type { CalendarKind } from "../engine/calendar";
import type { UpdateInfo } from "../pwa";
import { getPlatform } from "../platform";
import * as tpl from "./uiTemplates";
import * as dialogs from "./uiDialogs";
import * as panels from "./uiPanels";
import * as status from "./uiStatus";
import { buildPalette } from "./uiPalette";

export type Tool = { type: "build"; kind: FacilityKind } | { type: "bulldoze" } | { type: "inspect" };

export interface UICallbacks {
  onSelectTool(tool: Tool): void;
  onSpeed(speed: number): void;
  onSave(): void;
  onLoad(): void;
  onExport(): void;
  /** A picked file's text contents — a `.vctower` export. */
  onImport(data: string): void;
  /** A picked binary legacy save (original SimTower `.TDT`), as raw bytes. */
  onImportLegacy(buffer: ArrayBuffer, filename: string): void;
  /** Export the live tower as an original 1994 SimTower save (.TDT). */
  onExportLegacy(): void;
  /** The live tower's rules mode, so the export dialog can gate the 1994 path
   *  (Classic only) without serializing the whole tower. */
  getMode(): GameMode;
  onNew(mode: GameMode, modernCalendar: CalendarKind): void;
  onToggleAudio(): boolean; // returns new muted state
  /** The live muted state, so the toggle's glyph can be initialized at boot
   *  (persisted mute must show 🔇 without a click). */
  isMuted(): boolean;
  /** A volume slider moved: set that channel's level (0..1) and persist it. */
  onSetVolume(kind: "music" | "sfx", value: number): void;
  /** The live volume levels (0..1 each), for the sliders' initial positions. */
  getVolumes(): { music: number; sfx: number };
  onUndo(): void;
  onRedo(): void;
  onEditAction(action: string, root: HTMLElement): void;
  /** Toggle reduced motion; returns the new effective state. */
  onToggleReducedMotion(): boolean;
  /** Toggle the "steady clock" pref (disables the 1994 breathing-clock pacing);
   *  returns the new steady state (true = steady, breathing off). */
  onToggleSteadyClock(): boolean;
  /** The live steady-clock state, read from the same in-memory prefs the game
   *  loop consults (never a second localStorage read, which could disagree). */
  isSteadyClock(): boolean;
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

/**
 * Owns all DOM controls outside the canvas and keeps them in sync. The bulk of
 * the view and behavior lives in friend-modules that take this instance: the
 * HTML bodies in `./uiTemplates`, the dialog controllers in `./uiDialogs`, the
 * status/log pump in `./uiStatus`, the editor/inspector panels in `./uiPanels`,
 * and the palette build in `./uiPalette`. This class keeps the shared DOM handle
 * map, the modal primitives they build on, the tool selection, and thin
 * delegations, so `main.ts` and the game modules call `ui.*` unchanged. The
 * members those friend-modules read are public for that reason.
 */
export class UI {
  tool: Tool = { type: "inspect" };
  /** @internal friend-module access (uiDialogs / uiStatus / uiPanels / uiPalette). */
  cb: UICallbacks;
  /** @internal friend-module access (uiStatus log cursor). */
  lastLogSeq = 0;

  /** @internal friend-module access (shared DOM handle map). */
  el = {
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

  /** True while the user is pressing something inside the editor card. */
  private editorBusy = false;
  /** Cached panel sizes so per-frame anchoring never reads layout (no thrash);
   *  re-measured only when the content changes.
   *  @internal friend-module access (uiPanels). */
  editorSize = { w: 0, h: 0 };
  /** @internal friend-module access (uiPanels). */
  inspectorSize = { w: 0, h: 0 };
  /** The shape currently built into the editor card (see renderEditor's key).
   *  @internal friend-module access (uiPanels). */
  editorKey: string | null = null;

  constructor(cb: UICallbacks) {
    this.cb = cb;
    buildPalette(this);
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

  isEditorBusy(): boolean {
    return this.editorBusy;
  }

  private wireControls(): void {
    document.querySelectorAll<HTMLButtonElement>("#speed button[data-speed]").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#speed button[data-speed]").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        this.cb.onSpeed(Number(b.dataset.speed));
      });
    });

    // Initialize the glyph from the persisted state (the HTML default is 🔊,
    // wrong for a player who muted last session), then follow every toggle.
    this.el.audioToggle.textContent = this.cb.isMuted() ? "🔇" : "🔊";
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
      this.newTowerModal({ hasSave: true, onFound: (mode, cal) => this.cb.onNew(mode, cal) });
    });
    document.getElementById("btn-settings")!.addEventListener("click", () => this.showSettings());
    document.getElementById("btn-help")!.addEventListener("click", () => this.showHelp());
    document.getElementById("btn-stats")!.addEventListener("click", () => this.cb.onShowStats());
    document.getElementById("overlay-mode")?.addEventListener("change", (e) => {
      this.cb.onSetOverlay((e.currentTarget as HTMLSelectElement).value);
    });

    this.el.towerName.addEventListener("change", () => {
      this.cb.onRenameTower(this.el.towerName.value.trim() || "Tower One");
    });
  }

  selectTool(tool: Tool): void {
    this.tool = tool;
    this.cb.onSelectTool(tool);
    document.querySelectorAll(".pal-item").forEach((x) => x.classList.remove("active"));
    if (tool.type === "build") {
      document.querySelector(`.pal-item[data-kind="${tool.kind}"]`)?.classList.add("active");
      const f = FACILITIES[tool.kind];
      this.el.toolInfo.innerHTML = tpl.buildToolInfoHtml(f, isCommercialKind(tool.kind), f.description);
    } else {
      document.querySelector(`.pal-item[data-tool="${tool.type}"]`)?.classList.add("active");
      this.el.toolInfo.innerHTML =
        tool.type === "bulldoze" ? tpl.BULLDOZE_TOOL_INFO_HTML : tpl.INSPECT_TOOL_INFO_HTML;
    }
  }

  setTowerName(name: string): void {
    if (document.activeElement !== this.el.towerName) this.el.towerName.value = name;
  }

  // ---- Modal primitives (friend-modules build their dialogs on these) -----

  /** @internal friend-module access (uiDialogs). */
  openModal(html: string): HTMLElement {
    const dialog = this.el.modal as HTMLDialogElement;
    dialog.innerHTML = `<div class="modal-box win">${html}</div>`;
    const box = dialog.firstElementChild as HTMLElement;
    // Every dialog's TOP-LEVEL h2 is the window title bar; classing it here keeps
    // the rule in one place. :scope > h2 so an h2 nested in body content is never
    // skinned.
    const h2 = box.querySelector(":scope > h2");
    h2?.classList.add("win-title");
    if (!dialog.open) dialog.showModal();
    // Win-style ✕ in the title bar so long dialogs can be dismissed without
    // scrolling to the bottom button. It routes through the dialog's cancel path
    // (same as Esc) rather than closeModal() directly, so modals that override
    // oncancel to resolve a pending choice still resolve. Appended AFTER
    // showModal(): it must not be the first focusable element, or keyboard users
    // would land on ✕ and Enter would dismiss instead of activating the primary.
    if (h2) {
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

  /** Bind click handlers to a dialog's [data-act] buttons. Every lookup is loud
   *  (non-null) so a template typo throws at open instead of shipping a dead
   *  button — including the default close binding. Dialogs that render no close
   *  button (confirm, emergency) disable it via opts.close: false.
   *  @internal friend-module access (uiDialogs). */
  wireActions(box: HTMLElement, handlers: Record<string, () => void> = {}, opts: { close?: boolean } = {}): void {
    if (opts.close !== false && !("close" in handlers)) {
      box.querySelector('[data-act="close"]')!.addEventListener("click", () => this.closeModal());
    }
    for (const [act, fn] of Object.entries(handlers)) {
      box.querySelector(`[data-act="${act}"]`)!.addEventListener("click", fn);
    }
  }

  /** The one way to build a title-bar ✕ (see docs/design-system.md): every
   * dismissible window's close button comes from here so they can't drift.
   * @internal friend-module access (uiPanels inspector card). */
  titleBarClose(className: string, onClick: () => void): HTMLButtonElement {
    const x = document.createElement("button");
    x.type = "button";
    x.className = className;
    x.setAttribute("aria-label", "Close");
    x.textContent = "✕";
    x.addEventListener("click", onClick);
    return x;
  }

  /** True while any modal is on screen (the shared `<dialog>` is open). Callers
   *  use this to avoid opening a second modal, which would wipe the first's DOM
   *  and its pending handlers. */
  isModalOpen(): boolean {
    return (this.el.modal as HTMLDialogElement).open;
  }

  /** Hand the player an exported file. Routed through the platform port so a
   *  native wrapper can deliver it its own way (share sheet); the browser port
   *  keeps the pre-port blob-anchor download exactly. Callers decide the name and
   *  contents (see SaveGame.export); raw bytes flow through too, for the binary
   *  .TDT export. The type mirrors the platform port's saveFile seam (a
   *  cross-repo contract), which is why it is narrower than BlobPart. */
  downloadFile(filename: string, contents: string | Uint8Array): void {
    // octet-stream (not application/json, the payload isn't) so the browser
    // downloads our made-up .vctower type instead of trying to display it.
    //
    // Every failure shape a broken wrapper can produce (sync throw, non-Promise
    // return, rejection) must reach the same toast, because losing an export
    // silently is never acceptable. Dead code in the browser (its saveFile never
    // throws or rejects); a native shell rejects only on real failure, and cancel
    // resolves, so the toast never fires for it. The call itself stays
    // synchronous: deferring it would delay the browser download.
    const fail = (err: unknown) => {
      console.error("[platform] saveFile failed:", err);
      this.toast("Couldn't save your tower file. Please try again.", "bad");
    };
    try {
      void Promise.resolve(getPlatform().saveFile(filename, contents, "application/octet-stream")).catch(fail);
    } catch (err) {
      fail(err);
    }
  }

  // ---- Delegations to friend-modules --------------------------------------

  update(sim: Simulation): void {
    status.update(this, sim);
  }

  resetLog(sim: Simulation): void {
    status.resetLog(this, sim);
  }

  toast(text: string, kind: LogEntry["kind"] = "info"): void {
    status.toast(this, text, kind);
  }

  renderEditor(key: string, build: () => string, volatile: Record<string, string>): void {
    panels.renderEditor(this, key, build, volatile);
  }

  showEditor(html: string): void {
    panels.showEditor(this, html);
  }

  hideEditor(): void {
    panels.hideEditor(this);
  }

  isEditorOpen(): boolean {
    return panels.isEditorOpen(this);
  }

  isInspectorOpen(): boolean {
    return panels.isInspectorOpen(this);
  }

  anchorEditor(rect: { x: number; y: number; w: number }, viewW: number, viewH: number): void {
    panels.anchorEditor(this, rect, viewW, viewH);
  }

  anchorInspector(x: number, y: number, viewW: number, viewH: number): void {
    panels.anchorInspector(this, x, y, viewW, viewH);
  }

  clearPanelAnchors(): void {
    panels.clearPanelAnchors(this);
  }

  showInspector(html: string | null): void {
    panels.showInspector(this, html);
  }

  showStats(html: string): void {
    dialogs.showStats(this, html);
  }

  showSaves(slots: SlotInfo[]): void {
    dialogs.showSaves(this, slots);
  }

  showStopsDialog(
    title: string,
    floors: { floor: number; stop: boolean; lobby: boolean }[],
    onToggle: (floor: number, stop: boolean) => void,
  ): void {
    dialogs.showStopsDialog(this, title, floors, onToggle);
  }

  showBatchPricingDialog(
    ctx: { kind: FacilityKind; kindLabel: string; band: { default: number; min: number; max: number; step: number } },
    cb: {
      preview: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
      apply: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
      onApplied: (summary: string) => void;
    },
  ): void {
    dialogs.showBatchPricingDialog(this, ctx, cb);
  }

  confirmModal(title: string, body: string, onYes: () => void, yesLabel = "Confirm"): void {
    dialogs.confirmModal(this, title, body, onYes, yesLabel);
  }

  newTowerModal(opts: { hasSave: boolean; onFound: (mode: GameMode, modernCalendar: CalendarKind) => void }): void {
    dialogs.newTowerModal(this, opts);
  }

  showImportReport(report: ImportReport, cb: { onOpen: () => void }): void {
    dialogs.showImportReport(this, report, cb);
  }

  showExportReport(report: ExportReport, cb: { onDownload: () => void }): void {
    dialogs.showExportReport(this, report, cb);
  }

  showHelp(): void {
    dialogs.showHelp(this);
  }

  showSettings(): void {
    dialogs.showSettings(this);
  }

  showEventChoice(message: string, costLabel: string, onResolve: (opt: "accept" | "decline") => void): void {
    dialogs.showEventChoice(this, message, costLabel, onResolve);
  }

  showUpdatePrompt(
    onUpdateNow: () => void | Promise<void>,
    onLater: () => void | Promise<void>,
    info?: UpdateInfo | null,
  ): void {
    dialogs.showUpdatePrompt(this, onUpdateNow, onLater, info);
  }

  showUpdateChip(onClick: () => void): void {
    dialogs.showUpdateChip(this, onClick);
  }

  congratsTower(): void {
    dialogs.congratsTower(this);
  }
}

// The two pure placement helpers moved to ./uiPanels with the panel logic that
// uses them; re-exported here so existing importers (anchor.test.ts,
// editorPatch.test.ts, and any tooling) keep resolving them from ./UI.
export { anchorBeside, patchVolatile } from "./uiPanels";
