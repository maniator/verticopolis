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
import type { PriceOptions } from "../engine/gameRules";
import type { ElevatorSchedule } from "../engine/elevatorSchedule";
import type { CalendarKind } from "../engine/calendar";
import type { UpdateInfo } from "../pwa";
import { getPlatform } from "../platform";
import { render, type TemplateResult } from "lit-html";
import { toolInfoTemplate, BULLDOZE_TOOL_INFO, INSPECT_TOOL_INFO } from "./templates/toolInfo";
import * as dialogs from "./uiDialogs";
import * as panels from "./uiPanels";
import * as status from "./uiStatus";
import { buildPalette } from "./uiPalette";

export type Tool = { type: "build"; kind: FacilityKind } | { type: "bulldoze" } | { type: "inspect" };

/** Id stamped on the shared modal's title-TEXT span so `#modal` can point
 *  `aria-labelledby` at it (see {@link UI.finishModal}). It lives on a span
 *  that wraps only the title text, nested one level inside `h2.win-title`,
 *  never on the h2 itself: the h2 also holds the ✕ close button as a sibling
 *  of that span, and if `aria-labelledby` referenced the h2 the dialog's
 *  computed accessible name would run the title together with the ✕'s own
 *  accessible name ("Close"). The dialog's DOM is fully replaced on every open
 *  ({@link UI.openModalTemplate} clears the dialog's children, and only one
 *  modal is ever live at a time, guarded by {@link UI.isModalOpen}), so
 *  successive modal titles never collide on this one constant id. DOM id
 *  uniqueness is document-wide, and no other element in the app uses this id,
 *  so reusing the same constant on every open is collision-free. */
const MODAL_TITLE_ID = "verticopolis-modal-title";

