import { Simulation } from "./engine/Simulation";
import { UndoHistory, towerStateSig } from "./engine/UndoHistory";
import { FACILITIES, GRID, facilityFloors, isFixedSpanTransport } from "./engine/facilities";
import type { FacilityKind, Transport, Unit } from "./engine/types";
import { TowerEngine, HEATMAP_MODES, type Picked } from "./render/excalibur/TowerEngine";
import type { HeatmapMode } from "./engine/Simulation";
import { AudioEngine } from "./audio/Audio";
import { SaveGame } from "./storage/SaveGame";
import { loadPrefs, savePrefs, reducedMotionActive, type Prefs } from "./storage/Prefs";
import { trafficTier, TRAFFIC_BOUNDS, TRAFFIC_LABELS, trafficGlyph, type TrafficTier } from "./engine/traffic";
import { paceFactor } from "./engine/timePacing";
import { UI, type Tool } from "./ui/UI";
import { classifyGesture, isPaintKind } from "./game/gesture";
import { unitEditorTemplate, transportEditorTemplate } from "./ui/templates/editor";
import { buildRefusalTemplate } from "./ui/templates/inspector";
import { brushTiles, snapX, type PlaceOutcome } from "./ui/placement";
import { statsTemplate } from "./ui/templates/stats";
import { OnboardingController } from "./ui/Onboarding";
import { BuildActions } from "./game/buildActions";
import { EditorActions } from "./game/editorActions";
import { SaveLoad, RESUME_AFTER_RECOVERY_KEY } from "./game/saveLoad";
import { attemptContextRecovery } from "./game/contextRecovery";
import { decideMealRush } from "./game/mealRush";
import { InspectorController } from "./game/inspector";
import { createUICallbacks, type GameAppPorts } from "./game/uiCallbacks";
import { KeyboardPlay } from "./game/keyboardPlay";
import { registerPWA, type UpdateInfo } from "./pwa";
import { resolveBootScreen } from "./bootScreen";
import { CRASH_SCREEN_ID, showCrashScreen } from "./ui/crashScreen";
import type { FrameErrorEntry } from "./game/crashReport";

/** Game speeds → in-game minutes advanced per real second. */
const SPEEDS = [0, 10, 30, 120];

/** Hard cap on owed-but-unsimulated minutes carried between frames. At the
 *  fastest speed (120 min/s) a device that can't simulate that fast in real
 *  time accrues debt every frame; without a cap each frame does more work than
 *  the last until frames run seconds long (see the clamp in update()). 30
 *  minutes is 15 ideal frames of fastest-speed debt (2 sim-minutes per 60fps
 *  frame), generous headroom for hitches, while keeping the largest single
 *  frame's sim work bounded near two 20-minute tick chunks. */
const MAX_CATCHUP_MINUTES = 30;

/** Ring-buffer depth for tick-guard failures included in a crash report. */
const MAX_FRAME_ERRORS = 5;

/** Compile-time app version (see vite.config.ts `define`); "dev" outside a build. */
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/** sessionStorage key: stamped with `Date.now()` right before an "Update now"
 *  reload so the fresh build greets the player with "Updated …" instead of
 *  "Welcome back". sessionStorage survives the same-tab reload; the timestamp
 *  lets the boot ignore a stale flag left by an `updateSW` that resolved without
 *  ever reloading (so an unrelated later reload is never mislabeled). */
const RESUME_AFTER_UPDATE_KEY = "vc-resume-after-update";
/** An app-initiated resume reload (an "Update now" reload or a WebGL context-loss
 *  recovery reload) fires within a second or two of its trigger. Only honor the
 *  resume flag (skip the splash, greet accordingly) inside this window, so a stale
 *  flag left by a trigger that resolved without actually reloading can't skip a
 *  later boot's splash. Shared by both resume flags. */
const RESUME_RELOAD_MAX_AGE_MS = 30_000;

