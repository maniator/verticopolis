import type { HeatmapMode, Simulation } from "./engine/Simulation";
import type { UndoHistory } from "./engine/UndoHistory";
import { createAppHistory } from "./game/appHistory";
import { GRID, facilityFloors } from "./engine/facilities";
import type { FacilityKind } from "./engine/types";
import type { TransportView, UnitView } from "./simport/view";
import { TowerEngine, HEATMAP_MODES, type Picked } from "./render/excalibur/TowerEngine";
import { AudioEngine } from "./audio/Audio";
import { SaveGame } from "./storage/SaveGame";
import { loadPrefs, type Prefs } from "./storage/Prefs";
import { type TrafficTier } from "./engine/traffic";
import { UI, type Tool } from "./ui/UI";
import { refreshEditorCard } from "./game/editorCard";
import { type PlaceOutcome } from "./ui/placement";
import { OnboardingController } from "./ui/Onboarding";
import type { BuildActions } from "./game/buildActions";
import type { EditorActions } from "./game/editorActions";
import type { ScheduleReview } from "./game/scheduleReview";
import type { CardKit } from "./game/cardKit";
import type { SaveLoad } from "./game/saveLoad";
import { announceLive } from "./game/liveRegion";
import { isSplashUp } from "./game/interactionState";
import type { InspectorController } from "./game/inspector";
import type { KeyboardPlay } from "./game/keyboardPlay";
import { createUICallbacks, type GameAppPorts } from "./game/uiCallbacks";
import type { UpdateInfo } from "./pwa";
import type { FrameErrorEntry } from "./game/crashReport";
import { wireControllers, runBootFlow } from "./game/appBoot";
import { wireEngine } from "./game/engineWiring";
import { bindKeys } from "./game/inputKeys";
import { SPEEDS, applySpeed } from "./game/frameLoop";
import { placeSimpleBuild, updateBuildPreview, isTransportTool, pickedAt, clearBuildRefusal } from "./game/buildPreview";
import { toggleMute, setVolume, toggleReducedMotion, toggleSteadyClock, isSteadyClock, applyReducedMotion } from "./game/audioPrefs";
import { showStats, showSaves, saveToSlot, loadFromSlot, deleteSlot } from "./game/appModals";
import { refreshTraffic } from "./game/trafficHud";
import { onUpdateAvailable } from "./game/updateFlow";
import { bootGame } from "./bootstrap";
import { gameplaySession } from "./analytics";
import { adoptToolingSim, followToolingEdit, syncToolingSim, toolingSim } from "./game/toolingSim";
import { noteTowerSwap } from "./game/engineFault";
import { ViewReader } from "./simport/viewReader";
import { PortCodes } from "./simport/portCodes";
import { PortEvents } from "./simport/portEvents";
import type { PortRenderSim } from "./simport/portRenderSim";
import { hudSource } from "./game/hudSource";
import { catalogOf, newRenderSim } from "./game/portAccess";
import type { BootTower } from "./game/bootTower";
import type { EnginePort } from "./simport/enginePort";
import type { Catalog } from "./engine/catalogTypes";

/**
 * The game controller. Excalibur (via {@link TowerEngine}) owns the render
 * loop, scene, camera, panning, zooming and pointer input; this class supplies
 * the tool semantics through the engine's controller hooks, ticks the
 * simulation from the engine's per-frame `onUpdate`, and drives the DOM UI.
 *
 * The behavior lives in `src/game/` friend-modules (engineWiring, inputKeys,
 * frameLoop, buildPreview, panelAnchoring, updateFlow, audioPrefs, appModals,
 * trafficHud, appBoot): each is a free function taking this instance and
 * re-reading `app.sim`/`app.engine` per call, so an {@link adoptSim} swap stays
 * visible. To let them reach in, the fields and helpers they touch are public
 * and marked `@internal`. They are the game package's own surface, not a public
 * API, so do not reach them from outside `src/game/`.
 *
 * `window.game` surface: e2e/ and the screenshot scenes (scripts/scenes/*,
 * scripts/screenshot-page-ops.ts) reach this instance at runtime, in dev serves
 * and VC_TOOLING=1 builds only (bootstrap.ts gates the publish; production
 * bundles carry none): the public fields (sim, engine, speed, grid) plus, via
 * any-cast, `selectPicked`, `selected`, `refreshEditor`, `onUpdateAvailable`,
 * `setSpeed`, `onboarding.dismissSplash` and `refreshTraffic` (the last pins the
 * traffic chip); renaming any needs every consumer updated (TypeScript won't catch it).
 */