export interface UICallbacks {
  onSelectTool(tool: Tool): void;
  onSpeed(speed: number): void;
  /** The live game-speed index, so a dialog can pause and restore the tower. */
  getSpeed(): number;
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
  onSetVolume(kind: "music" | "ambience" | "sfx", value: number): void;
  /** The live volume levels (0..1 each), for the sliders' initial positions. */
  getVolumes(): { music: number; ambience: number; sfx: number };
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
   *  / "occupancy" / "satisfaction" / "cleanliness", or "" for off). */
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
 * lit template bodies in `./templates/`, the dialog controllers in `./uiDialogs`, the
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
    modeBadge: document.getElementById("btn-mode")!,
  };

  /** True while the user is pressing something inside the editor card. */
  private editorBusy = false;
  /** Cached panel sizes so per-frame anchoring never reads layout (no thrash);
   *  re-measured only when the content changes.
   *  @internal friend-module access (uiPanels). */
  editorSize = { w: 0, h: 0 };
  /** @internal friend-module access (uiPanels). */
  inspectorSize = { w: 0, h: 0 };
  /** Dirty-gate key for the palette lock/afford scan: the star plus the
   *  per-kind affordability bitmask last applied to the DOM. The ~6 Hz pump
   *  rescans only when this changes (a star or affordability crossing).
   *  @internal friend-module access (uiStatus). */
  paletteScanKey: string | null = null;

  constructor(cb: UICallbacks) {
    this.cb = cb;
    buildPalette(this);
    this.wireControls();
    // selectTool below renders the tool-info panel through lit; clear the static
    // HTML placeholder first so lit's first render never appends after it (one
    // container, one renderer). Invisible: selectTool repaints it immediately.
    this.el.toolInfo.replaceChildren();
    this.selectTool({ type: "inspect" });
    // The editor card's [data-edit] actions and its ✕ dispatch through ONE
    // delegated listener on the container, so lit re-renders never need
    // rewiring (E6-S1).
    panels.wireEditorActions(this);
    // While the pointer is pressed inside the editor card, suppress the periodic
    // refresh. lit's diff already keeps a pressed button's identity (the
    // "+ rent sometimes does nothing" bug), so this is belt-and-suspenders
    // through E6, kept so a refresh can't move the card under the pointer.
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

    document.getElementById("panel-toggle")?.addEventListener("click", () => document.body.classList.toggle("panels-open"));
    const closePanels = () => document.body.classList.remove("panels-open");
    document.getElementById("panel-close")?.addEventListener("click", closePanels);
    document.getElementById("scrim")?.addEventListener("click", closePanels);

    // Quick Save is the top-bar 💾 (index.html); null-safe so a trimmed DOM that omits it does not throw.
    document.getElementById("btn-save-top")?.addEventListener("click", () => this.cb.onSave());
    document.getElementById("btn-load")!.addEventListener("click", () => this.cb.onShowSaves());
    document.getElementById("btn-new")!.addEventListener("click", () => {
      // The toolbar always has a live tower to abandon, so the picker shows its
      // fold-in abandon warning; the mode choice and the confirm are one step.
      this.newTowerModal({ hasSave: true, onFound: (mode, cal) => this.cb.onNew(mode, cal) });
    });
    document.getElementById("btn-settings")!.addEventListener("click", () => this.showSettings());
    document.getElementById("btn-help")!.addEventListener("click", () => this.showHelp());
    this.el.modeBadge.addEventListener("click", () => this.showCompare()); // "tell me more"
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
      render(toolInfoTemplate(f, isCommercialKind(tool.kind)), this.el.toolInfo);
    } else {
      document.querySelector(`.pal-item[data-tool="${tool.type}"]`)?.classList.add("active");
      render(tool.type === "bulldoze" ? BULLDOZE_TOOL_INFO : INSPECT_TOOL_INFO, this.el.toolInfo);
    }
  }

  setTowerName(name: string): void {
    if (document.activeElement !== this.el.towerName) this.el.towerName.value = name;
  }

  // ---- Modal primitives (friend-modules build their dialogs on these) -----

  /** Renders a lit `TemplateResult` into the shared modal with the window
   *  grammar (see {@link finishModal}). The template renders into a box that is
   *  FRESH per open and discarded by closeModal(), so lit's part-cache never
   *  shares a container across opens: one container, one renderer. render() only
   *  ever touches this child box; the dialog itself is only ever cleared, via
   *  replaceChildren (here and in closeModal), never written as HTML. It renders
   *  once per open (no re-render), so
   *  the ✕ that finishModal appends into the rendered h2 is safe; any initial
   *  focus is the dialog controller's own explicit side effect, not this mount's
   *  job.
   *  @internal friend-module access (uiDialogs). */
  openModalTemplate(result: TemplateResult): HTMLElement {
    const dialog = this.el.modal as HTMLDialogElement;
    dialog.replaceChildren();
    const box = document.createElement("div");
    box.className = "modal-box win";
    render(result, box);
    dialog.appendChild(box);
    return this.finishModal(dialog, box);
  }

  /** The shared window grammar {@link openModalTemplate} finishes with: skin the
   *  top-level h2 as the title bar (`:scope > h2` so a nested h2 is never
   *  skinned), wrap its title text alone in a span carrying the shared
   *  {@link MODAL_TITLE_ID} and point the dialog's `aria-labelledby` at that SPAN
   *  (never at the h2 itself, since the h2 also ends up holding the ✕ below;
   *  labeling the h2 would fold the ✕'s own accessible name, "Close", into the
   *  announced title), show the dialog, then append the win-style ✕ into the h2
   *  as a sibling of the span so it stays excluded from the accessible name.
   *  Cleared when a modal renders no top-level h2, so the reference is never
   *  left dangling. The ✕ routes through the dialog's cancel path (same as Esc)
   *  rather than closeModal() directly, so modals that override oncancel to
   *  resolve a pending choice still resolve. It is appended AFTER showModal() so
   *  it is not the first focusable element (keyboard users land on the primary
   *  action, not the ✕). Backdrop click and Esc/cancel close. */
  private finishModal(dialog: HTMLDialogElement, box: HTMLElement): HTMLElement {
    const h2 = box.querySelector(":scope > h2");
    h2?.classList.add("win-title");
    if (h2) {
      // Move the title CONTENTS into their own span and label the dialog at
      // THAT span, not the h2 (see MODAL_TITLE_ID); a caller-supplied h2.id is
      // never touched. Idempotent: reuse an existing span rather than nesting
      // a new one, and never sweep the ✕ (.modal-x) into it, so a repeat call
      // can't nest spans or fold "Close" into the accessible name.
      let titleSpan = h2.querySelector<HTMLSpanElement>(`#${MODAL_TITLE_ID}`);
      if (!titleSpan) {
        titleSpan = document.createElement("span");
        titleSpan.id = MODAL_TITLE_ID;
        const close = h2.querySelector(".modal-x");
        while (h2.firstChild && h2.firstChild !== close) titleSpan.appendChild(h2.firstChild);
        h2.appendChild(titleSpan);
      }
      dialog.setAttribute("aria-labelledby", titleSpan.id);
    } else {
      dialog.removeAttribute("aria-labelledby");
    }
    if (!dialog.open) dialog.showModal();
    if (h2 && !h2.querySelector(".modal-x")) {
      h2.appendChild(
        this.titleBarClose("modal-x btn xs", () => dialog.dispatchEvent(new Event("cancel", { cancelable: true }))),
      );
    }
    dialog.onclick = (e) => {
      if (e.target === dialog) this.closeModal();
    };
    dialog.oncancel = () => this.closeModal(); // Esc key
    return box;
  }

  closeModal(): void {
    const dialog = this.el.modal as HTMLDialogElement;
    if (dialog.open) dialog.close();
    dialog.replaceChildren();
    // The title h2 goes with the wiped content; drop the reference to it too,
    // so aria-labelledby never dangles at a stale/missing id while the dialog
    // is closed (finishModal re-sets it fresh on the next open).
    dialog.removeAttribute("aria-labelledby");
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

  renderEditor(tpl: TemplateResult): void {
    panels.renderEditor(this, tpl);
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

  showInspector(tpl: TemplateResult | null): void {
    panels.showInspector(this, tpl);
  }

  showStats(body: TemplateResult, handlers: Record<string, () => void> = {}): void {
    dialogs.showStats(this, body, handlers);
  }

  showSaves(slots: SlotInfo[]): void {
    dialogs.showSaves(this, slots);
  }

  showBatchPricingDialog(
    ctx: { kind: FacilityKind; kindLabel: string; options: PriceOptions },
    cb: {
      preview: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
      apply: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
      onApplied: (summary: string) => void;
    },
  ): void {
    dialogs.showBatchPricingDialog(this, ctx, cb);
  }

  showElevatorScheduleDialog(
    ctx: dialogs.ScheduleDialogCtx,
    cb: { apply: (schedule: ElevatorSchedule) => void },
  ): void {
    dialogs.showElevatorScheduleDialog(this, ctx, cb);
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

  showCompare(): void {
    dialogs.showCompare(this);
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

// The pure placement helper moved to ./uiPanels with the panel logic that
// uses it; re-exported here so existing importers (anchor.test.ts and any
// tooling) keep resolving it from ./UI.
export { anchorBeside } from "./uiPanels";
