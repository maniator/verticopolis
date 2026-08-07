import { FACILITIES, isCommercialKind } from "../engine/facilities";
import type { Simulation, LogEntry } from "../engine/Simulation";
import type { SlotInfo } from "../storage/SaveGame";
import type { SaveScopeCaption } from "./templates/saves";
import type { ExportReport } from "../storage/tdtExport";
import type { ImportReport } from "../storage/tdtImport";
import type { FacilityKind, GameMode } from "../engine/types";
import type { ElevatorSchedule } from "../engine/elevatorSchedule";
import type { CalendarKind } from "../engine/calendar";
import type { UpdateInfo } from "../pwa";
import { getPlatform } from "../platform";
import { render, type TemplateResult } from "lit-html";
import { iconElement } from "./icons";
import { mountToolbarIcons } from "./uiToolbarIcons";
import { toolInfoTemplate, BULLDOZE_TOOL_INFO, INSPECT_TOOL_INFO } from "./templates/toolInfo";
import * as dialogs from "./uiDialogs";
import * as panels from "./uiPanels";
import * as status from "./uiStatus";
import { buildPalette } from "./uiPalette";
import { ModalPrecedence, routeNotice, type ModalOpts } from "./modalPrecedence";
import { finishModal } from "./uiModal";

export type Tool = { type: "build"; kind: FacilityKind } | { type: "bulldoze" } | { type: "inspect" };

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
  /** The live tower's rules mode, so the export dialog can gate the 1994 path (Classic only) without serializing the whole tower. */
  getMode(): GameMode;
  onNew(mode: GameMode, modernCalendar: CalendarKind, startUnbridged: boolean): void;
  onToggleAudio(): boolean; // returns new muted state
  /** The live muted state, so the toggle's glyph can be initialized at boot (persisted mute must show 🔇 without a click). */
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
  /** Toggle the "steady clock" pref (disables the 1994 breathing-clock pacing); returns the new steady state (true = steady, breathing off). */
  onToggleSteadyClock(): boolean;
  /** The live steady-clock state, read from the same in-memory prefs the game loop consults (never a second localStorage read, which could disagree). */
  isSteadyClock(): boolean;
  /** Modern bridging toggle for the Settings switch: flip (no-op in Classic) and read the live state. */
  onToggleAutoBridge(): boolean;
  isAutoBridge(): boolean;
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
    paletteTabs: document.getElementById("palette-tabs")!,
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
  /** Dirty-gate key for the palette lock/afford scan: the star plus the per-kind
   *  affordability bitmask last applied to the DOM. The ~6 Hz pump rescans only
   *  when this changes. @internal friend-module access (uiStatus). */
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

  /** Open the New Tower picker over a live tower. The toolbar always has one to
   *  abandon, so the picker shows its fold-in abandon warning and the mode
   *  choice and the confirm are one step. Named rather than inlined in the
   *  button handler because a native shell menu reaches the same command
   *  through `src/game/hostCommands.ts`, and both callers must land on one code
   *  path (a second copy of these options is how the two would drift). */
  promptNewTower(): void {
    this.newTowerModal({ hasSave: true, onFound: (mode, cal, manual) => this.cb.onNew(mode, cal, manual) });
  }

  private wireControls(): void {
    document.querySelectorAll<HTMLButtonElement>("#speed button[data-speed]").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#speed button[data-speed]").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        this.cb.onSpeed(Number(b.dataset.speed));
      });
    });

    // Init from persisted state; toggleMute owns every later update (splash too).
    this.setAudioGlyph(this.cb.isMuted());
    this.el.audioToggle.addEventListener("click", () => this.cb.onToggleAudio());
    mountToolbarIcons();
    document.getElementById("btn-undo")?.addEventListener("click", () => this.cb.onUndo());
    document.getElementById("btn-redo")?.addEventListener("click", () => this.cb.onRedo());

    document.getElementById("panel-toggle")?.addEventListener("click", () => document.body.classList.toggle("panels-open"));
    const closePanels = () => document.body.classList.remove("panels-open");
    document.getElementById("panel-close")?.addEventListener("click", closePanels);
    document.getElementById("scrim")?.addEventListener("click", closePanels);

    // Quick Save is the top-bar 💾 (index.html); null-safe so a trimmed DOM that omits it does not throw.
    document.getElementById("btn-save-top")?.addEventListener("click", () => this.cb.onSave());
    document.getElementById("btn-load")!.addEventListener("click", () => this.cb.onShowSaves());
    document.getElementById("btn-new")!.addEventListener("click", () => this.promptNewTower());
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
      // The Floor tool lays a lobby on the ground floor (level 1), so surface the
      // lobby price on its info card. See groundFloorStructureKind.
      render(
        toolInfoTemplate(f, isCommercialKind(tool.kind), tool.kind === "floor" ? FACILITIES.lobby.cost : undefined),
        this.el.toolInfo,
      );
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
   *  grammar (see {@link finishModal}). The template renders into a box FRESH
   *  per open and discarded by closeModal(), so lit's part-cache never shares a
   *  container across opens: one container, one renderer. render() only touches
   *  this child box; the dialog itself is only ever cleared via replaceChildren
   *  (here and in closeModal), never written as HTML. It renders once per open,
   *  so the ✕ finishModal appends into the rendered h2 is safe; any initial
   *  focus is the dialog controller's explicit side effect, not this mount's job.
   *  @internal friend-module access (uiDialogs). */
  openModalTemplate(result: TemplateResult, opts: ModalOpts = {}): HTMLElement {
    const dialog = this.el.modal as HTMLDialogElement;
    const displacing = dialog.open;
    dialog.replaceChildren();
    // After the clear, before the mount: a notice raised by the broken-leash
    // path then lands in the INCOMING dialog, not the one being wiped.
    this.precedence.opening(displacing, opts);
    const box = document.createElement("div");
    box.className = "modal-box win";
    render(result, box);
    dialog.appendChild(box);
    return finishModal(dialog, box, {
      titleBarClose: (cls, onClick) => this.titleBarClose(cls, onClick),
      closeModal: () => this.closeModal(),
      drainNotice: (b) => this.precedence.drainNotice(b),
    });
  }



  closeModal(): void {
    const dialog = this.el.modal as HTMLDialogElement;
    const wasOpen = dialog.open;
    if (wasOpen) dialog.close();
    dialog.replaceChildren();
    // The title h2 goes with the wiped content; drop the reference to it too,
    // so aria-labelledby never dangles at a stale/missing id while the dialog
    // is closed (finishModal re-sets it fresh on the next open).
    //
    // ALL teardown happens before the leash fires. A waiting report re-opens
    // from inside `closed()`, setting a fresh label on the way in, and tearing
    // down afterwards would strip the label off the dialog that just opened,
    // leaving the report with no accessible name.
    dialog.removeAttribute("aria-labelledby");
    this.precedence.closed(wasOpen);
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

  /** Who may take the shared dialog; rules in `./modalPrecedence`.
   *  @internal friend-module access (uiDialogs). */
  precedence = new ModalPrecedence();

  /** Say something that must reach the player even when a dialog is up.
   *
   *  The asynchronous import and export paths all share one hazard: the OS file
   *  picker is not a modal, so by the time a read finishes or a parse fails the
   *  player may have opened a dialog, and a `<dialog>` paints over the toast
   *  rail at any z-index. A failure announced with a toast from there is
   *  announced to nobody (GH #658). This routes the line into the dialog in the
   *  way, and uses a toast only when there is no dialog to be behind.
   *  @internal friend-module access (uiDialogs / saveLoad / uiImport). */
  sayVisibly(text: string, kind: "bad" | "info" = "bad"): void {
    routeNotice(this.el.modal as HTMLDialogElement, this.precedence, text, (t) => this.toast(t, kind));
  }

  /** True while any modal is on screen (the shared `<dialog>` is open). Callers
   *  use this to avoid opening a second modal, which would wipe the first's DOM
   *  and its pending handlers. For the narrower question of whether replacing
   *  it would DESTROY anything, see `./modalPrecedence`. */
  isModalOpen(): boolean {
    return (this.el.modal as HTMLDialogElement).open;
  }

  /** Topbar mute glyph, set by toggleMute for every caller so all views agree (SPEC-splash-mute CAP-2). */
  setAudioGlyph(muted: boolean): void {
    this.el.audioToggle.replaceChildren(iconElement(muted ? "mute" : "sound"));
    this.el.audioToggle.setAttribute("aria-pressed", String(muted));
  }

  /** Hand the player an exported file. Routed through the platform port so a
   *  native wrapper can deliver it its own way (share sheet); the browser port
   *  keeps the pre-port blob-anchor download exactly. Callers decide the name and
   *  contents (see SaveGame.export); raw bytes flow through too, for the binary
   *  .TDT export. The type mirrors the platform port's saveFile seam (a
   *  cross-repo contract), which is why it is narrower than BlobPart.
   *
   *  Returns a promise that settles when the port's saveFile does and never
   *  rejects (every failure lands in the toast below). The export flow awaits
   *  it on a wrapped session so its single-flight latch spans the shell's save
   *  dialog (GH #773). Every other caller may ignore it: the call itself stays
   *  synchronous, and the browser port resolves right after its anchor click. */
  downloadFile(filename: string, contents: string | Uint8Array): Promise<void> {
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
      return Promise.resolve(getPlatform().saveFile(filename, contents, "application/octet-stream")).catch(fail);
    } catch (err) {
      fail(err);
      return Promise.resolve();
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

  anchorInspector(rect: { x: number; y: number; w: number }, viewW: number, viewH: number): void {
    panels.anchorInspector(this, rect, viewW, viewH);
  }

  clearEditorAnchor(): void {
    panels.clearPanelAnchor(this.el.editor);
  }

  clearInspectorAnchor(): void {
    panels.clearPanelAnchor(this.el.inspector);
  }

  showInspector(tpl: TemplateResult | null): void {
    panels.showInspector(this, tpl);
  }

  setInspectorPeek(on: boolean): void {
    panels.setInspectorPeek(this, on);
  }

  showStats(body: TemplateResult, handlers: Record<string, () => void> = {}): void {
    dialogs.showStats(this, body, handlers);
  }

  showSaves(slots: SlotInfo[], scope?: SaveScopeCaption): void {
    dialogs.showSaves(this, slots, scope);
  }

  showTowerPicker(ctx: dialogs.TowerPickerCtx): void {
    dialogs.showTowerPicker(this, ctx);
  }

  showBatchPricingDialog(ctx: dialogs.BatchPricingDialogCtx, cb: dialogs.BatchPricingDialogCb): void {
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

  newTowerModal(opts: { hasSave: boolean; onFound: (mode: GameMode, modernCalendar: CalendarKind, startUnbridged: boolean) => void }): void {
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