class GameApp implements GameAppPorts {
  /** The engine (either one, through the port), its view and code tables. */
  enginePort: EnginePort;
  reader!: ViewReader;
  portCodes!: PortCodes;
  /** The engine's gameplay events, for the analytics bridge. */ events!: PortEvents;
  /** What the renderer draws: the reader's view and the port's render queries. */ renderSim!: PortRenderSim;
  /** The editor and inspector cards, and the reads the port lacks. @internal */ cardKit!: CardKit;
  /** The elevator schedule review for older towers (#1548). @internal */ scheduleReview!: ScheduleReview;
  /** The tower the tooling harnesses edit by hand (`toolingSim.ts`); undefined on the Rust engine in production. */
  get sim(): Simulation | undefined { return toolingSim(this); }
  set sim(sim: Simulation) { this.adoptSim(sim); }
  engine: TowerEngine;
  audio = new AudioEngine();
  ui: UI;
  /** Lot geometry, exposed for tooling (e.g. the screenshot harness). */
  readonly grid = GRID;
  speed = 1;
  tool: Tool = { type: "inspect" };

  /** @internal */ canvas: HTMLCanvasElement;
  /** @internal */ accMinutes = 0;
  /** Last day each meal-rush bulletin fired (transient, like the log). Kept
   *  per meal so a save reloaded mid-day does not spam an already-fired kind.
   *  @internal */
  lastMealRushDay: Record<"breakfast" | "lunch" | "dinner", number> = { breakfast: -1, lunch: -1, dinner: -1 };
  /** @internal */ lastUiUpdate = 0;
  /** The last few failures the frame guard and the traffic chip swallowed to
   *  keep the game alive, kept for the crash report (game/frameErrors.ts).
   *  @internal */
  frameErrors: FrameErrorEntry[] = [];
  /** @internal */ shownWin = false;
  /** A save existed at boot but couldn't be read (corrupt / incompatible).
   *  @internal */
  saveWasCorrupt = false;
  /**
   * Whether a *readable* save existed at boot, snapshotted once, up front, so
   * the splash and the "new tower" confirm agree on reality. Reading it live
   * from `SaveGame.hasSave()` would count a corrupt save (wrong for both) and
   * could flip mid-session if another tab writes the slot.
   * @internal
   */
  hadReadableSave = false;
  /** Whether the emergency-choice modal is currently open. @internal */
  shownChoice = false;
  /** A newer build is waiting: skips the worker + reloads onto it. Held until
   *  the player chooses "Update now" (via the modal or the toolbar chip); null
   *  when the app is already on the latest build. @internal */
  pendingUpdate: (() => Promise<void>) | null = null;
  /** Incoming build's identity/notes for the current pending update, shown in
   *  the prompt. Null when unknown (fetch failed); the modal then omits it.
   *  @internal */
  pendingUpdateInfo: UpdateInfo | null = null;
  /** Whether the update modal is currently open: freezes the sim while it's up
   *  (same soft-freeze the emergency modal uses) so a player reading it can't
   *  lose game-hours at high speed. @internal */
  shownUpdate = false;
  /** Whether the update modal has already auto-surfaced for the current pending
   *  build, so it pops at most once on its own; after that the toolbar chip is
   *  the way back in. Reset when a genuinely newer build arrives. @internal */
  updatePromptShown = false;
  /** Last star rating we played a promotion jingle for (so 2★–5★ promotions
   * each get the jingle FR-58 promises, not only the final TOWER win). @internal */
  lastStar = 1;
  /** In-progress transport drag (anchor tile/floor). @internal */
  transportStart: { x: number; floor: number } | null = null;
  /** Deferred touch paint-tool press (tile/floor). On touch a strip is NOT laid on
   *  the press (a two-finger pan's second finger would land as a paid tile the pinch
   *  never rolls back); it is laid on the first move or the release. @internal */
  paintAnchor: { tile: number; floor: number } | null = null;
  /** In-progress touch room-build gesture: `tile`/`floor` is the deferred room's
   *  target (finger for a tap, lifted on a drag); `o*`/`lifting` gate the latch. @internal */
  buildAnchor: { tile: number; floor: number; oTile: number; oFloor: number; lifting: boolean } | null = null;
  /** Currently selected facility for the edit panel. @internal */
  selected: { type: "unit" | "transport"; id: number } | null = null;
  /** World cell the hover inspector tooltip is describing, so it can be
   *  anchored to that spot on screen and ride the tower when the camera moves.
   *  `x` is the facility's right edge (the card's preferred side), `left` its
   *  left edge so the card can flip to the other side at the viewport edge.
   *  @internal */
  inspectAnchor: { x: number; left: number; floor: number } | null = null;
  /** True when the inspector card is currently being driven by the build-preview
   *  refusal path (Modern-only hover tip), rather than the InspectorController.
   *  Kept so `updateBuildPreview` can clear its own tip when the preview turns
   *  valid or the tool changes, without stomping a legit inspector card.
   *  @internal */
  buildRefusalShowing = false;
  /** True only on the PHONE tier: MUST mirror the phone `@media` query in
   *  styles.css (`max-width: 767px`, or short landscape `max-width: 1023px and
   *  max-height: 599px`); the refusal-card opacity gate ending styles.css
   *  section 5 encodes its COMPLEMENT, so a breakpoint change lands in all
   *  three places. The tablet tier uses the docked desktop-style layout, so it
   *  must read as NON-mobile here (world-anchored editor/inspector popovers,
   *  desktop splash) to stay consistent with the CSS. Cached so per-frame
   *  anchoring doesn't construct a MediaQueryList each tick. @internal */
  mobileMq = window.matchMedia(
    "(max-width: 767px), (max-width: 1023px) and (max-height: 599px)",
  );
  /** First-run splash + onboarding (pure DOM chrome). @internal */
  onboarding!: OnboardingController;
  /** Per-device accessibility preferences (localStorage, off the save). @internal */
  prefs: Prefs = loadPrefs();
  /** Trailing debounce for volume-drag pref writes: slider input events fire
   *  at pointer-move rate, and a synchronous localStorage write per tick is
   *  avoidable main-thread churn during the gain ramp. A short trailing delay
   *  is durable enough for a device-local preference. @internal */
  prefsSaveTimer: number | null = null;
  /** @internal */ reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** Last shown traffic tier (for boundary hysteresis, so the chip doesn't flicker).
   *  @internal */
  lastTrafficTier: TrafficTier = 0;

  /** Controller modules (src/game/): each takes a narrow deps slice of this
   *  app spine, never the GameApp itself (see the modules' own doc comments).
   *  Built by {@link wireControllers}. @internal */
  build!: BuildActions;
  // editor/saveLoad/inspector are exposed as GameAppPorts for createUICallbacks;
  // build/keyboard are internal (the factory never needs them).
  editor!: EditorActions;
  saveLoad!: SaveLoad;
  inspector!: InspectorController;
  /** @internal */ keyboard!: KeyboardPlay;

  /** Undo/redo through the port (see {@link UndoHistory}), built in the
   *  constructor once `ui` exists. */
  private history!: UndoHistory;

  constructor(tower: BootTower) {
    this.canvas = document.getElementById("view") as HTMLCanvasElement;
    // Boot loaded the stored tower into the engine (`bootTower`). It tells
    // "no save" from "save present but unreadable": a corrupt/incompatible
    // autosave must NOT masquerade as a continuable tower (that would offer
    // "Continue", then silently start fresh and let the autosave clobber it).
    // We start fresh either way, but remember the corruption so the splash
    // stays honest and the player is told (below).
    this.enginePort = tower.port;
    this.saveWasCorrupt = tower.corrupt;
    this.hadReadableSave = tower.loaded;
    // Stash the unreadable bytes off the autosave slot before the 30s timer can
    // overwrite them: a save from a *newer* build is only unreadable here, and a
    // future version may recover it. Best-effort, never blocks boot.
    if (tower.corrupt) SaveGame.preserveUnreadable();
    this.reader = new ViewReader(this.enginePort, facilityFloors);
    this.portCodes = new PortCodes(this.enginePort);
    this.events = new PortEvents(this.enginePort);
    // Seed the promotion latch to the boot tower's rating (followSwap does it
    // for later swaps), or a reloaded 2★-6★ tower would fire a phantom
    // promotion (jingle + star_reached) on frame one.
    this.lastStar = this.reader.header.star;
    this.renderSim = newRenderSim(this.enginePort, this.reader);
    this.engine = new TowerEngine(this.canvas, this.renderSim, this.reader);

    // Restore persisted audio prefs onto the facade BEFORE any UI wiring or
    // gesture listener exists, so the very first interaction (which starts the
    // engine) already carries the player's mute/volume choices.
    this.audio.setMuted(this.prefs.muted === true);
    this.audio.setVolumes(
      this.prefs.musicVolume ?? 1,
      // Ambience used to ride the music bus, so a returning player who turned
      // the music down expects the crowd and room tone turned down with it.
      // With no explicit ambience pref yet (the slider is new), inherit the
      // stored music level; once the player moves the Ambience slider it
      // persists and takes over.
      this.prefs.ambienceVolume ?? this.prefs.musicVolume ?? 1,
      this.prefs.sfxVolume ?? 1,
    );

    // Controller modules, built BEFORE the UI because the UI constructor's
    // initial selectTool fires onSelectTool synchronously (which resets the
    // keyboard anchor), so `this.keyboard` must already exist. See wireControllers.
    wireControllers(this);

    // The UI command callbacks live in createUICallbacks (src/game/uiCallbacks.ts),
    // a thin delegation layer over this app spine, so the command boundary the UI
    // depends on sits in one place a later declarative UI layer can rebind. Built
    // here, AFTER the controllers above, because the UI ctor's initial selectTool
    // fires onSelectTool synchronously (which needs this.keyboard/this.build).
    this.ui = new UI(createUICallbacks(this));

    this.history = createAppHistory(this);

    wireEngine(this);
    bindKeys(this);
    // Prime the UI once before the first paint. The palette starts with every
    // facility button present; without this pass a returning player (who skips
    // the splash) would briefly see the full locked catalog before the throttled
    // render loop first hides the locked tools, a visible collapse/reflow.
    this.ui.update(hudSource(this));
    // Adopt the boot sim's log baseline the same way adoptSim does for later
    // swaps: the boot sim is assigned directly (never through adoptSim), and
    // without this the bulletin history a save carries would sit unrendered
    // after a plain page reload, the restore path players hit most.
    this.ui.resetLog(hudSource(this));
    void this.engine.start();

    // Accessibility: apply reduced motion now and whenever the OS pref flips.
    applyReducedMotion(this);
    this.reduceMq.addEventListener("change", () => applyReducedMotion(this));

    // First-paint boot flow: onboarding, resume-flag handling, splash, the
    // corrupt-save message, and the autosave timer (see runBootFlow).
    runBootFlow(this, tower.savedAt);
  }

  // ---- UI command ports (GameAppPorts; createUICallbacks delegates here) ----

  getCatalog(): Catalog {
    return catalogOf(this);
  }

  /** Switch the active build/inspect tool, dropping any in-flight gesture. */
  handleSelectTool(tool: Tool): void {
    // Report the tool mix (deduped once per distinct tool for the session), but
    // only on a genuine switch: the UI constructor's initial inspect selection
    // matches the default tool, so comparing against the current tool skips that
    // boot no-op instead of logging an inspect for every session. A build tool
    // reports its facility kind; other tools their bare mode.
    const label = tool.type === "build" ? tool.kind : tool.type;
    const prevLabel = this.tool.type === "build" ? this.tool.kind : this.tool.type;
    if (label !== prevLabel) gameplaySession.noteToolUsed(label);
    this.tool = tool;
    this.keyboard.resetAnchor(); // don't carry a pending transport anchor across tools
    // Drop any in-flight paint gesture too: onActionUp/onActionMove read the LIVE
    // tool, so a press-then-switch-then-release would stamp at the old press point.
    this.paintAnchor = null;
    this.buildAnchor = null; // and any in-flight touch room-build gesture
    this.build.clearPaint();
    // A transport anchor abandoned by a pinch (the pinch paths never fire
    // onActionUp) must not linger either: updateCoastClear() treats it as a
    // live gesture, which would keep the update prompt suppressed all session.
    this.transportStart = null;
    this.engine.preview = null;
    this.engine.transportPreview = null;
    // Drop a build-refusal tooltip if one was up, so a tool switch doesn't
    // leave a stale Modern hover tip pinned to the old preview cell.
    clearBuildRefusal(this);
  }

  /** Port for the inspector ✕ path (see GameAppPorts.clearBuildRefusal): the same
   *  buildPreview.clearBuildRefusal free function handleSelectTool calls per tool switch. */
  clearBuildRefusal(): void {
    clearBuildRefusal(this);
  }

  // Audio / accessibility / prefs commands, bodies in game/audioPrefs.ts.
  toggleMute(): boolean { return toggleMute(this); }
  setVolume(kind: "music" | "ambience" | "sfx", value: number): void { setVolume(this, kind, value); }
  toggleReducedMotion(): boolean { return toggleReducedMotion(this); }
  toggleSteadyClock(): boolean { return toggleSteadyClock(this); }
  isSteadyClock(): boolean { return isSteadyClock(this); }

  /** Replay the Getting Started onboarding, unless the splash is up. */
  replayOnboarding(): void {
    if (isSplashUp()) return; // never arm behind the splash
    OnboardingController.clearOnboarded();
    this.ui.closeModal();
    if (!this.onboarding.arm(this.enginePort)) {
      this.ui.toast("You've already completed Getting Started.", "info");
    }
  }

  // Stats + save-slot modal commands, bodies in game/appModals.ts.
  showStats(): void { void showStats(this); }
  showSaves(): void { showSaves(this); }
  saveToSlot(slot: number): void { saveToSlot(this, slot); }
  loadFromSlot(slot: number | "auto"): void { loadFromSlot(this, slot); }
  deleteSlot(slot: number): void { deleteSlot(this, slot); }

  /** Set the game speed (index into {@link SPEEDS}): updates the engine's pause
   *  state and the toolbar's active button. The single place the three concerns
   *  are kept in lockstep. */
  setSpeed(s: number): void {
    applySpeed(this, s);
    this.engine.paused = SPEEDS[s] === 0;
    document.querySelectorAll("#speed button[data-speed]").forEach((b) =>
      b.classList.toggle("active", Number((b as HTMLElement).dataset.speed) === s),
    );
  }

  /** The live speed index, so a dialog (the Compare modal) can pause the tower
   *  and later restore the player's prior speed. */
  getSpeed(): number {
    return this.speed;
  }

  /** Set the colored stats overlay from the picker value ("" = off). An
   *  unrecognized value falls back to off, so a stale/forged value can't push a
   *  bad mode into the renderer. */
  setOverlay(mode: string): void {
    this.engine.overlayMode = (HEATMAP_MODES as readonly string[]).includes(mode) ? (mode as HeatmapMode) : null;
  }

  /** Announce to the screen-reader live region. @internal */
  announce(msg: string): void {
    announceLive(msg);
  }

  // ---- Placement / preview ports (bodies in game/buildPreview.ts) ---------
  // Kept as methods because KeyboardPlay's deps call them on the app, and the
  // gameControllers.integration.test.ts mirror re-implements the same bodies.

  /** @internal */ placeSimpleBuild(kind: FacilityKind, tile: number, floor: number): PlaceOutcome | null { return placeSimpleBuild(this, kind, tile, floor); }
  /** @internal */ isTransportTool(): boolean { return isTransportTool(this); }
  /** @internal */ updateBuildPreview(tile: number, floor: number): void { updateBuildPreview(this, tile, floor); }
  /** @internal */ pickedAt(floor: number, tile: number): Picked | null { return pickedAt(this, floor, tile); }
  /** Refresh the traffic HUD chip; throws if the engine's answer or the draw
   *  fails. Body in game/trafficHud.ts; a method on the instance because the
   *  screenshot tooling (scripts/scenes/features.ts, screenshot-page-ops.ts)
   *  awaits `window.game.refreshTraffic()` to pin the chip. @internal */
  refreshTraffic(): void { refreshTraffic(this); }

  // ---- PWA update ---------------------------------------------------------

  /** Called by the PWA layer the instant a newer build is waiting (wired in the
   *  bootstrap). Body in game/updateFlow.ts; kept a public method because e2e
   *  and the bootstrap call it on the instance. */
  onUpdateAvailable(activate: () => Promise<void>, info?: UpdateInfo): void {
    onUpdateAvailable(this, activate, info);
  }

  // ---- Selection & per-facility editing ----------------------------------

  /** Select whatever Excalibur reported under the pointer (rooms/transports).
   *  @internal */
  selectPicked(p: Picked | null): void {
    if (!p || p.kind === "floor" || p.kind === "lobby") {
      this.clearSelection();
      return;
    }
    // An explicit tap/click is fresh intent: re-arm the hover inspector even
    // for a facility whose card was ✕-dismissed (matters on touch, where no
    // hover stream exists between taps to spend the latch).
    this.inspector.resetLatch();
    this.selected = { type: p.type, id: p.id };
    this.refreshEditor();
  }

  /** The selected unit, looked up again: selection keeps only an id. @internal */
  selectedUnit(): UnitView | undefined {
    if (this.selected?.type !== "unit") return undefined;
    return this.reader.tower.getUnit(this.selected.id);
  }
  /** @internal */ selectedTransport(): TransportView | undefined {
    if (this.selected?.type !== "transport") return undefined;
    return this.reader.tower.getTransport(this.selected.id);
  }

  /** @internal */ clearSelection(): void {
    this.selected = null;
    this.engine.selectedId = null;
    this.ui.hideEditor();
  }

  /** @internal */ refreshEditor(freshDiagnostics = true): void {
    refreshEditorCard(this, freshDiagnostics);
  }

  // ---- Save / load / new --------------------------------------------------

  /** Follow the tower the engine just swapped in (a load, a new tower, an
   *  import, an undo or redo restore): drop what belonged to the old tower and
   *  point the view and the renderer at the new one. `keepHistory` is an
   *  undo or redo restore, which keeps the camera and the undo trail.
   *  @internal */
  followSwap(keepHistory = false): void {
    this.clearSelection();
    // Facility ids restart in a fresh tower. A stale ✕-latch (or anchor) from the old tower
    // would silently mute the inspector on whichever new facility happens to reuse the id.
    this.inspector.clear();
    // Getting Started and the engine's trap report follow the swap too.
    this.onboarding.adoptSim(this.enginePort, keepHistory);
    noteTowerSwap(keepHistory);
    this.shownWin = false;
    this.accMinutes = 0;
    this.lastMealRushDay = { breakfast: -1, lunch: -1, dinner: -1 };
    // A crash report pairs the CURRENT tower's save with these entries, so drop a previous tower's.
    this.frameErrors.length = 0;
    // Read the swapped-in tower now, before the renderer takes it.
    this.reader.update();
    this.lastStar = this.reader.header.star;
    // Renderer caches (scenery seed, walker reach) key on the sim it draws.
    // An undo/redo restore keeps the camera under the player; a real tower
    // swap restores the save's view.
    this.renderSim = newRenderSim(this.enginePort, this.reader);
    this.engine.setSim(this.renderSim, { keepCamera: keepHistory });
    // Rebase the UI log cursor so old entries don't replay as toasts, and
    // refresh the palette to the new star level so it never shows the prior
    // tower's unlock set.
    this.ui.resetLog(hudSource(this));
    this.ui.update(hudSource(this));
    if (!keepHistory) {
      // A *different* tower (New Tower / Load / a slot / Import) invalidates the
      // undo trail; otherwise Undo could resurrect an unrelated old tower and a
      // later autosave persist it. Undo/redo restores keep it.
      this.history.clear();
      this.lastTrafficTier = 0; // the chip's hysteresis starts over on another tower
    }
  }

  /** Swap in a tower a tooling harness built by hand, on either engine. @internal */
  adoptSim(sim: Simulation, preserveHistory = false): void { adoptToolingSim(this, sim, preserveHistory); }
  /** Hand a harness's edits of `sim` to the engine now. @internal */
  syncSim(): void { syncToolingSim(this); }
  /** Tooling: draw the engine again after a hand edit on `sim` reached it. */
  followEdit(shown?: Simulation): void { followToolingEdit(this, shown); }

  // ---- Undo / redo (state + logic live in engine/UndoHistory) -------------
  // Thin delegators kept so the many gesture call sites read unchanged.

  /** @internal */ captureUndo(label: string): void { this.history.capture(label); }
  /** @internal */ commitUndo(): void { this.history.commit(); }
  /** @internal */ discardUndo(): void { this.history.discard(); }
  /** @internal Temporary, with the WASM engine's fallback (#874). */ dropEmptyUndo(sigOf: (snap: string) => string): number { return this.history.dropUnchanged(sigOf); }
  /** @internal Temporary, with the WASM engine's fallback (#874). */ holdClearedRedo(on: boolean): void { this.history.holdClearedRedo = on; }
  /** @internal Temporary, with the WASM engine's fallback (#1126). */ clearUndo(): void { this.history.clear(); }
  undo(): Promise<void> { return this.history.undo(); }
  redo(): Promise<void> { return this.history.redo(); }
}

export { GameApp };

// Bootstrap once the DOM is ready. `bootGame` takes the factory (kept in
// bootstrap.ts) and calls it after this module has fully initialized, so the
// runtime `import { GameApp }` reference in game/ modules resolves via live
// bindings.
void bootGame((tower) => new GameApp(tower)); // async since #729; see bootGame's return note
