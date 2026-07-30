import { Simulation, type HeatmapMode } from "./engine/Simulation";
import { UndoHistory, towerStateSig } from "./engine/UndoHistory";
import { GRID } from "./engine/facilities";
import type { FacilityKind, Transport, Unit } from "./engine/types";
import { TowerEngine, HEATMAP_MODES, type Picked } from "./render/excalibur/TowerEngine";
import { AudioEngine } from "./audio/Audio";
import { SaveGame } from "./storage/SaveGame";
import { loadPrefs, type Prefs } from "./storage/Prefs";
import { type TrafficTier } from "./engine/traffic";
import { UI, type Tool } from "./ui/UI";
import { unitEditorTemplate, transportEditorTemplate } from "./ui/templates/editor";
import { type PlaceOutcome } from "./ui/placement";
import { OnboardingController } from "./ui/Onboarding";
import type { BuildActions } from "./game/buildActions";
import type { EditorActions } from "./game/editorActions";
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
import { SPEEDS } from "./game/frameLoop";
import { placeSimpleBuild, updateBuildPreview, isTransportTool, pickedAt, clearBuildRefusal } from "./game/buildPreview";
import { toggleMute, setVolume, toggleReducedMotion, toggleSteadyClock, isSteadyClock, applyReducedMotion } from "./game/audioPrefs";
import { showStats, showSaves, saveToSlot, loadFromSlot, deleteSlot } from "./game/appModals";
import { updateTraffic } from "./game/trafficHud";
import { onUpdateAvailable } from "./game/updateFlow";
import { bootGame } from "./bootstrap";
import { gameplaySession } from "./analytics";

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
 * `setSpeed` and `updateTraffic` (the last pins the traffic chip before a
 * capture); renaming any needs every consumer updated (TypeScript won't catch it).
 */
class GameApp implements GameAppPorts {
  sim: Simulation;
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
  lastMealRushDay: Record<"breakfast" | "lunch" | "dinner", number> = {
    breakfast: -1,
    lunch: -1,
    dinner: -1,
  };
  /** @internal */ lastUiUpdate = 0;
  /** Throttle for the per-frame error log, so a repeating throw can't spam.
   *  @internal */
  lastTickErrorLog = 0;
  /** The last few tick-guard failures, kept for the crash report (the guard
   *  swallows them to keep the game alive, which otherwise erases the trail).
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

  /** Undo/redo: snapshot-based history (see {@link UndoHistory}). Built in the
   *  constructor once `sim`/`ui` exist; its ports close over `this` so they
   *  always see the live sim across an adoptSim() swap. */
  private history!: UndoHistory;

  constructor() {
    this.canvas = document.getElementById("view") as HTMLCanvasElement;
    // Distinguish "no save" from "save present but unreadable": a corrupt/
    // incompatible autosave must NOT masquerade as a continuable tower (that
    // would offer "Continue", then silently start fresh and let the autosave
    // clobber it). We fall back to a new tower either way, but remember the
    // corruption so the splash stays honest and the player is told (below).
    const boot = SaveGame.loadResult();
    this.saveWasCorrupt = boot.corrupt;
    this.hadReadableSave = boot.sim !== null;
    // Stash the unreadable bytes off the autosave slot before the 30s timer can
    // overwrite them: a save from a *newer* build is only unreadable here, and a
    // future version may recover it. Best-effort, never blocks boot.
    if (boot.corrupt) SaveGame.preserveUnreadable();
    this.sim = boot.sim ?? Simulation.newGame(Date.parse("2024-01-01"));
    // Seed the promotion latch to the boot tower's rating (adoptSim does the same
    // for later swaps). The boot sim is assigned directly, never through
    // adoptSim, so without this a reloaded 2★-6★ tower reads star > lastStar(1)
    // on the first frame and fires a phantom promotion (jingle + star_reached).
    this.lastStar = this.sim.star;
    this.engine = new TowerEngine(this.canvas, this.sim);

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

    // Undo/redo history, ports close over `this` so snapshot / signature /
    // restore always target the *current* sim (adoptSim swaps it).
    this.history = new UndoHistory({
      snapshot: () => JSON.stringify(this.sim.serialize()),
      restore: (snap) => this.adoptSim(Simulation.deserialize(JSON.parse(snap)), true),
      signature: () => towerStateSig(this.sim.tower, this.sim.money),
      notify: (msg) => this.ui.toast(msg, "info"),
    });

    wireEngine(this);
    bindKeys(this);
    // Prime the UI once before the first paint. The palette starts with every
    // facility button present; without this pass a returning player (who skips
    // the splash) would briefly see the full locked catalog before the throttled
    // render loop first hides the locked tools, a visible collapse/reflow.
    this.ui.update(this.sim);
    // Adopt the boot sim's log baseline the same way adoptSim does for later
    // swaps: the boot sim is assigned directly (never through adoptSim), and
    // without this the bulletin history a save carries would sit unrendered
    // after a plain page reload, the restore path players hit most.
    this.ui.resetLog(this.sim);
    void this.engine.start();

    // Accessibility: apply reduced motion now and whenever the OS pref flips.
    applyReducedMotion(this);
    this.reduceMq.addEventListener("change", () => applyReducedMotion(this));

    // First-paint boot flow: onboarding, resume-flag handling, splash, the
    // corrupt-save message, and the autosave timer (see runBootFlow).
    runBootFlow(this, boot.savedAt);
  }

  // ---- UI command ports (GameAppPorts; createUICallbacks delegates here) ----

  getSim(): Simulation {
    return this.sim;
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
    if (!this.onboarding.arm(this.sim)) {
      this.ui.toast("You've already completed Getting Started.", "info");
    }
  }

  renameTower(name: string): void {
    // The original callback was an assignment expression `(name) => (… = name)`;
    // as a void method the returned string is dropped, which no caller used.
    this.sim.tower.towerName = name;
  }

  // Stats + save-slot modal commands, bodies in game/appModals.ts.
  showStats(): void { showStats(this); }
  showSaves(): void { showSaves(this); }
  saveToSlot(slot: number): void { saveToSlot(this, slot); }
  loadFromSlot(slot: number | "auto"): void { loadFromSlot(this, slot); }
  deleteSlot(slot: number): void { deleteSlot(this, slot); }

  /** Set the game speed (index into {@link SPEEDS}): updates the engine's pause
   *  state and the toolbar's active button. The single place the three concerns
   *  are kept in lockstep. */
  setSpeed(s: number): void {
    this.speed = s;
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
  /** Refresh the traffic HUD chip. Body in game/trafficHud.ts; kept a method on
   *  the instance because the screenshot tooling (scripts/scenes/features.ts and
   *  screenshot-page-ops.ts) calls `window.game.updateTraffic()` to pin the chip
   *  into its jammed state before capturing. @internal */
  updateTraffic(): void { updateTraffic(this); }

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

  /** The currently selected unit/transport, re-looked-up from the live tower
   *  (selection stores only an id, the entity may have been removed). @internal */
  selectedUnit(): Unit | undefined {
    if (this.selected?.type !== "unit") return undefined;
    return this.sim.tower.getUnit(this.selected.id);
  }
  /** @internal */ selectedTransport(): Transport | undefined {
    if (this.selected?.type !== "transport") return undefined;
    return this.sim.tower.getTransport(this.selected.id);
  }

  /** @internal */ clearSelection(): void {
    this.selected = null;
    this.engine.selectedId = null;
    this.ui.hideEditor();
  }

  /** @internal */ refreshEditor(): void {
    if (!this.selected) return;
    // The template is a pure function of (sim, entity, mobile); lit's binding
    // diff patches only the values that changed since the last pump, so the
    // buttons and rename input keep their identity across stat ticks, and a
    // shape change (a condo sells and loses its price adjuster, a cinema
    // finishes construction and gains its "Now showing" row, the viewport
    // crosses the mobile breakpoint) restructures just the affected rows.
    // Mobile folds the inspector card's diagnostics into the editor (one
    // panel, no hover).
    const mobile = this.mobileMq.matches;
    if (this.selected.type === "unit") {
      const u = this.selectedUnit();
      if (!u) return this.clearSelection();
      this.engine.selectedId = u.id;
      this.ui.renderEditor(unitEditorTemplate(this.sim, u, mobile));
    } else {
      const t = this.selectedTransport();
      if (!t) return this.clearSelection();
      this.engine.selectedId = t.id; // outlines the shaft + shows extend arrows
      this.ui.renderEditor(transportEditorTemplate(this.sim, t, mobile));
    }
  }

  // ---- Save / load / new --------------------------------------------------

  /** Swap in a freshly loaded/created simulation and point the engine at it.
   *  @internal */
  adoptSim(sim: Simulation, preserveHistory = false): void {
    // Undo/redo restore (the only preserveHistory path) keeps the live bridging toggle: it's a SETTING, not a build step, so undoing a BUILD must not flip it.
    if (preserveHistory) sim.autoBridge = this.sim.autoBridge;
    this.sim = sim;
    this.clearSelection();
    // Facility ids restart in a fresh tower. A stale ✕-latch (or anchor)
    // from the old tower would silently mute the inspector on whichever new
    // facility happens to reuse the id.
    this.inspector.clear();
    // A live Getting Started session must follow the swap, or it keeps
    // ticking the abandoned sim and teaches that tower's next step.
    this.onboarding.adoptSim(sim);
    this.shownWin = false;
    this.lastStar = sim.star;
    this.accMinutes = 0;
    this.lastMealRushDay = { breakfast: -1, lunch: -1, dinner: -1 };
    // A crash report pairs the CURRENT tower's save with these entries, so drop a previous tower's.
    this.frameErrors.length = 0;
    // An undo/redo restore keeps the camera under the player (preserveHistory is
    // only ever true on that path); a real tower swap restores the save's view.
    this.engine.setSim(sim, { keepCamera: preserveHistory });
    // Rebase the UI log cursor onto the new tower's log so its old entries don't
    // replay as toasts and its next entry isn't skipped against a stale cursor.
    this.ui.resetLog(sim);
    // Refresh the palette to the swapped-in tower's star level immediately, so a
    // load/new-tower into a different star doesn't briefly show the prior tower's
    // unlock set until the next throttled render tick.
    this.ui.update(sim);
    if (!preserveHistory) {
      // A *different* tower (New Tower / Load / a slot / Import) invalidates the
      // undo trail; otherwise Undo could resurrect an unrelated old tower and a
      // later autosave persist it. Undo/redo restores pass preserveHistory.
      this.history.clear();
    }
  }

  // ---- Undo / redo (state + logic live in engine/UndoHistory) -------------
  // Thin delegators kept so the many gesture call sites read unchanged.

  /** @internal */ captureUndo(label: string): void { this.history.capture(label); }
  /** @internal */ commitUndo(): void { this.history.commit(); }
  /** @internal */ discardUndo(): void { this.history.discard(); }
  undo(): void { this.history.undo(); }
  redo(): void { this.history.redo(); }
}

export { GameApp };

// Bootstrap once the DOM is ready. `bootGame` takes the factory (kept in
// bootstrap.ts) and calls it after this module has fully initialized, so the
// runtime `import { GameApp }` reference in game/ modules resolves via live
// bindings.
bootGame(() => new GameApp());
