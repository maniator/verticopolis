import { Simulation } from "./engine/Simulation";
import { UndoHistory, towerStateSig } from "./engine/UndoHistory";
import { FACILITIES, GRID, facilityFloors, isFixedSpanTransport, maxCarsFor } from "./engine/facilities";
import { rentConfig } from "./engine/econConfig";
import type { FacilityKind, Transport, Unit } from "./engine/types";
import { isOperational } from "./engine/types";
import { TowerEngine, HEATMAP_MODES, type Picked } from "./render/excalibur/TowerEngine";
import type { HeatmapMode } from "./engine/Simulation";
import { AudioEngine } from "./audio/Audio";
import { SaveGame } from "./storage/SaveGame";
import { loadPrefs, savePrefs, reducedMotionActive, type Prefs } from "./storage/Prefs";
import { trafficTier, TRAFFIC_BOUNDS, TRAFFIC_LABELS, trafficGlyph, type TrafficTier } from "./engine/traffic";
import { UI, type Tool } from "./ui/UI";
import { classifyGesture, isPaintKind } from "./game/gesture";
import { unitEditorHtml, unitEditorVolatile, transportEditorHtml, transportEditorVolatile } from "./ui/editorHtml";
import { brushTiles, snapX, type PlaceOutcome } from "./ui/placement";
import { buildStatsHtml } from "./ui/statsHtml";
import { OnboardingController } from "./ui/Onboarding";
import { BuildActions } from "./game/buildActions";
import { EditorActions } from "./game/editorActions";
import { SaveLoad } from "./game/saveLoad";
import { InspectorController } from "./game/inspector";
import { KeyboardPlay } from "./game/keyboardPlay";
import { registerPWA, type UpdateInfo } from "./pwa";

/** Game speeds → in-game minutes advanced per real second. */
const SPEEDS = [0, 10, 30, 120];

/** Compile-time app version (see vite.config.ts `define`); "dev" outside a build. */
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/** sessionStorage key: stamped with `Date.now()` right before an "Update now"
 *  reload so the fresh build greets the player with "Updated …" instead of
 *  "Welcome back". sessionStorage survives the same-tab reload; the timestamp
 *  lets the boot ignore a stale flag left by an `updateSW` that resolved without
 *  ever reloading (so an unrelated later reload is never mislabeled). */
const RESUME_AFTER_UPDATE_KEY = "vc-resume-after-update";
/** A real update reloads within a second or two of the click; only honor the
 *  "Updated" greeting inside this window. */