/**
 * The game controller. Excalibur (via {@link TowerEngine}) owns the render
 * loop, scene, camera, panning, zooming and pointer input; this class supplies
 * the tool semantics through the engine's controller hooks, ticks the
 * simulation from the engine's per-frame `onUpdate`, and drives the DOM UI.
 *
 * `window.game` surface: e2e/helpers.ts, e2e/visual.spec.ts and
 * scripts/screenshots.mjs reach this instance at runtime — the public fields
 * (sim, engine, speed, grid) plus, via any-cast, `selectPicked`, `selected`
 * and `refreshEditor`. Renaming or moving those requires updating all three
 * consumers; TypeScript won't catch it.
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

  private canvas: HTMLCanvasElement;
  private accMinutes = 0;
  /** Last day each meal-rush bulletin fired (transient, like the log). Kept
   *  per meal so a save reloaded mid-day does not spam an already-fired kind. */
  private lastMealRushDay: Record<"breakfast" | "lunch" | "dinner", number> = {
    breakfast: -1,
    lunch: -1,
    dinner: -1,
  };
  private lastUiUpdate = 0;
  /** Throttle for the per-frame error log, so a repeating throw can't spam. */
  private lastTickErrorLog = 0;
  /** The last few tick-guard failures, kept for the crash report (the guard
   *  swallows them to keep the game alive, which otherwise erases the trail). */
  private frameErrors: FrameErrorEntry[] = [];
  private shownWin = false;
  /** A save existed at boot but couldn't be read (corrupt / incompatible). */
  private saveWasCorrupt = false;
  /**
   * Whether a *readable* save existed at boot — snapshotted once, up front, so
   * the splash and the "new tower" confirm agree on reality. Reading it live
   * from `SaveGame.hasSave()` would count a corrupt save (wrong for both) and
   * could flip mid-session if another tab writes the slot.
   */
  private hadReadableSave = false;
  /** Whether the emergency-choice modal is currently open. */
  private shownChoice = false;
  /** A newer build is waiting: skips the worker + reloads onto it. Held until
   *  the player chooses "Update now" (via the modal or the toolbar chip); null
   *  when the app is already on the latest build. */
  private pendingUpdate: (() => Promise<void>) | null = null;
  /** Incoming build's identity/notes for the current pending update, shown in
   *  the prompt. Null when unknown (fetch failed) — the modal then omits it. */
  private pendingUpdateInfo: UpdateInfo | null = null;
  /** Whether the update modal is currently open — freezes the sim while it's up
   *  (same soft-freeze the emergency modal uses) so a player reading it can't
   *  lose game-hours at high speed. */
  private shownUpdate = false;
  /** Whether the update modal has already auto-surfaced for the current pending
   *  build, so it pops at most once on its own; after that the toolbar chip is
   *  the way back in. Reset when a genuinely newer build arrives. */
  private updatePromptShown = false;
  /** Last star rating we played a promotion jingle for (so 2★–5★ promotions
   * each get the jingle FR-58 promises, not only the final TOWER win). */
  private lastStar = 1;
  /** In-progress transport drag (anchor tile/floor). */
  private transportStart: { x: number; floor: number } | null = null;
  /** Deferred touch paint-tool press (tile/floor). On touch, a paint strip is
   *  NOT laid on the press — the second finger of a two-finger pan/zoom lands as
   *  its own pointerdown, and a strip committed here would be a paid-for tile the
   *  pinch path never rolls back. The strip is laid on the first move (drag) or
   *  the release (tap), by which point a two-finger gesture has already cancelled. */
  private paintAnchor: { tile: number; floor: number } | null = null;
  /** Currently selected facility for the edit panel. */
  private selected: { type: "unit" | "transport"; id: number } | null = null;
  /** World cell the hover inspector tooltip is describing, so it can be
   *  anchored to that spot on screen and ride the tower when the camera moves. */
  private inspectAnchor: { x: number; floor: number } | null = null;
  /** True when the inspector card is currently being driven by the build-preview
   *  refusal path (Modern-only hover tip), rather than the InspectorController.
   *  Kept so `updateBuildPreview` can clear its own tip when the preview turns
   *  valid or the tool changes, without stomping a legit inspector card. */
  private buildRefusalShowing = false;
  /** True only on the PHONE tier — MUST mirror the phone `@media` query in
   *  styles.css (`max-width: 767px`, or a short landscape screen
   *  `max-width: 1023px and max-height: 599px`). The tablet tier uses the docked
   *  desktop-style layout, so it must read as NON-mobile here (world-anchored
   *  editor/inspector popovers, desktop splash) to stay consistent with the CSS.
   *  Cached so per-frame anchoring doesn't construct a MediaQueryList each tick. */
  private mobileMq = window.matchMedia(
    "(max-width: 767px), (max-width: 1023px) and (max-height: 599px)",
  );
  /** First-run splash + onboarding (pure DOM chrome). */
  private onboarding!: OnboardingController;
  /** Whether the panels currently carry an inline anchor (so the mobile branch
   *  only resets them once, not every frame). */
  private panelsAnchored = false;
  /** Per-device accessibility preferences (localStorage, off the save). */
  private prefs: Prefs = loadPrefs();
  /** Trailing debounce for volume-drag pref writes: slider input events fire
   *  at pointer-move rate, and a synchronous localStorage write per tick is
   *  avoidable main-thread churn during the gain ramp. A short trailing delay
   *  is durable enough for a device-local preference. */
  private prefsSaveTimer: number | null = null;
  private reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** Last shown traffic tier (for boundary hysteresis, so the chip doesn't flicker). */
  private lastTrafficTier: TrafficTier = 0;

  /** Controller modules (src/game/): each takes a narrow deps slice of this
   *  app spine, never the GameApp itself (see the modules' own doc comments). */
  private readonly build: BuildActions;
  // editor/saveLoad/inspector are exposed (readonly) as GameAppPorts for
  // createUICallbacks; build/keyboard stay private (the factory never needs
  // them, and handleSelectTool reaches them internally).
  readonly editor: EditorActions;
  readonly saveLoad: SaveLoad;
  readonly inspector: InspectorController;
  private readonly keyboard: KeyboardPlay;

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
    // future version may recover it. Best-effort — never blocks boot.
    if (boot.corrupt) SaveGame.preserveUnreadable();
    this.sim = boot.sim ?? Simulation.newGame(Date.parse("2024-01-01"));
    this.engine = new TowerEngine(this.canvas, this.sim);

    // Restore persisted audio prefs onto the facade BEFORE any UI wiring or
    // gesture listener exists, so the very first interaction (which starts the
    // engine) already carries the player's mute/volume choices.
    this.audio.setMuted(this.prefs.muted === true);
    this.audio.setVolumes(this.prefs.musicVolume ?? 1, this.prefs.sfxVolume ?? 1);

    // Controller modules — built BEFORE the UI because the UI constructor's
    // initial selectTool fires onSelectTool synchronously (which resets the
    // keyboard anchor), so `this.keyboard` must already exist. Their UI-facing
    // deps are lazy closures for the same reason: `this.ui` is assigned just
    // below. Every module re-asks getSim() so an adoptSim() swap is invisible.
    this.build = new BuildActions({
      getSim: () => this.sim,
      ui: { toast: (text, kind) => this.ui.toast(text, kind) },
      audio: this.audio,
      selectedId: () => this.selected?.id ?? null,
      clearSelection: () => this.clearSelection(),
    });
    this.inspector = new InspectorController({
      getSim: () => this.sim,
      ui: { showInspector: (html) => this.ui.showInspector(html) },
      setAnchor: (anchor) => (this.inspectAnchor = anchor),
    });
    this.editor = new EditorActions({
      getSim: () => this.sim,
      ui: {
        toast: (text, kind) => this.ui.toast(text, kind),
        showStopsDialog: (title, floors, onToggle) => this.ui.showStopsDialog(title, floors, onToggle),
        showBatchPricingDialog: (ctx, cb) => this.ui.showBatchPricingDialog(ctx, cb),
      },
      audio: this.audio,
      build: this.build,
      selected: () => this.selected,
      selectedUnit: () => this.selectedUnit(),
      selectedTransport: () => this.selectedTransport(),
      clearSelection: () => this.clearSelection(),
      refreshEditor: () => this.refreshEditor(),
      captureUndo: (label) => this.captureUndo(label),
      commitUndo: () => this.commitUndo(),
      announce: (msg) => this.announce(msg),
    });
    this.saveLoad = new SaveLoad({
      getSim: () => this.sim,
      getView: () => this.engine.viewState(),
      adoptSim: (sim) => this.adoptSim(sim),
      ui: {
        toast: (text, kind) => this.ui.toast(text, kind),
        downloadFile: (filename, contents) => this.ui.downloadFile(filename, contents),
        showImportReport: (report, cb) => this.ui.showImportReport(report, cb),
        showExportReport: (report, cb) => this.ui.showExportReport(report, cb),
      },
      // SaveLoad owns the crash shape and the reload action; the app supplies
      // the context only it has (version, the live sim, the frame-error ring).
      showCrashScreen: (info) =>
        showCrashScreen({
          ...info,
          version: APP_VERSION,
          speed: this.speed,
          getSim: () => this.sim,
          frameErrors: this.frameErrors,
        }),
      attemptGraphicsRecovery: (done) =>
        attemptContextRecovery(
          {
            onRestored: (cb) => {
              // Subscribe on the engine that lost its context. Unsubscribe
              // clears that same instance (this.engine points at the fresh
              // one after a rebuild).
              const lost = this.engine;
              lost.onContextRestored = cb;
              return () => {
                lost.onContextRestored = null;
              };
            },
            rebuild: () => this.rebuildEngine(),
          },
          done,
        ),
      armOnboarding: () => {
        this.onboarding.arm(this.sim);
      },
    });
    this.keyboard = new KeyboardPlay({
      getSim: () => this.sim,
      engine: () => this.engine,
      audio: this.audio,
      ui: { toast: (text, kind) => this.ui.toast(text, kind) },
      build: this.build,
      tool: () => this.tool,
      isTransportTool: () => this.isTransportTool(),
      announce: (msg) => this.announce(msg),
      pickedAt: (floor, tile) => this.pickedAt(floor, tile),
      selectPicked: (p) => this.selectPicked(p),
      placeSimpleBuild: (kind, tile, floor) => this.placeSimpleBuild(kind, tile, floor),
      updateBuildPreview: (tile, floor) => this.updateBuildPreview(tile, floor),
      captureUndo: (label) => this.captureUndo(label),
      commitUndo: () => this.commitUndo(),
    });

    // The UI command callbacks live in createUICallbacks (src/game/uiCallbacks.ts),
    // a thin delegation layer over this app spine, so the command boundary the UI
    // depends on sits in one place a later declarative UI layer can rebind. Built
    // here, AFTER the controllers above, because the UI ctor's initial selectTool
    // fires onSelectTool synchronously (which needs this.keyboard/this.build).
    this.ui = new UI(createUICallbacks(this));

    // Undo/redo history — ports close over `this` so snapshot / signature /
    // restore always target the *current* sim (adoptSim swaps it).
    this.history = new UndoHistory({
      snapshot: () => JSON.stringify(this.sim.serialize()),
      restore: (snap) => this.adoptSim(Simulation.deserialize(JSON.parse(snap)), true),
      signature: () => towerStateSig(this.sim.tower, this.sim.money),
      notify: (msg) => this.ui.toast(msg, "info"),
    });

    this.wireEngine();
    this.bindKeys();
    // Prime the UI once before the first paint. The palette starts with every
    // facility button present; without this pass a returning player (who skips
    // the splash) would briefly see the full locked catalog before the throttled
    // render loop first hides the locked tools — a visible collapse/reflow.
    this.ui.update(this.sim);
    // Adopt the boot sim's log baseline the same way adoptSim does for later
    // swaps: the boot sim is assigned directly (never through adoptSim), and
    // without this the bulletin history a save carries would sit unrendered
    // after a plain page reload, the restore path players hit most.
    this.ui.resetLog(this.sim);
    void this.engine.start();

    // Accessibility: apply reduced motion now and whenever the OS pref flips.
    this.applyReducedMotion();
    this.reduceMq.addEventListener("change", () => this.applyReducedMotion());

    // First-run splash + onboarding (chrome only; the engine is untouched).
    this.onboarding = new OnboardingController({
      mq: this.mobileMq,
      showHelp: () => this.ui.showHelp(),
      pauseForSplash: (paused) => this.setSpeed(paused ? 0 : 1),
      chime: () => this.audio.sfx("promote"),
    });
    // The title screen loads on every boot, so its branding, the attribution
    // line, and the Continue-vs-New-Tower (rule-set) choice greet the player each
    // launch. The exceptions are the two app-initiated resume reloads: the
    // post-"Update now" reload (its modal promised "keep playing") and the WebGL
    // context-loss recovery reload (a GPU crash we auto-recover from). Both drop
    // the player straight back into their tower (paused), skipping the splash.
    // Continue (or a resume drop-in) boots PAUSED either way: time must never
    // advance while the player reacquires their view and selection, which reset
    // on reload (the same "don't lose game-hours" rule the update modal's freeze
    // enforces).
    //
    // Read+clear both resume flags UNCONDITIONALLY, before the branch: a resume
    // reload can land on an unreadable save (the splash branch below), and the
    // flags must still be consumed there so a stale one can't mislabel a later
    // boot.
    let justUpdated = false;
    try {
      const stamp = Number(sessionStorage.getItem(RESUME_AFTER_UPDATE_KEY));
      sessionStorage.removeItem(RESUME_AFTER_UPDATE_KEY);
      justUpdated = Number.isFinite(stamp) && Date.now() - stamp < RESUME_RELOAD_MAX_AGE_MS;
    } catch {
      /* sessionStorage can throw in private mode — treat it as not-an-update */
    }
    let justRecovered = false;
    try {
      const stamp = Number(sessionStorage.getItem(RESUME_AFTER_RECOVERY_KEY));
      sessionStorage.removeItem(RESUME_AFTER_RECOVERY_KEY);
      justRecovered = Number.isFinite(stamp) && Date.now() - stamp < RESUME_RELOAD_MAX_AGE_MS;
    } catch {
      /* sessionStorage can throw in private mode, so treat it as not-a-recovery */
    }
    if (resolveBootScreen({ hadReadableSave: this.hadReadableSave, justUpdated, justRecovered }) === "resume") {
      // An app-initiated resume reload (update or GPU-crash recovery): drop the
      // player straight back into their tower, skipping the title screen. Land
      // paused; the ▶ Play control is the single "resume", so time must not
      // advance while the player reacquires their view and selection, which reset
      // on reload (the same rule the update modal's freeze enforces). The update
      // reload gets the "Updated …" greeting; a recovery reload gets the plain
      // "Welcome back" (a successful GPU recovery is deliberately undramatic).
      this.setSpeed(0);
      this.ui.toast(
        justUpdated ? `Updated to v${APP_VERSION}. Press ▶ to resume.` : "Welcome back. Press ▶ to resume.",
        "info",
      );
    } else {
      // Every other boot (cold reopen, a manual reload, first run, or a
      // corrupt/unreadable save) shows the title screen. `hasSave` reflects
      // READABILITY, not mere presence, so the splash only promises "Continue"
      // when a real tower sits behind it, never over a fresh boot sim.
      const hasSave = this.hadReadableSave;
      this.onboarding.showSplash({
        hasSave,
        onContinue: () => {
          // Only rendered when `hasSave`. teardownSplash() resumes the engine to
          // play speed, so re-pause: a returning player lands back in their tower
          // paused, the ▶ Play control being the single resume (as in the reload
          // path above).
          this.setSpeed(0);
          this.ui.toast("Welcome back. Press ▶ to resume.", "info");
        },
        onNewTower: (dismiss) => {
          // The rule-set picker (Classic vs Modern) warns that New Tower abandons
          // the current tower only when one is continuable (`hasSave`); on a
          // corrupt / first-run boot there's nothing to lose, so it shows no
          // warning.
          this.ui.newTowerModal({
            hasSave,
            onFound: (mode, modernCalendar) => {
              dismiss();
              this.saveLoad.newGame(mode, modernCalendar);
            },
          });
        },
      });
    }

    // Tell the player plainly when their save couldn't be read, rather than
    // dropping them into a fresh tower with no explanation. Goes to the bulletin
    // (persists) and pops as a toast on the first UI update after the splash.
    if (this.saveWasCorrupt) {
      // The corrupt flag can coexist with a loaded tower: an unreadable
      // Verticopolis autosave with a healthy legacy save behind it loads the
      // legacy tower, and the message must not claim a fresh start.
      this.sim.emit(
        this.hadReadableSave
          ? "⚠️ Your latest autosave couldn't be read, so an older saved tower was loaded instead."
          : "⚠️ Your saved tower couldn't be read. It may be corrupted or from a newer version. Starting a new tower.",
        "bad",
      );
    }

    // Autosave periodically — but never while the first-run splash is up, so an
    // idle first visit can't persist the throwaway boot sim (which would flip
    // hasSave() true for a tower the player never started).
    window.setInterval(() => {
      if (!document.getElementById("splash")) void this.saveLoad.autosave();
    }, 30000);
  }

  // ---- App-spine helpers the controllers borrow --------------------------

  // ---- UI command ports (GameAppPorts; createUICallbacks delegates here) ----
  // The bodies below used to sit inline in the object literal the constructor
  // passed to `new UI(...)`; moved here so the private state they touch (tool,
  // prefs, paint/transport anchors, engine previews) stays inside GameApp.

  getSim(): Simulation {
    return this.sim;
  }

  /** Switch the active build/inspect tool, dropping any in-flight gesture. */
  handleSelectTool(tool: Tool): void {
    this.tool = tool;
    this.keyboard.resetAnchor(); // don't carry a pending transport anchor across tools
    // Drop any in-flight paint gesture too: onActionUp/onActionMove read the
    // LIVE tool, so a press-then-switch-then-release would stamp the new
    // kind's strip at the old press point.
    this.paintAnchor = null;
    this.build.clearPaint();
    // A transport anchor abandoned by a pinch (the pinch paths never fire
    // onActionUp) must not linger either: updateCoastClear() treats it as a
    // live gesture, which would keep the update prompt suppressed all session.
    this.transportStart = null;
    this.engine.preview = null;
    this.engine.transportPreview = null;
    // Drop a build-refusal tooltip if one was up, so a tool switch doesn't
    // leave a stale Modern hover tip pinned to the old preview cell.
    this.clearBuildRefusal();
  }

  /** Toggle mute, persist it, and return the new muted state. */
  toggleMute(): boolean {
    this.audio.start();
    this.audio.setMuted(!this.audio.muted);
    this.prefs.muted = this.audio.muted;
    savePrefs(this.prefs);
    return this.audio.muted;
  }

  /** Set one audio channel's level (0..1) and persist it. */
  setVolume(kind: "music" | "sfx", value: number): void {
    // A slider drag is a user gesture, so it may be the interaction that
    // starts the engine (a not-yet-started facade also covers the
    // retry-after-failed-load path). Once running, skip the call: input
    // events arrive at pointer-move rate and each start() would allocate
    // a fresh resume() promise for nothing.
    if (!this.audio.started) this.audio.start();
    this.audio.setVolumes(
      kind === "music" ? value : this.audio.musicVolume,
      kind === "sfx" ? value : this.audio.sfxVolume,
    );
    // Read back the facade's clamped values so prefs never store junk.
    this.prefs.musicVolume = this.audio.musicVolume;
    this.prefs.sfxVolume = this.audio.sfxVolume;
    this.schedulePrefsSave();
  }

  /** Toggle reduced motion, persist it, and return the new effective state. */
  toggleReducedMotion(): boolean {
    this.prefs.reducedMotion = !this.prefs.reducedMotion;
    savePrefs(this.prefs);
    this.applyReducedMotion();
    return reducedMotionActive(this.prefs, this.reduceMq.matches);
  }

  /** Toggle the steady-clock pref and return the new steady state. */
  toggleSteadyClock(): boolean {
    this.prefs.steadyClock = !this.prefs.steadyClock;
    savePrefs(this.prefs);
    return this.prefs.steadyClock;
  }

  /** The live steady-clock state (the same in-memory prefs the game loop reads). */
  isSteadyClock(): boolean {
    return this.prefs.steadyClock === true;
  }

  /** Replay the Getting Started onboarding, unless the splash is up. */
  replayOnboarding(): void {
    if (document.getElementById("splash")) return; // never arm behind the splash
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

  showStats(): void {
    this.ui.showStats(statsTemplate(this.sim));
  }

  showSaves(): void {
    this.ui.showSaves(SaveGame.listSlots());
  }

  /** Save the live tower into a manual slot, stamping the live camera view. */
  saveToSlot(slot: number): void {
    // Manual slots carry the view too: stamp the live camera the same way
    // SaveLoad does for the autosave and exports.
    this.sim.view = this.engine.viewState();
    SaveGame.saveSlot(slot, this.sim);
    this.ui.toast(`Saved to slot ${slot}.`, "good");
  }

  /** Load a manual slot (or the autosave) and adopt it as the live tower. */
  loadFromSlot(slot: number | "auto"): void {
    const loaded = slot === "auto" ? SaveGame.load() : SaveGame.loadSlot(slot);
    if (loaded) {
      this.adoptSim(loaded);
      this.ui.toast("Tower loaded.", "good");
    } else {
      this.ui.toast("That slot is empty or corrupt.", "bad");
    }
  }

  deleteSlot(slot: number): void {
    SaveGame.deleteSlot(slot);
    this.ui.toast(`Deleted slot ${slot}.`, "info");
  }

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

  /** Announce to the screen-reader live region. */
  private announce(msg: string): void {
    const el = document.getElementById("a11y-live");
    if (el) el.textContent = msg;
  }

  /** The inspectable/bulldozable entity at a cell (room or transport), if any. */
  private pickedAt(floor: number, tile: number): Picked | null {
    const u = this.sim.tower.unitAt(floor, tile);
    if (u && u.kind !== "floor" && u.kind !== "lobby") return { type: "unit", id: u.id, kind: u.kind };
    const t = this.sim.tower.transports.find(
      // Use the shaft's OWN stored width (matches render + overlap checks), not
      // the catalog width — an old save keeps its stored width, so after a canon
      // width change (e.g. stairs 4→8) the catalog would give a phantom click zone.
      (tr) => tile >= tr.x && tile < tr.x + tr.width && floor >= tr.bottom && floor <= tr.top,
    );
    return t ? { type: "transport", id: t.id, kind: t.kind } : null;
  }

  /** Color-blind-safe traffic cue: word + shape-coded bar glyph (never color
   *  alone), driven by the tower's PEAK per-floor congestion — its busiest
   *  populated-and-served floor — so it matches the congestion overlay legend and
   *  moves as real congestion develops. Boundary hysteresis stops flicker; above
   *  Smooth it also names the worst floor (e.g. "Backed up · 42F") so the player
   *  knows *where* to look. */
  private updateTraffic(): void {
    // One pass over the spatial map: the ratio drives the tier, the floor names
    // the hotspot — fetched together so this ~6 Hz loop doesn't rebuild the map
    // twice per frame on a large tower.
    const { ratio: cong, floor: hotspot } = this.sim.peakCongestionHotspot();
    const B: readonly number[] = TRAFFIC_BOUNDS; // single source shared with trafficTier() — can't desync
    const raw = trafficTier(cong);
    if (raw > this.lastTrafficTier && cong >= B[this.lastTrafficTier] + 0.03) this.lastTrafficTier = raw;
    else if (raw < this.lastTrafficTier && cong <= B[this.lastTrafficTier - 1] - 0.03) this.lastTrafficTier = raw;
    const tier = this.lastTrafficTier;
    const word = TRAFFIC_LABELS[tier];
    // Above Smooth, surface the hotspot floor (something the 1994 original could
    // never do). The engine hands us the floor number (null = no hotspot); we
    // format the label. Populated floors are always above ground, so `NF` is the
    // right form for every reachable case.
    const floor = tier > 0 ? hotspot : null;
    // The floor rides its own span (styled as a de-emphasized footnote) so a long
    // "Backed up · 100F" never competes with the tier word or wraps the fixed HUD
    // cell to a second line. The separator lives inside the suffix so Smooth shows
    // no orphan "· ". The full sentence still goes to aria-label for readers.
    const floorText = floor !== null ? ` · ${floor}F` : "";
    const aria = floor !== null ? `Traffic: ${word}, worst on floor ${floor}` : `Traffic: ${word}`;
    const glyphEl = document.getElementById("traffic-glyph");
    const labelEl = document.getElementById("traffic-label");
    const floorEl = document.getElementById("traffic-floor");
    const wrapEl = document.getElementById("traffic");
    if (glyphEl && glyphEl.textContent !== trafficGlyph(tier)) glyphEl.textContent = trafficGlyph(tier);
    const labelChanged = labelEl != null && labelEl.textContent !== word;
    const floorChanged = floorEl != null && floorEl.textContent !== floorText;
    if (labelChanged) labelEl!.textContent = word;
    if (floorChanged) floorEl!.textContent = floorText;
    if (labelChanged || floorChanged) {
      wrapEl?.setAttribute("aria-label", aria);
      wrapEl?.classList.toggle("traffic-warn", tier >= 2); // red is a redundant cue, not the only one
    }
  }

  /** Persist prefs after a short trailing delay (see {@link prefsSaveTimer}).
   *  Single-shot writes (the mute toggle, the accessibility buttons) keep
   *  calling savePrefs directly; this is only for high-frequency sources.
   *  A pagehide flush (wireEngine) covers unload/reload inside the window. */
  private schedulePrefsSave(): void {
    if (this.prefsSaveTimer !== null) window.clearTimeout(this.prefsSaveTimer);
    this.prefsSaveTimer = window.setTimeout(() => {
      this.prefsSaveTimer = null;
      savePrefs(this.prefs);
    }, 200);
  }

  /** Write a pending debounced pref save NOW. Wired to pagehide so a slider
   *  adjustment inside the debounce window survives a tab close or any
   *  reload (including the app's own update-flow and recovery reloads). */
  private flushPrefsSave(): void {
    if (this.prefsSaveTimer === null) return;
    window.clearTimeout(this.prefsSaveTimer);
    this.prefsSaveTimer = null;
    savePrefs(this.prefs);
  }

  /** Push the effective reduced-motion state (OS pref OR user pref) to the DOM
   *  (a class CSS keys off) and the engine (freezes ambient canvas motion). */
  private applyReducedMotion(): void {
    const on = reducedMotionActive(this.prefs, this.reduceMq.matches);
    document.documentElement.classList.toggle("reduce-motion", on);
    this.engine.setReducedMotion(on);
  }

  /**
   * Swap in a fresh renderer after a WebGL context loss, once the browser has
   * restored GPU access (see attemptContextRecovery). The simulation and the
   * whole DOM shell stay put; only the Excalibur engine and its canvas are
   * replaced. Resolves when the new engine is running with the player's
   * camera, selection, overlay, speed and motion prefs carried over.
   */
  private rebuildEngine(): Promise<void> {
    // Read the CPU-side view state before tearing the old engine down.
    // viewState always stamps zoom; the default only satisfies the save
    // schema's optional field (a TDT import carries no zoom).
    const { tile, floor, zoom = 0.9 } = this.engine.viewState();
    const overlay = this.engine.overlayMode;
    // Silence the dying engine BEFORE dispose: its canvas can outlive the
    // swap (a detached canvas keeps its restored GL context), and a later
    // eviction of that zombie context would otherwise fire onContextLost and
    // throw a crash screen over a perfectly healthy rebuilt game.
    const old = this.engine;
    old.onContextLost = null;
    old.onContextRestored = null;
    old.dispose();
    // A canvas whose WebGL context was lost hands the same dead context back
    // from getContext() forever, so the rebuild needs a fresh element.
    // cloneNode copies the id and attributes but no listeners; wireEngine
    // re-binds ours below, and the old element's listeners die with it.
    const oldCanvas = this.canvas;
    const fresh = oldCanvas.cloneNode(false) as HTMLCanvasElement;
    oldCanvas.replaceWith(fresh);
    // Release the zombie context's GPU hold. The restore that triggered this
    // rebuild revived the OLD context too; explicitly losing it frees its
    // GPU memory now and keeps recovered sessions from creeping toward the
    // browser's per-page context cap. An extension-forced loss never
    // auto-restores, and the engine's hooks were nulled above, so this can't
    // re-enter the recovery flow.
    try {
      (oldCanvas.getContext("webgl2") as WebGL2RenderingContext | null)
        ?.getExtension("WEBGL_lose_context")
        ?.loseContext();
    } catch {
      /* best effort; some drivers refuse the extension */
    }
    // The loss severed any in-flight gesture (the old canvas's pointerup
    // died with it), so drop gesture state that would otherwise linger: a
    // stale transportStart suppresses the update prompt session-long, and a
    // stale paint anchor would extend the next touch drag across the gap.
    this.paintAnchor = null;
    this.transportStart = null;
    this.build.clearPaint();
    this.commitUndo(); // close the severed gesture's pending capture (no-op when clean)
    this.canvas = fresh;
    this.engine = new TowerEngine(fresh, this.sim);
    if (!this.engine.rendersWithWebGL()) {
      // Excalibur silently fell back to Canvas2D: the GPU is still wedged.
      // That mode is degraded AND blind to further context losses, so treat
      // it as a failed recovery (the crash screen path takes over).
      this.engine.dispose();
      throw new Error("webgl unavailable after context restore");
    }
    this.wireEngine();
    this.applyReducedMotion();
    this.engine.paused = SPEEDS[this.speed] === 0;
    this.engine.overlayMode = overlay;
    this.engine.selectedId = this.selected?.id ?? null;
    return this.engine.start().then(() => {
      // start() adopted the sim's saved view (stamped by the pre-crash
      // flush); re-apply the live camera exactly so the player can't tell
      // the renderer changed.
      this.engine.setCamera(tile, floor, zoom);
    });
  }

  // ---- Engine wiring (all input/camera goes through Excalibur) ------------

  private wireEngine(): void {
    // Decide whether a press pans the camera or performs the active tool.
    // Pan vs act is pure routing in ./game/gesture (unit-tested). On touch a
    // paint tool (floor/lobby/parking) owns the one-finger drag so mobile can
    // paint a run; panning is via the inspect tool or a two-finger drag (which
    // also zooms). Before this, a floor/lobby/parking drag only ever panned on
    // touch, so mobile couldn't paint a run at all.
    this.engine.classifyDown = (button, touch, space) => classifyGesture(this.tool, button, touch, space);

    // A press-without-drag: select (inspect) or, on touch, run the tool. The
    // picked entity comes from Excalibur's collider hit-testing.
    this.engine.onTap = (tile, floor, touch, picked) => {
      this.audio.start();
      if (this.tool.type === "inspect") {
        // Touch has no hover stream, so mobile shows ONE panel: the tap opens
        // the editor, which folds in the inspector card's diagnostics on mobile
        // (see refreshEditor / templates/editor). The floating card stays a
        // desktop-hover affordance and is never raised on touch.
        this.selectPicked(picked);
        return;
      }
      if (!touch) return; // mouse pan-taps with a build/bulldoze tool do nothing
      this.captureUndo(this.tool.type === "bulldoze" ? "Bulldoze" : `Build ${FACILITIES[this.tool.kind].name}`);
      if (this.tool.type === "bulldoze") this.build.bulldozePicked(picked);
      else if (this.tool.type === "build") {
        // Touch taps land here for every simple placement, including the
        // stairway/escalator flight (classifyDown routes them through the
        // pan/tap gesture so a finger-down can still pan). Drag-sized shafts
        // return null — they never place on a tap.
        this.placeSimpleBuild(this.tool.kind, tile, floor);
      }
      this.commitUndo();
    };

    this.engine.onActionDown = (tile, floor, touch, picked) => {
      this.audio.start();
      // A fresh gesture: drop any anchor/run a cancelled pinch left behind. The
      // pinch-cancel path skips onActionUp (which clears these), so without this
      // a resumed paint drag would extend from the abandoned anchor across the gap.
      this.paintAnchor = null;
      this.build.clearPaint();
      if (this.tool.type === "bulldoze" || this.tool.type === "build") {
        this.captureUndo(this.tool.type === "bulldoze" ? "Bulldoze" : `Build ${FACILITIES[this.tool.kind].name}`);
      }
      if (this.tool.type === "bulldoze") {
        this.build.bulldozePicked(picked);
      } else if (this.tool.type === "build") {
        // Simple placements (strip paint, two-floor flight, room) happen on
        // the press; a drag-sized shaft instead anchors here and sizes with
        // the drag. A TOUCH paint tool defers to move/up (see paintAnchor) so a
        // two-finger pan/zoom never drops a paid-for strip on its first finger.
        if (touch && this.isPaintTool()) {
          this.paintAnchor = { tile, floor };
        } else if (this.placeSimpleBuild(this.tool.kind, tile, floor) === null) {
          this.transportStart = { x: snapX(this.tool.kind, tile), floor };
        }
      }
    };

    this.engine.onActionMove = (tile, floor, picked) => {
      if (this.tool.type === "bulldoze") {
        this.build.bulldozePicked(picked, true); // drag: blocked tiles fail silently
        return;
      }
      if (this.tool.type !== "build") return;
      const kind = this.tool.kind;
      if (this.isTransportTool() && this.transportStart) {
        const bottom = Math.min(this.transportStart.floor, floor);
        const top = Math.max(this.transportStart.floor, floor);
        const x = this.transportStart.x;
        const valid = this.sim.tower.placeTransportDryRun(kind, x, bottom, top) && this.sim.isUnlocked(kind);
        this.engine.transportPreview = { kind, x, bottom, top, valid };
        this.engine.preview = null;
      } else if (isPaintKind(kind)) {
        if (this.paintAnchor) {
          // First move of a deferred touch paint: stamp the same brush strip a
          // desktop press lays at the press point, then extend from it.
          this.build.seedPaint(kind, this.paintAnchor.tile, this.paintAnchor.floor);
          this.paintAnchor = null;
        }
        // For a wide unit (parking) each tile-step re-attempts a build; overlaps
        // fail silently, so successful placements land flush → a contiguous chain.
        this.build.paintFloorRun(kind, tile, floor);
      }
    };

    this.engine.onActionUp = () => {
      // A deferred touch paint that never moved is a TAP: lay the same brush
      // strip a desktop click lays (a drag already laid its run via
      // onActionMove and cleared the anchor).
      if (this.paintAnchor) {
        if (this.tool.type === "build") this.build.seedPaint(this.tool.kind, this.paintAnchor.tile, this.paintAnchor.floor);
        this.paintAnchor = null;
      }
      this.build.clearPaint();
      // Only drag-sized transports (elevators) commit on release. Stairs and
      // escalators already placed on the DOWN event, and their hover ghost
      // also lives in transportPreview — treating it as a drag commit here
      // would double-place on every desktop click.
      if (this.tool.type === "build" && this.isTransportTool() && !isFixedSpanTransport(this.tool.kind)) {
        const tp = this.engine.transportPreview;
        if (tp) {
          // The helper explains failures (invalid spot, not enough money)
          // instead of failing silently.
          this.build.tryBuildTransport(tp.kind, tp.x, tp.bottom, tp.top);
          this.engine.transportPreview = null;
        } else if (this.transportStart) {
          // Pressed without dragging — teach the drag-to-size gesture.
          this.ui.toast(`Drag up or down to set the ${FACILITIES[this.tool.kind].name.toLowerCase()}'s height.`, "info");
        }
      }
      this.transportStart = null;
      this.commitUndo();
    };

    this.engine.onHover = (tile, floor, picked) => {
      if (this.tool.type === "build") {
        this.updateBuildPreview(tile, floor);
      } else {
        this.engine.preview = null;
        this.engine.transportPreview = null;
        // The floating card is a desktop affordance only: on a phone-width
        // viewport we show ONE panel (the editor, with diagnostics folded in),
        // so a hybrid mouse+touch device never raises the card there either.
        if (this.tool.type === "inspect" && !this.mobileMq.matches) this.inspector.inspectPicked(picked);
      }
    };

    // Right-click inspects whatever's under the cursor, whatever tool is held.
    this.engine.onSecondary = (picked) => this.selectPicked(picked);
    // In-world extend arrows on the selected elevator: drag an end to grow or
    // shrink the shaft floor-by-floor.
    this.engine.onExtendTo = (end, target) => this.editor.extendSelectedTo(end, target);
    this.engine.onExtendEnd = () => {
      this.editor.endExtend();
      this.commitUndo();
    };
    // Suppress the browser context menu so right-click is ours to use.
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Per-frame: advance the sim and (throttled) refresh DOM/audio.
    this.engine.onUpdate = (ms) => {
      // A thrown frame must NEVER escape to Excalibur: its game loop calls
      // stop() on any uncaught exception, which freezes the whole game dead
      // (seen at high speed, where far more sim work runs per frame). Contain it
      // here so a transient error skips one frame instead of halting play.
      try {
        this.update(ms);
      } catch (err) {
        // Throttle the log so a per-frame throw can't spam the console at
        // frame-rate (which would itself tank performance).
        const now = globalThis.performance ? performance.now() : 0;
        if (now - this.lastTickErrorLog > 2000) {
          this.lastTickErrorLog = now;
          console.error("[tick] frame error, continuing:", err);
          // Same throttle for the crash-report ring buffer: a repeating throw
          // records one entry per window, not one per frame.
          this.frameErrors.push({
            at: new Date().toISOString(),
            message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}`.trim() : String(err),
          });
          if (this.frameErrors.length > MAX_FRAME_ERRORS) this.frameErrors.shift();
        }
      }
    };

    // The GPU dropped the WebGL context (mobile browsers reset it under memory
    // pressure / after backgrounding). Recover for the player instead of
    // Excalibur's dead-end "please refresh the page" card.
    this.engine.onContextLost = () => this.saveLoad.recoverFromContextLoss();
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      // The crash screen owns all input while it is up: the renderer is dead
      // and the tower was just flushed, so game shortcuts (undo especially)
      // must not silently mutate the sim behind the card. Checked before the
      // undo/redo block below, which deliberately runs ahead of the #modal
      // guard and would otherwise stay live.
      if (document.getElementById(CRASH_SCREEN_ID)) return;
      // Undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or +Y) — handled BEFORE the
      // modifier bail below so it isn't swallowed; skipped while typing in a field
      // (which keeps its own edit history, e.g. the rename box).
      {
        const el = document.activeElement;
        const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
        if (!typing && (e.ctrlKey || e.metaKey)) {
          const k = e.key.toLowerCase();
          if (k === "z" && !e.shiftKey) {
            e.preventDefault();
            return this.undo();
          }
          if ((k === "z" && e.shiftKey) || k === "y") {
            e.preventDefault();
            return this.redo();
          }
        }
      }
      // Never hijack other browser/OS shortcuts (Ctrl/Cmd/Alt + key).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Typing controls swallow every game key.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable))
        return;
      // A focused button / palette item owns Enter/Space activation — don't ALSO
      // fire the build cursor on those keys. Movement/zoom/bulldoze keys still get
      // through, so keyboard play flows right after picking a tool from the palette.
      const onControl = !!ae && (ae.tagName === "BUTTON" || ae.tagName === "A" || ae.getAttribute("role") === "button");
      const activationKey = e.key === "Enter" || e.key === " " || e.key === "Spacebar";
      if (onControl && activationKey) return;
      if ((document.getElementById("modal") as HTMLDialogElement | null)?.open) return;
      // Don't let game keys run the paused engine behind the first-run splash.
      if (document.getElementById("splash")) return;
      if (e.key >= "0" && e.key <= "3") {
        this.setSpeed(Number(e.key));
        return;
      }

      // Keyboard play (F50–52): a virtual build cursor moved with arrows/WASD,
      // committed with Enter, bulldozed with Delete/X — full mouse-free play.
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case "ArrowLeft": case "a": case "A": this.keyboard.moveCursor(-step, 0); break;
        case "ArrowRight": case "d": case "D": this.keyboard.moveCursor(step, 0); break;
        case "ArrowUp": case "w": case "W": this.keyboard.moveCursor(0, step); break;
        case "ArrowDown": case "s": case "S": this.keyboard.moveCursor(0, -step); break;
        case "Enter": case " ": case "Spacebar": this.keyboard.commitCursor(); break;
        case "Delete": case "Backspace": case "x": case "X": this.keyboard.bulldozeCursor(); break;
        case "+": case "=": this.engine.zoomBy(1.15); return;
        case "-": case "_": this.engine.zoomBy(1 / 1.15); return;
        case "c": case "C": {
          const cur = this.keyboard.cursor();
          if (cur) this.engine.ensureVisible(cur.tile, cur.floor);
          else this.engine.center();
          return;
        }
        case "Escape":
          this.keyboard.resetAnchor();
          this.engine.transportPreview = null;
          this.keyboard.refreshCursorPreview();
          this.announce("Cancelled");
          return;
        default:
          return; // not a game key — let it through
      }
      e.preventDefault(); // consumed a movement/commit/bulldoze key
    });
    // First interaction starts audio (browser autoplay policy).
    const kick = () => this.audio.start();
    window.addEventListener("pointerdown", kick, { once: true });
    window.addEventListener("keydown", kick, { once: true });
    // Don't let a pending debounced pref write die with the page.
    window.addEventListener("pagehide", () => this.flushPrefsSave());
  }

  /** The gesture-independent placement cases shared by tap, click, and the
   *  keyboard cursor: paint a structure strip, drop a fixed two-floor flight,
   *  or place a room. Returns null for drag-sized shafts — that anchor
   *  gesture belongs to the caller.
   *  NOTE: src/tests/integration/gameControllers.integration.test.ts mirrors this body (and pickedAt /
   *  isTransportTool) to drive KeyboardPlay headlessly — keep the mirror in
   *  sync when editing. */
  private placeSimpleBuild(kind: FacilityKind, tile: number, floor: number): PlaceOutcome | null {
    if (kind === "floor" || kind === "lobby") {
      const r = this.build.paintBrush(kind, tile, floor);
      return { what: "paint", ok: r.placed > 0, reason: r.reason };
    }
    if (isFixedSpanTransport(kind)) {
      const r = this.build.tryBuildTransport(kind, snapX(kind, tile), floor, floor + 1);
      return { what: "flight", ok: r.ok, reason: r.reason };
    }
    if (this.isTransportTool()) return null;
    const before = this.sim.tower.units.length;
    this.build.tryBuild(kind, floor, snapX(kind, tile));
    return { what: "room", ok: this.sim.tower.units.length > before };
  }

  private isTransportTool(): boolean {
    return this.tool.type === "build" && !!FACILITIES[this.tool.kind].transport;
  }

  /** Whether the active tool drag-paints a run (floor/lobby/parking) — see
   *  {@link isPaintKind}. Used by the touch deferral in onActionDown. */
  private isPaintTool(): boolean {
    return this.tool.type === "build" && isPaintKind(this.tool.kind);
  }

  /** Set the colored stats overlay from the picker value ("" = off). An
   *  unrecognized value falls back to off, so a stale/forged value can't push a
   *  bad mode into the renderer. */
  setOverlay(mode: string): void {
    this.engine.overlayMode = (HEATMAP_MODES as readonly string[]).includes(mode) ? (mode as HeatmapMode) : null;
  }

  private updateBuildPreview(tile: number, floor: number): void {
    if (this.tool.type !== "build") {
      this.engine.preview = null;
      this.engine.transportPreview = null;
      this.clearBuildRefusal();
      return;
    }
    const kind = this.tool.kind;
    if (this.isTransportTool()) {
      const x = snapX(kind, tile);
      if (isFixedSpanTransport(kind)) {
        // Stairs/escalators place as a fixed two-floor unit on tap, so the
        // ghost shows the real footprint and the real validity.
        const valid = this.sim.isUnlocked(kind) && this.sim.tower.placeTransportDryRun(kind, x, floor, floor + 1);
        this.engine.transportPreview = { kind, x, bottom: floor, top: floor + 1, valid };
        this.engine.preview = null;
      } else {
        this.engine.transportPreview = null;
        this.engine.preview = { kind, floor, x, valid: this.sim.isUnlocked(kind) };
      }
      this.clearBuildRefusal();
    } else if (kind === "floor" || kind === "lobby") {
      // These tools lay a centered brush strip, not a single tile — so the
      // shadow must span the same run a click will build.
      const tiles = brushTiles(tile);
      const left = tiles[0];
      const span = tiles[tiles.length - 1] - left + 1;
      const can = this.sim.canBuild(kind, floor, snapX(kind, tile));
      const reason = !can.ok && this.sim.rules.showsPreviewReason ? can.reason : undefined;
      this.engine.preview = { kind, floor, x: left, span, valid: can.ok, reason };
      this.engine.transportPreview = null;
      this.updateBuildRefusal(reason, floor, left + Math.floor(span / 2));
    } else {
      const x = snapX(kind, tile);
      // Rooms auto-lay their own floor, so validity comes from canBuild (which
      // accounts for the floor tiles and their cost), not raw canPlace.
      const can = this.sim.canBuild(kind, floor, x);
      // Modern surfaces the refusal reason on the preview so a hover teaches the
      // rule before the click; Classic keeps the '94 click-to-refuse pedagogy.
      const reason = !can.ok && this.sim.rules.showsPreviewReason ? can.reason : undefined;
      this.engine.preview = { kind, floor, x, valid: can.ok, reason };
      this.engine.transportPreview = null;
      this.updateBuildRefusal(reason, floor, x + Math.floor(FACILITIES[kind].width / 2));
    }
  }

  /** Surface a Modern-mode build-refusal reason via the hover inspector DOM
   *  surface, or clear it if no reason applies. The inspector card is dormant
   *  in build mode (only the inspect tool drives it, main.ts:640), so the
   *  build-preview path can safely borrow the same DOM element without racing
   *  a legit inspector card. `buildRefusalShowing` tracks ownership so a switch
   *  back to the inspect tool doesn't stomp a fresh card. */
  private updateBuildRefusal(reason: string | undefined, floor: number, anchorX: number): void {
    if (reason) {
      this.inspectAnchor = { x: anchorX, floor };
      // The template wraps the tooltip in the standard <h4 class="win-title">
      // so UI.showInspector attaches its mobile-only ✕ close. On desktop the
      // tooltip clears as soon as the pointer moves off an invalid cell, but
      // on the phone tier there is no such hover trail, so a pinned card
      // needs an explicit dismiss affordance.
      this.ui.showInspector(buildRefusalTemplate(reason));
      this.buildRefusalShowing = true;
    } else {
      this.clearBuildRefusal();
    }
  }

  /** Hide the Modern build-refusal tooltip, but only if the build-preview path
   *  is the one that put it up (so a live inspect-tool card is never stomped). */
  private clearBuildRefusal(): void {
    if (!this.buildRefusalShowing) return;
    this.ui.showInspector(null);
    this.inspectAnchor = null;
    this.buildRefusalShowing = false;
  }

  // ---- Per-frame simulation + UI -----------------------------------------

  private update(dtMs: number): void {
    // While a blocking modal is open, freeze time so nothing changes under it:
    // an emergency choice (canon: the modal pauses the game) must not auto-resolve
    // out from under the player, and the update prompt must not let a distracted
    // player lose game-hours at high speed while it waits for their answer.
    if (this.shownChoice || this.shownUpdate) {
      this.accMinutes = 0;
      return;
    }
    const minutesPerSecond = SPEEDS[this.speed] ?? 0;
    // The 1994 "breathing clock": scale how fast REAL time feeds sim-minutes by
    // the canon pacing curve (lunch dilates ~10x, night sprints) unless the
    // player opted out. Presentation-only: the sim still ticks uniform minutes,
    // and paceFactor is normalized so a full day costs the same real time, so
    // the speed buttons keep their meaning.
    const pace = this.prefs.steadyClock ? 1 : paceFactor(this.sim.clock.minuteOfDay);
    this.accMinutes += (dtMs / 1000) * minutesPerSecond * pace;
    // Cap the catch-up debt. Owed minutes grow with real frame time, so on a
    // device that can't simulate the fastest speed in real time every frame
    // would carry ever more sim work, stretching frames toward seconds of
    // sustained CPU+GPU load, the profile under which Android reclaims the
    // WebGL context (the Pixel 8a "random crash"). Dropping the excess trades
    // clock accuracy for survival: the game visibly runs slower than the
    // speed button promises on hardware that can't keep up, and a tab restored
    // from the background resumes with one bounded step instead of replaying
    // the whole absence.
    if (this.accMinutes > MAX_CATCHUP_MINUTES) this.accMinutes = MAX_CATCHUP_MINUTES;
    // Step the simulation in small chunks so hourly/daily boundaries fire.
    const minutesBeforeTicks = this.sim.clock.minutes;
    let guard = 0;
    while (this.accMinutes >= 1 && guard++ < 2000) {
      const step = Math.min(20, this.accMinutes);
      this.sim.tick(step);
      this.accMinutes -= step;
    }
    this.emitMealRushes(minutesBeforeTicks);

    // Throttle the comparatively expensive DOM/audio updates (~6Hz) so a busy
    // tower never makes panning feel sluggish.
    const now = globalThis.performance ? performance.now() : 0;
    if (now - this.lastUiUpdate > 160) {
      this.lastUiUpdate = now;
      this.audio.update(this.engine.focus());
      this.ui.update(this.sim);
      this.updateTraffic();
      this.onboarding.tick(); // advance the first-run checklist on real progress (no-op when inactive)
      // Keep the open editor's live stats fresh. Refresh now patches only the
      // volatile cells in place (never the buttons or rename input), so this is
      // safe while renaming; the pointer guard still skips the rare full rebuild
      // during an active press.
      if (this.selected && this.ui.isEditorOpen() && !this.ui.isEditorBusy()) {
        this.refreshEditor();
      }
      // A jingle on every star promotion (2★–5★), not just the TOWER win.
      if (this.sim.star > this.lastStar) {
        this.lastStar = this.sim.star;
        if (this.sim.star < 6) this.audio.sfx("promote");
      }
      // Auto-surfaced modals must never stack over the boot/return splash. A
      // loaded save can carry a pending emergency (or an already-won TOWER), and
      // now that returning players see the splash, opening one behind it would be
      // a wrong greeting, and resolving an emergency MUTATES the sim (pays money /
      // applies the outcome) while the title screen is up. That breaks the
      // "nothing changes behind the splash" invariant autosave relies on. The
      // splash pauses the sim, so nothing is lost by waiting: these surface on the
      // next calm tick once the player dismisses it. (The update prompt already
      // self-guards on the splash via updateCoastClear.)
      const splashUp = !!document.getElementById("splash");
      // Interactive emergency choice (fire rescue / bomb ransom).
      const pc = this.sim.pendingChoice;
      if (pc && !this.shownChoice && !splashUp) {
        this.shownChoice = true;
        this.audio.sfx("error");
        this.ui.showEventChoice(pc.message, `$${pc.cost.toLocaleString()}`, (opt) => {
          this.sim.resolveChoice(opt);
          this.shownChoice = false;
        });
      } else if (!pc && this.shownChoice) {
        this.shownChoice = false; // engine auto-resolved it (player ignored the modal)
      }
      // A new build is waiting: auto-surface the update prompt once, but only at
      // a calm moment (mirrors how the emergency choice is surfaced above). The
      // chip is already visible from the instant the build was found, so if a
      // calm moment never comes the player still has a way in.
      this.maybeSurfaceUpdatePrompt();
      if (this.sim.evaluatedTower && !this.shownWin && !splashUp) {
        this.shownWin = true;
        this.audio.sfx("promote");
        this.ui.congratsTower();
      }
    }

    // World-anchor the editor card and inspector tooltip every frame (cheap —
    // just writes left/top), so they ride the tower as the camera pans/zooms.
    this.positionPanels();
  }

  /** Once per weekday, when this frame's ticks actually CROSSED noon with the
   *  breathing clock on, drop a flavor line in the bulletin. It doubles as the
   *  only in-game explanation of why midday plays out in slow motion (UX call:
   *  the clock itself is the indicator; no HUD gauges). Crossing detection
   *  (rather than sampling `hour === 12` after the loop) means loading a save
   *  that already sits inside the noon hour stays quiet, a frozen clock stays
   *  quiet, and a single huge frame that leaps from 11:5x past 13:00 still
   *  fires. Transient, like the log. */
  private emitMealRushes(minutesBeforeTicks: number): void {
    if (this.prefs.steadyClock) return;
    const after = this.sim.clock.minutes;
    // A tampered save can seed the clock with non-finite minutes (deserialize
    // passes data.minutes to Clock un-hardened); without this, dayOfKind is NaN,
    // the once-per-day latch never sticks (NaN !== NaN), and the bulletin spams
    // every frame. Same defensive posture as timePacing's finite guards.
    if (!Number.isFinite(after) || !Number.isFinite(minutesBeforeTicks)) return;
    const cal = this.sim.clock.calendar;
    // Tenant-count floor: silence bulletins in a very small tower (1-star lot
    // with a handful of rooms), so the log does not chatter through the early
    // game. 30 occupied tenants is a modest bar; a mid-star tower clears it.
    const tenants = this.sim.tower.totalPopulation();
    if (tenants < 30) return;
    // Emit each meal's bulletin once per day at the START of its window.
    // Anchoring on the frame START keeps the crossing check correct for a
    // single huge frame that leaps past the hour boundary; the calendar-aware
    // weekend gate skips weekends for the workday meals only (lunch and
    // dinner). Breakfast fires every day (hotels serve breakfast on weekends).
    const emit = (kind: "breakfast" | "lunch" | "dinner", hour: number, text: string, skipWeekend: boolean): void => {
      const { fire, dayOfKind } = decideMealRush({
        hour,
        skipWeekend,
        before: minutesBeforeTicks,
        after,
        weekDays: cal.weekDays,
        weekendDays: cal.weekendDays,
        lastFiredDay: this.lastMealRushDay[kind],
      });
      if (!fire) return;
      this.lastMealRushDay[kind] = dayOfKind;
      this.sim.emit(text, "info");
    };
    // Breakfast at 07:00, dinner at 18:00, lunch at 12:00. Order matches the
    // day so a slow-motion frame that crosses two boundaries emits both.
    emit("breakfast", 7, "Breakfast rush! Guests head down for the buffet.", false);
    emit("lunch", 12, "Lunch rush! Midday plays out in slow motion, just like 1994.", true);
    emit("dinner", 18, "Dinner rush! Elevators fill for the evening service.", true);
  }

  /** Keep the world-attached DOM panels (selected-facility editor, hover
   *  inspector) pinned to their facility's on-screen position. On mobile they
   *  keep the docked CSS layout instead, to avoid the bottom palette strip. */
  private positionPanels(): void {
    if (this.mobileMq.matches) {
      if (this.panelsAnchored) {
        this.ui.clearPanelAnchors();
        this.panelsAnchored = false;
      }
      return;
    }
    const vw = this.engine.viewWidth;
    const vh = this.engine.viewHeight;
    if (this.selected && this.ui.isEditorOpen()) {
      const r = this.selectedScreenRect();
      if (r) {
        this.ui.anchorEditor(r, vw, vh);
        this.panelsAnchored = true;
      }
    }
    if (this.inspectAnchor && this.ui.isInspectorOpen()) {
      const sx = this.engine.worldToScreenX(this.inspectAnchor.x);
      const sy = this.engine.worldToScreenY(this.inspectAnchor.floor);
      this.ui.anchorInspector(sx, sy, vw, vh);
      this.panelsAnchored = true;
    }
  }

  /** Screen-space rect (top edge) of the currently selected unit/transport,
   *  for the editor card to anchor beside. */
  private selectedScreenRect(): { x: number; y: number; w: number } | null {
    if (!this.selected) return null;
    let left: number, right: number, topFloor: number;
    if (this.selected.type === "unit") {
      const u = this.selectedUnit();
      if (!u) return null;
      left = u.x;
      right = u.x + u.width;
      topFloor = u.floor + facilityFloors(u.kind) - 1;
    } else {
      const t = this.selectedTransport();
      if (!t) return null;
      left = t.x;
      right = t.x + t.width;
      topFloor = t.top;
    }
    const sx = this.engine.worldToScreenX(left);
    return { x: sx, y: this.engine.worldToScreenY(topFloor), w: this.engine.worldToScreenX(right) - sx };
  }

  // ---- Selection & per-facility editing ---------------------------------

  /** Select whatever Excalibur reported under the pointer (rooms/transports). */
  private selectPicked(p: Picked | null): void {
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
   *  (selection stores only an id — the entity may have been removed). */
  private selectedUnit(): Unit | undefined {
    if (this.selected?.type !== "unit") return undefined;
    return this.sim.tower.getUnit(this.selected.id);
  }
  private selectedTransport(): Transport | undefined {
    if (this.selected?.type !== "transport") return undefined;
    return this.sim.tower.getTransport(this.selected.id);
  }

  private clearSelection(): void {
    this.selected = null;
    this.engine.selectedId = null;
    this.ui.hideEditor();
  }

  private refreshEditor(): void {
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

  /** Swap in a freshly loaded/created simulation and point the engine at it. */
  private adoptSim(sim: Simulation, preserveHistory = false): void {
    this.sim = sim;
    this.clearSelection();
    // Facility ids restart in a fresh tower — a stale ✕-latch (or anchor)
    // from the old tower would silently mute the inspector on whichever new
    // facility happens to reuse the id.
    this.inspector.clear();
    this.shownWin = false;
    this.lastStar = sim.star;
    this.accMinutes = 0;
    this.lastMealRushDay = { breakfast: -1, lunch: -1, dinner: -1 };
    // A crash report pairs the CURRENT tower's save with these entries; errors
    // recorded against a previous tower would point triage at the wrong state.
    this.frameErrors.length = 0;
    // An undo/redo restore keeps the camera under the player (preserveHistory
    // is only ever true on that path); a real tower swap lets the engine
    // restore the save's own view or center a fresh one.
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
      // undo trail — otherwise Undo could resurrect an unrelated old tower and a
      // later autosave persist it. Undo/redo restores pass preserveHistory.
      this.history.clear();
    }
  }

  // ---- Undo / redo (state + logic live in engine/UndoHistory) -------------
  // Thin delegators kept so the many gesture call sites read unchanged.

  private captureUndo(label: string): void {
    this.history.capture(label);
  }

  private commitUndo(): void {
    this.history.commit();
  }

  undo(): void {
    this.history.undo();
  }

  redo(): void {
    this.history.redo();
  }

  /** Called by the PWA layer the instant a newer build is waiting (wired up in
   *  the bootstrap below). We do NOT reload — we hold the activation, reveal the
   *  toolbar "Update" chip so the player always has a way in, and let the
   *  ~6Hz loop pop the prompt at the next calm moment. A second release during
   *  a long session overwrites the pending activation and re-arms the auto-pop. */
  onUpdateAvailable(activate: () => Promise<void>, info?: UpdateInfo): void {
    this.pendingUpdate = activate;
    this.pendingUpdateInfo = info ?? null;
    this.updatePromptShown = false;
    this.ui.showUpdateChip(() => this.showUpdatePrompt());
  }

  /** True when it's safe to pop the update modal: nothing else owns the screen
   *  or a pending player decision. Opening a second modal would wipe the shared
   *  `<dialog>` and can strand a frozen sim, so this guard is load-bearing. */
  private updateCoastClear(): boolean {
    return (
      this.pendingUpdate !== null &&
      !this.shownUpdate &&
      !this.shownChoice &&
      !this.transportStart &&
      !this.ui.isModalOpen() &&
      !document.getElementById("splash")
    );
  }

  /** Auto-surface the update prompt at most once per pending build, only when
   *  the coast is clear. Called every ~6Hz tick. */
  private maybeSurfaceUpdatePrompt(): void {
    if (this.updatePromptShown) return;
    if (!this.updateCoastClear()) return;
    this.showUpdatePrompt();
  }

  /** Open the "update available" modal. Shared by the auto-surface poll and the
   *  toolbar chip. No-ops unless the coast is clear (so a chip tap during an
   *  emergency, a drag, or another dialog is simply ignored). */
  private showUpdatePrompt(): void {
    if (!this.updateCoastClear()) return;
    const activate = this.pendingUpdate!;
    this.updatePromptShown = true;
    this.shownUpdate = true; // freeze the sim while the prompt is up
    this.ui.showUpdatePrompt(
      // Update now: save the tower FIRST, then activate (skipWaiting + reload).
      // If the save fails we do NOT reload — dropping unsaved progress is the one
      // thing this flow exists to prevent — so we unfreeze, tell the player, and
      // leave the build waiting (the chip stays, so they can retry).
      async () => {
        try {
          this.saveLoad.saveBeforeUpdate();
        } catch {
          this.shownUpdate = false;
          this.ui.toast("Couldn't save your tower. Update paused. Try again.", "bad");
          return;
        }
        // Unfreeze before activating: on success `activate()` reloads onto the
        // new build and nothing below matters, but if the worker swap ever
        // hiccups the sim must not be left frozen with no modal (a save just
        // ran, so a few resumed ticks are harmless). Keep `pendingUpdate` and the
        // chip live through the call so a failed activate leaves a way to retry
        // rather than stranding the player on the old build. We intentionally
        // keep NO "activating" latch: `updateSW(true)` resolves before the reload
        // fires, so any such latch could stick forever if the reload never comes
        // — and a second activation is idempotent (skipWaiting + reload) anyway.
        this.shownUpdate = false;
        // Mark this reload as an update so the fresh build drops the player back
        // into their tower (paused) with an "Updated …" greeting instead of the
        // title screen — honoring the modal's "keep playing" promise.
        try {
          sessionStorage.setItem(RESUME_AFTER_UPDATE_KEY, String(Date.now()));
        } catch {
          /* private mode — the player just gets the normal "Welcome back" instead */
        }
        try {
          await activate();
        } catch {
          // The reload didn't happen — clear the flag so a later manual reload
          // isn't mislabeled "Updated", and tell the player they can retry.
          try {
            sessionStorage.removeItem(RESUME_AFTER_UPDATE_KEY);
          } catch {
            /* private mode — nothing to clear */
          }
          this.ui.toast("Update couldn't be applied. Try again.", "bad");
        }
      },
      // Later: keep playing. The waiting build activates on the next cold reopen
      // (prompt mode never force-activates); reset the autosave baseline to now
      // so that reopen can't cost more than this moment, and leave the chip up so
      // they can pull the prompt back up and update whenever they like.
      () => {
        this.shownUpdate = false;
        // Mark as surfaced so the auto-pop doesn't immediately re-open — even if a
        // newer build arrived mid-modal and re-armed it. The chip stays as the way
        // back in; a genuinely newer build re-arms auto-pop via onUpdateAvailable.
        this.updatePromptShown = true;
        try {
          this.saveLoad.save(true);
        } catch {
          /* best-effort — a failed baseline save just leaves the last autosave in place */
        }
      },
      this.pendingUpdateInfo,
    );
  }
}

/** The renderer needs WebGL; some in-app file viewers don't provide it. */
function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function showBootMessage(msg: string, withReload = false): void {
  const stage = document.getElementById("stage");
  if (!stage) return;
  stage.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;color:#cdd3da;font:15px/1.5 system-ui,sans-serif"><div>${msg}</div></div>`;
  if (withReload) {
    const btn = document.createElement("button");
    btn.textContent = "Reload";
    btn.style.cssText = "padding:8px 24px;font:inherit;cursor:pointer";
    btn.addEventListener("click", () => location.reload());
    stage.firstElementChild!.appendChild(btn);
  }
}

// Bootstrap once the DOM is ready.
if (typeof document !== "undefined") {
  const boot = () => {
    if (!hasWebGL()) {
      showBootMessage(
        "This viewer can't run WebGL, which Verticopolis needs to draw the tower.<br><br>Open this page in <b>Safari</b>, <b>Chrome</b>, or another full web browser to play.",
      );
      return;
    }
    try {
      const app = new GameApp();
      // Expose for screenshot tooling / debugging.
      (window as unknown as { game: GameApp }).game = app;
      // Register the service worker so the game is installable and offline-ready.
      // On a new build: prompt the player (never force a reload) — see
      // GameApp.onUpdateAvailable.
      registerPWA({ onUpdateAvailable: (activate, info) => app.onUpdateAvailable(activate, info) });
    } catch (err) {
      showBootMessage("Something went wrong starting the game: " + (err as Error).message);
      throw err;
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}

export { GameApp };