const RESUME_AFTER_UPDATE_MAX_AGE_MS = 30_000;

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
class GameApp {
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
  private lastUiUpdate = 0;
  /** Throttle for the per-frame error log, so a repeating throw can't spam. */
  private lastTickErrorLog = 0;
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
  private reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** Last shown traffic tier (for boundary hysteresis, so the chip doesn't flicker). */
  private lastTrafficTier: TrafficTier = 0;

  /** Controller modules (src/game/): each takes a narrow deps slice of this
   *  app spine, never the GameApp itself (see the modules' own doc comments). */
  private readonly build: BuildActions;
  private readonly editor: EditorActions;
  private readonly saveLoad: SaveLoad;
  private readonly inspector: InspectorController;
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
      adoptSim: (sim) => this.adoptSim(sim),
      ui: {
        toast: (text, kind) => this.ui.toast(text, kind),
        downloadFile: (filename, contents) => this.ui.downloadFile(filename, contents),
      },
      showBootMessage,
      armOnboarding: () => {
        this.onboarding.arm(this.sim);
      },
    });
    this.keyboard = new KeyboardPlay({
      getSim: () => this.sim,
      engine: this.engine,
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

    this.ui = new UI({
      onSelectTool: (t) => {
        this.tool = t;
        this.keyboard.resetAnchor(); // don't carry a pending transport anchor across tools
        this.engine.preview = null;
        this.engine.transportPreview = null;
      },
      onSpeed: (s) => this.setSpeed(s),
      onSave: () => this.saveLoad.save(),
      onLoad: () => this.saveLoad.load(),
      onExport: () => void this.saveLoad.exportGame(),
      onImport: (data) => void this.saveLoad.importGame(data),
      onNew: (mode) => this.saveLoad.newGame(mode),
      onToggleAudio: () => {
        this.audio.start();
        this.audio.setMuted(!this.audio.muted);
        return this.audio.muted;
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onEditAction: (action, root) => this.editor.handleEditAction(action, root),
      onToggleReducedMotion: () => {
        this.prefs.reducedMotion = !this.prefs.reducedMotion;
        savePrefs(this.prefs);
        this.applyReducedMotion();
        return reducedMotionActive(this.prefs, this.reduceMq.matches);
      },
      onReplayOnboarding: () => {
        if (document.getElementById("splash")) return; // never arm behind the splash
        OnboardingController.clearOnboarded();
        this.ui.closeModal();
        if (!this.onboarding.arm(this.sim)) {
          this.ui.toast("You've already completed Getting Started.", "info");
        }
      },
      onRenameTower: (name) => (this.sim.tower.towerName = name),
      onShowStats: () => this.ui.showStats(buildStatsHtml(this.sim)),
      onSetOverlay: (mode) => this.setOverlay(mode),
      // Latches the dismissal so the next hover pick over the same facility
      // doesn't instantly re-open the card the user just closed.
      onInspectorClose: () => this.inspector.dismiss(),
      onShowSaves: () => this.ui.showSaves(SaveGame.listSlots()),
      onSaveSlot: (n) => {
        SaveGame.saveSlot(n, this.sim);
        this.ui.toast(`Saved to slot ${n}.`, "good");
      },
      onLoadSlot: (slot) => {
        const loaded = slot === "auto" ? SaveGame.load() : SaveGame.loadSlot(slot);
        if (loaded) {
          this.adoptSim(loaded);
          this.ui.toast("Tower loaded.", "good");
        } else {
          this.ui.toast("That slot is empty or corrupt.", "bad");
        }
      },
      onDeleteSlot: (n) => {
        SaveGame.deleteSlot(n);
        this.ui.toast(`Deleted slot ${n}.`, "info");
      },
    });

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
    // A returning player with a readable save is dropped straight into their
    // tower — no title screen to click through every launch (and especially not
    // right after "Update now", whose modal promised "keep playing"). But we boot
    // PAUSED: time must never advance while the player reacquires their view and
    // selection, which reset on reload (this is the same "don't lose game-hours"
    // rule the update modal's freeze enforces, minus the full-screen gate).
    //
    // The splash is reserved for the one moment it earns its place — first run /
    // no readable save / a corrupt save — where its branding, the attribution
    // line, and the New-Tower-vs-Continue (rule-set) choice are genuine
    // first-contact value. (The attribution also lives in Help → About, so it
    // stays discoverable for returning players who never see the splash.)
    // Read+clear the "just updated" flag UNCONDITIONALLY, before the branch: an
    // update can reload into an unreadable save (→ the splash branch below), and
    // the flag must still be consumed there so it can't survive to mislabel a
    // later boot as "Updated".
    let justUpdated = false;
    try {
      const stamp = Number(sessionStorage.getItem(RESUME_AFTER_UPDATE_KEY));
      sessionStorage.removeItem(RESUME_AFTER_UPDATE_KEY);
      justUpdated = Number.isFinite(stamp) && Date.now() - stamp < RESUME_AFTER_UPDATE_MAX_AGE_MS;
    } catch {
      /* sessionStorage can throw in private mode — treat it as not-an-update */
    }
    if (this.hadReadableSave) {
      this.setSpeed(0); // land paused; the ▶ Play control is the single "resume"
      this.ui.toast(
        justUpdated ? `Updated to v${APP_VERSION}. Press ▶ to resume.` : "Welcome back. Press ▶ to resume.",
        "info",
      );
    } else {
      // A corrupt save is not a continuable tower: reflect READABILITY, not mere
      // presence, so the splash never promises "Continue" over a fresh boot sim.
      this.onboarding.showSplash({
        hasSave: this.hadReadableSave,
        onContinue: () => {
          /* sim already loaded at construction; splash teardown resumes the engine */
        },
        onNewTower: (dismiss) => {
          // First run / corrupt boot: the rule-set picker chooses Classic vs
          // Modern. `hasSave` is false here (readable saves skip the splash), so
          // the picker shows no "abandons your current tower" warning — there's
          // nothing continuable to lose.
          this.ui.newTowerModal({
            hasSave: this.hadReadableSave,
            onFound: (mode) => {
              dismiss();
              this.saveLoad.newGame(mode);
            },
          });
        },
      });
    }

    // Tell the player plainly when their save couldn't be read, rather than
    // dropping them into a fresh tower with no explanation. Goes to the bulletin
    // (persists) and pops as a toast on the first UI update after the splash.
    if (this.saveWasCorrupt) {
      this.sim.emit(
        "⚠️ Your saved tower couldn't be read. It may be corrupted or from a newer version. Starting a new tower.",
        "bad",
      );
    }

    // Autosave periodically — but never while the first-run splash is up, so an
    // idle first visit can't persist the throwaway boot sim (which would flip
    // hasSave() true for a tower the player never started).
    window.setInterval(() => {
      if (!document.getElementById("splash")) this.saveLoad.save(true);
    }, 30000);
  }

  // ---- App-spine helpers the controllers borrow --------------------------

  /** Set the game speed (index into {@link SPEEDS}): updates the engine's pause
   *  state and the toolbar's active button. The single place the three concerns
   *  are kept in lockstep. */
  private setSpeed(s: number): void {
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

  /** Push the effective reduced-motion state (OS pref OR user pref) to the DOM
   *  (a class CSS keys off) and the engine (freezes ambient canvas motion). */
  private applyReducedMotion(): void {
    const on = reducedMotionActive(this.prefs, this.reduceMq.matches);
    document.documentElement.classList.toggle("reduce-motion", on);
    this.engine.setReducedMotion(on);
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
          // First move of a deferred touch paint — seed the run at the press
          // point so the strip starts where the finger went down, then extend.
          this.build.paintFloorRun(kind, this.paintAnchor.tile, this.paintAnchor.floor);
          this.paintAnchor = null;
        }
        // For a wide unit (parking) each tile-step re-attempts a build; overlaps
        // fail silently, so successful placements land flush → a contiguous chain.
        this.build.paintFloorRun(kind, tile, floor);
      }
    };

    this.engine.onActionUp = () => {
      // A deferred touch paint that never moved is a TAP — lay the single strip
      // now (a drag already laid its run via onActionMove and cleared the anchor).
      if (this.paintAnchor) {
        if (this.tool.type === "build") this.build.paintFloorRun(this.tool.kind, this.paintAnchor.tile, this.paintAnchor.floor);
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
        if (this.tool.type === "inspect") this.inspector.inspectPicked(picked);
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
          console.error("[tick] frame error — continuing:", err);
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
  }

  /** The gesture-independent placement cases shared by tap, click, and the
   *  keyboard cursor: paint a structure strip, drop a fixed two-floor flight,
   *  or place a room. Returns null for drag-sized shafts — that anchor
   *  gesture belongs to the caller.
   *  NOTE: src/tests/gameControllers.test.ts mirrors this body (and pickedAt /
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
  private setOverlay(mode: string): void {
    this.engine.overlayMode = (HEATMAP_MODES as readonly string[]).includes(mode) ? (mode as HeatmapMode) : null;
  }

  private updateBuildPreview(tile: number, floor: number): void {
    if (this.tool.type !== "build") {
      this.engine.preview = null;
      this.engine.transportPreview = null;
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
    } else if (kind === "floor" || kind === "lobby") {
      // These tools lay a centered brush strip, not a single tile — so the
      // shadow must span the same run a click will build.
      const tiles = brushTiles(tile);
      const left = tiles[0];
      const span = tiles[tiles.length - 1] - left + 1;
      const valid = this.sim.canBuild(kind, floor, snapX(kind, tile)).ok;
      this.engine.preview = { kind, floor, x: left, span, valid };
      this.engine.transportPreview = null;
    } else {
      const x = snapX(kind, tile);
      // Rooms auto-lay their own floor, so validity comes from canBuild (which
      // accounts for the floor tiles and their cost), not raw canPlace.
      const valid = this.sim.canBuild(kind, floor, x).ok;
      this.engine.preview = { kind, floor, x, valid };
      this.engine.transportPreview = null;
    }
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
    this.accMinutes += (dtMs / 1000) * minutesPerSecond;
    // Step the simulation in small chunks so hourly/daily boundaries fire.
    let guard = 0;
    while (this.accMinutes >= 1 && guard++ < 2000) {
      const step = Math.min(20, this.accMinutes);
      this.sim.tick(step);
      this.accMinutes -= step;
    }

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
      // Interactive emergency choice (fire rescue / bomb ransom).
      const pc = this.sim.pendingChoice;
      if (pc && !this.shownChoice) {
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
      if (this.sim.evaluatedTower && !this.shownWin) {
        this.shownWin = true;
        this.audio.sfx("promote");
        this.ui.congratsTower();
      }
    }

    // World-anchor the editor card and inspector tooltip every frame (cheap —
    // just writes left/top), so they ride the tower as the camera pans/zooms.
    this.positionPanels();
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
    // The render key encodes the editor's SHAPE (not its live values): same key
    // → patch the volatile fields in place; different key → full rebuild. The
    // shape only changes when a control appears/disappears (a condo sells and
    // loses its price adjuster; a car button hits its disabled bound), so
    // rebuilds are rare and the buttons/input survive every stat tick.
    if (this.selected.type === "unit") {
      const u = this.selectedUnit();
      if (!u) return this.clearSelection();
      this.engine.selectedId = u.id;
      const adjuster = !!rentConfig(u.kind) && !(u.kind === "condo" && u.everOccupied);
      // The Booking button label lives in the built HTML, so fold the policy into
      // the key — cycling it bumps the key and rebuilds the button.
      const film = u.kind === "cinema" ? `:${u.filmPolicy ?? "auto"}` : "";
      // Row SHAPE depends on state in two ways the volatile patcher can't
      // handle (it only rewrites existing spans): the cinema's "Now showing"
      // row exists only while operational, and gutted swaps the resale row
      // for scrap/bulldoze rows. Fold exactly those two bits into the key so
      // a construction finish, fire, or gut mid-view triggers a rebuild.
      const op = isOperational(u) ? "" : u.state === "gutted" ? ":g" : ":x";
      this.ui.renderEditor(`unit:${u.id}:${adjuster ? "r" : ""}${film}${op}`, () => unitEditorHtml(this.sim, u), unitEditorVolatile(this.sim, u));
    } else {
      const t = this.selectedTransport();
      if (!t) return this.clearSelection();
      this.engine.selectedId = t.id; // outlines the shaft + shows extend arrows
      const maxCars = maxCarsFor(t.kind);
      const shape = `${t.cars <= 1 ? "-" : ""}${t.cars >= maxCars ? "+" : ""}`;
      this.ui.renderEditor(`transport:${t.id}:${shape}`, () => transportEditorHtml(this.sim, t), transportEditorVolatile(this.sim, t));
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
    this.engine.setSim(sim);
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

  private undo(): void {
    this.history.undo();
  }

  private redo(): void {
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
