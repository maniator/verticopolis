import * as ex from "excalibur";
import type { Simulation, HeatmapMode, HeatCell } from "../../engine/Simulation";
import type { FacilityKind, SerializedView, Transport, Unit } from "../../engine/types";
import { PinchTracker } from "../pinchTracker";
import type { DrawCtx } from "../sprites";

// World-scale constants live in ../scale (a pure module unit tests can import
// without pulling in Excalibur); re-exported here for the existing consumers.
import { FLOOR, TILE } from "../scale";

import * as scene from "./towerScene";
import * as reconcile from "./towerReconcile";
import * as crowd from "./towerCrowd";
import * as camera from "./towerInputCamera";
import * as overlayFx from "./towerOverlay";
import { displayLit, drainSceneSync, runSceneSync } from "./towerSyncSchedule";
import type { RoomRec } from "./towerReconcile";
import type { Walker } from "./towerCrowd";
import type { ViewFocus, Picked, ScreenRect } from "./towerInputCamera";

export { FLOOR, TILE };
// The camera zoom range and heatmap palette live in their friend-modules now;
// re-exported here so every existing consumer keeps importing them from this
// file. The exported `ViewFocus`/`Picked` shapes and `heatColor` are unchanged.
export { MIN_ZOOM, MAX_ZOOM } from "./towerInputCamera";
export { HEATMAP_LABELS, HEATMAP_MODES, HEAT_STOPS, heatColor } from "./towerOverlay";
export type { ViewFocus, Picked } from "./towerInputCamera";

/**
 * The Excalibur-powered tower renderer. Excalibur owns the game loop, scene,
 * camera, off-screen culling, collision/hit-testing and drawing. Structural
 * tiles, rooms and transport shafts are retained actors reconciled
 * incrementally; moving pieces (cars, train, people) are their own actors. The
 * controller (main.ts) drives tools, the sim tick and the DOM UI through the
 * hooks below.
 *
 * The bulk of the renderer lives in friend-modules taking this instance,
 * mirroring `Tower`/`UI`: `towerScene` (construction, baking, sky, lifecycle),
 * `towerReconcile` (retained-scene reconciliation), `towerCrowd` (cars, train,
 * walkers), `towerInputCamera` (input, picking, camera, coords, focus) and
 * `towerOverlay` (2D overlay painters, event visuals). Members those modules
 * read are public and marked `@internal friend-module access`; the class keeps
 * thin delegations and the shared coordinate math.
 */
export class TowerEngine {
  engine: ex.Engine;
  sim: Simulation;
  /** @internal friend-module access (shared draw context). */
  d: DrawCtx;

  // ---- Event visuals (immediate-mode; no Excalibur actors to leak) --------
  /** anim-clock time the current Santa flight started, or null when not flying. */
  santaStart: number | null = null;
  lastSantaSeq = 0;
  /** In-flight bomb flashes: epicenter tile/floor + the anim time it began. */
  explosions: { x: number; floor: number; start: number }[] = [];
  lastExplosionSeq = 0;
  /** A thief slinking along a tower floor; caught → a guard trails him. */
  thiefStart: number | null = null;
  thiefCaught = false;
  thiefFloor = 1;
  lastThiefSeq = 0;
  /** Sparkles at unearthed-treasure dig sites (world tile/floor). */
  treasures: { x: number; floor: number; start: number }[] = [];
  lastTreasureSeq = 0;
  /** The VIP limo's arrival at the lobby. */
  vipStart: number | null = null;
  lastVipSeq = 0;

  // Set by the controller each frame; rendered by the overlay. `reason` is the
  // refusal string (populated only when `valid` is false AND
  // `sim.rules.showsPreviewReason` is true; presentation-only, no engine change).
  preview: { kind: FacilityKind; floor: number; x: number; valid: boolean; span?: number; reason?: string } | null = null;
  transportPreview: { kind: FacilityKind; x: number; bottom: number; top: number; valid: boolean } | null = null;
  selectedId: number | null = null;

  /** Called every frame with elapsed milliseconds (sim ticking lives here). */
  onUpdate: ((ms: number) => void) | null = null;

  /** The GPU dropped the WebGL context (mobile browsers reset it under memory
   *  pressure or after backgrounding). Excalibur can't rebuild its textures and
   *  shaders in place, so the controller must recover — its default handler
   *  would otherwise paint a dead-end "please refresh the page" overlay. The
   *  render clock is already stopped when this fires. */
  onContextLost: (() => void) | null = null;

  /** The browser restored the GPU context (we `preventDefault()` the loss, so
   *  it retries). This engine's own textures and shaders are still gone; the
   *  signal means a FRESH engine can be built now. The controller listens
   *  during in-place recovery and rebuilds on it. */
  onContextRestored: (() => void) | null = null;

  // Controller-supplied input hooks (the controller owns tool semantics). The
  // `picked` argument is the entity Excalibur found under the pointer, or null.
  classifyDown: ((button: number, touch: boolean, space: boolean) => "pan" | "action") | null = null;
  onTap: ((tile: number, floor: number, touch: boolean, picked: Picked | null) => void) | null = null;
  onActionDown: ((tile: number, floor: number, touch: boolean, picked: Picked | null) => void) | null = null;
  onActionMove: ((tile: number, floor: number, picked: Picked | null) => void) | null = null;
  onActionUp: ((tile: number, floor: number, picked: Picked | null) => void) | null = null;
  onHover: ((tile: number, floor: number, picked: Picked | null) => void) | null = null;
  /** Right-click: inspect whatever is under the cursor, regardless of tool. */
  onSecondary: ((picked: Picked | null) => void) | null = null;
  /** Drag/click an in-world extend arrow on the selected elevator (#12).
   *  onExtendTo grows/shrinks the dragged end toward a target floor; onExtendEnd
   *  marks the gesture done so cost accounting can reset. */
  onExtendTo: ((end: "up" | "down", targetFloor: number) => void) | null = null;
  onExtendEnd: (() => void) | null = null;
  /** Screen rects of the selected elevator's extend arrows, for hit-testing.
   *  @internal friend-module access (towerInputCamera / towerOverlay). */
  arrowHit: { up?: ScreenRect; down?: ScreenRect } = {};
  /** Active extend-arrow drag (which end of the shaft is being dragged).
   *  @internal friend-module access (towerInputCamera / towerScene). */
  arrowDrag: { end: "up" | "down" } | null = null;

  // Excalibur pointer gesture state. Contacts are tracked by their NATIVE
  // pointer id (stablePointerId), never Excalibur's public id: Excalibur 0.32
  // renumbers its ids when a contact lifts mid-gesture, which used to strand a
  // phantom entry that turned every later one-finger press into a bogus pinch
  // (stuck zoom, taps swallowed before placement). The two-finger pinch pans
  // by the finger midpoint AND zooms by the finger-distance ratio, so mobile
  // keeps a pan path while a paint tool owns the one-finger drag.
  tracker = new PinchTracker();
  gesture: "pan" | "action" | null = null;
  moved = 0;
  downTouch = false;
  lastSx = 0;
  lastSy = 0;

  // Retained scene graph, reconciled by stable id.
  /** Static floor/lobby tiles live in ONE TileMap entity, not per-tile actors:
   *  a full late-game slab is ~9,000+ one-tile units, and paying Excalibur's
   *  per-actor update/draw overhead for each of them dominated the frame on
   *  phones (measured ~55% of a paused frame on a 10,344-unit save). The
   *  TileMap culls to on-screen cells and costs one entity. Cells keep the
   *  exact same shared baked canvases the actors used, so pixels don't change.
   *  Keyed by unit id, mirroring the other reconcile maps. */
  structTileMap!: ex.TileMap;
  structTiles = new Map<number, ex.Tile>();
  roomActors = new Map<number, RoomRec>();
  roomSig = new Map<number, string>();
  transportActors = new Map<number, ex.Actor>();
  transportSig = new Map<number, string>();
  // Engine-animated actors, regenerated when the layout changes.
  carActors: {
    actor: ex.Actor;
    t: Transport;
    i: number;
    seed: number;
    w: number;
    /** Elevator kind, threaded to drawCar so each cab wears its type's look. */
    kind: FacilityKind;
    /** Lazily-built cab graphics keyed by indicator state (riders:arrow:full). */
    gfx: Map<string, ex.Canvas>;
    shown: string;
  }[] = [];
  trainActors: { actor: ex.Actor; u: Unit; w: number }[] = [];
  /** The pre-dawn garbage truck: one per recycling center, visible only during
   *  the collection hour (drives in, loads, drives off — like the metro train). */
  truckActors: { actor: ex.Actor; u: Unit; w: number }[] = [];
  /** Commute cars cruising the garage decks at rush hours: one per basement
   *  floor that carries parking, ping-ponging along that floor's parking run. */
  garageCars: { actor: ex.Actor; floor: number; x0w: number; x1w: number; seed: number }[] = [];
  walkers: Walker[] = [];
  crowdCulled = false; // zoom-cull latch: crowd per-frame work skipped (crowdCull.ts)
  /** Active colored stats overlay (congestion / occupancy / satisfaction), or
   *  null for off. Set by the controller from a UI toggle; drawn over the tower
   *  as a semi-transparent per-floor heatmap with a legend. */
  overlayMode: HeatmapMode | null = null;
  /** Cached heatmap for the active overlay, refreshed on the hour, on a layout
   *  change, or when the mode flips — never per frame (it scans the unit list).
   *  @internal friend-module access (towerOverlay). */
  heatmap: HeatCell[] = [];
  heatmapHour = -1;
  heatmapTowerRev = -1;
  heatmapMealRev = -1;
  heatmapMode: HeatmapMode | null = null;
  /** The busiest floor's raw congestion ratio when the congestion overlay was
   *  last (re)built — surfaced in the legend so an all-green map still reports
   *  its headroom. 0 for the non-congestion overlays. Refreshed with the cache,
   *  never per frame. */
  heatmapPeakCongestion = 0;
  /** Garage/waste display fractions (parking-in-use, recycling-fill), computed
   *  once per syncScene — reusing the parking flood-fill that sync already does
   *  for the dead-bit — so they're exactly as fresh as the sprites that consume
   *  them and never run on the per-frame path (updateMotion reads them too).
   *  @internal friend-module access (towerScene / towerCrowd). */
  displayParkingUse = 0;
  displayRecycleFill = 0;
  /** Per-floor live occupancy in 0..1 (people on the floor, capped), so corridor
   *  loiterers only appear where tenants actually are. Cached and recomputed on
   *  the hour or when the layout changes — not scanned every frame.
   *  @internal friend-module access (towerCrowd / towerScene). */
  floorLive = new Map<number, number>();
  floorLiveHour = -1;
  floorLiveRev = -1;
  /** @internal friend-module access (towerScene setSim; read in tick). */
  builtRev = -1;
  mealOverlayRev = -1;
  /** @internal friend-module access (towerScene). */
  litState = false;
  /** @internal friend-module access (towerSyncSchedule). */
  lastSyncHour = -1;
  hourSyncPending = false; // an hour-driven reconcile booked for the next frame
  /** Set by the controller from the game speed: when paused, the decorative
   *  animation clock stops so on-screen people freeze with everything else. */
  paused = false;
  /** When true, the decorative animation clock is frozen (accessibility). Every
   *  `d.anim`-driven decoration stops — the ambient bed (clouds, rain streaks,
   *  pacing walkers, metro train) and the smaller flourishes in the sprite code
   *  (construction crane hook, flame flicker, cinema marquee). All of it is purely
   *  cosmetic: elevator cars and the routed crowd move from sim state (not
   *  `d.anim`), so functional motion keeps running while the animation stops. */
  reducedMotion = false;
  setReducedMotion(on: boolean): void {
    overlayFx.setReducedMotion(this, on);
  }

  /** Frame-clock-derived animation time that only advances while unpaused.
   *  @internal friend-module access (towerOverlay resetDecorativeClock). */
  animClock = 0;
  /** Reset the decorative animation clock to zero (see towerOverlay). */
  resetDecorativeClock(): void {
    overlayFx.resetDecorativeClock(this);
  }

  // Individually-routed commuters (SimTower's signature) are owned and advanced
  // by the engine; the renderer only draws each person and removes them as they
  // despawn — it never mutates the simulation.
  crowdActors = new Map<number, { actor: ex.Actor; gfx: ex.Canvas; red: boolean }>();

  // Shared graphics so thousands of tiles/people cost almost nothing.
  floorGfx!: ex.Canvas;
  /** Lobby tile variants, baked per [lit][ground][variant] so the concourse
   *  pattern (columns, chandeliers/planters) repeats and lights up at night. */
  lobbyGfx!: ex.Canvas[][][];
  /** The two slices of the wide grand entrance storefront, baked per [lit].
   *  The left slice is the display window with the chandelier visible through
   *  the glass; the right slice carries the double doors and the swaying
   *  doorman. Both are `cache: false` because the right slice's doorman reads
   *  `d.anim`, and keeping both on the same path is simpler than mixing
   *  cache-true / cache-false through the same predicate. */
  entranceGrandLeftGfx!: ex.Canvas[];
  entranceGrandRightGfx!: ex.Canvas[];
  /** The compact 1-tile grand entrance, used only when the lobby is too narrow
   *  to fit the wide storefront (a 1-tile toy lobby). `cache: false` for the
   *  doorman sway. */
  entranceGrandSoloGfx!: ex.Canvas[];
  /** The floor-1 service entrance tile, baked per [lit]. Static (`cache: true`)
   *  because it has no motion of its own. */
  entranceServiceGfx!: ex.Canvas[];
  /** Per-tile entrance kind for the floor-1 lobby, refreshed at the top of
   *  every {@link reconcile.syncScene} sweep. Keyed by grid x; absent x means the
   *  tile takes its slot from the normal 4-variant cycle. Recomputed from the
   *  tower's floor-1 lobby tiles by walking their CONTIGUOUS runs so a gap in
   *  the middle of the lobby (mid-remodel bulldoze) can't orphan a grand-left
   *  half-facade with no grand-right neighbor. */
  floor1EntranceMap: Map<number, "grand-left" | "grand-right" | "grand-solo" | "service"> = new Map();
  /** Fire-escape segments, baked per [side][floor parity] (shared by all floors). */
  escGfx!: { left: ex.Canvas[]; right: ex.Canvas[] };
  /** Ground-floor entrance awnings, baked per side. They stand in for the fire
   *  escape on floor 1 (see {@link reconcile.syncEscapes}). */
  awningGfx!: { left: ex.Canvas; right: ex.Canvas };
  /** Exterior escape-stair actors per above-ground floor, keyed by floor. */
  escapeActors = new Map<number, { l: ex.Actor; r: ex.Actor; sig: string }>();
  /** The rooftop construction crane (present until the 100th floor tops out). */
  craneActor: ex.Actor | null = null;
  /** The crane's canvas; tick() flags it dirty while the decorative clock runs. */
  craneGfx: ex.Canvas | null = null;
  personGfx: ex.Canvas[] = [];
  personGfxRed!: ex.Canvas;
  personGfxStaff!: ex.Canvas;

  /** @internal friend-module access (towerScene make* / towerOverlay draw). */
  overlay!: ex.ScreenElement;
  overlayCanvas!: ex.Canvas;
  sky!: ex.ScreenElement;
  skyCanvas!: ex.Canvas;

  constructor(canvas: HTMLCanvasElement, sim: Simulation) {
    this.sim = sim;
    this.engine = new ex.Engine({
      canvasElement: canvas,
      displayMode: ex.DisplayMode.FillContainer,
      pixelArt: true,
      antialiasing: false,
      suppressPlayButton: true,
      suppressConsoleBootMessage: true,
      backgroundColor: ex.Color.fromHex("#7fb0e0"),
      // No gameplay uses collisions — actors are positioned directly and picking
      // goes through Actor.contains(), which reads collider geometry without the
      // simulation. Left on, Excalibur's broadphase/narrowphase/solver dominates
      // the frame once a tower reaches ~1000 actors (profiled at >25% of frame
      // time on a big save), driving phones into a sub-2fps "freeze".
      physics: false,
      handleContextLost: (e) => {
        e.preventDefault(); // spec: signals the browser we own recovery
        this.engine.clock.stop(); // every GL call is dead now — stop the loop
        this.onContextLost?.();
      },
      handleContextRestored: () => this.onContextRestored?.(),
    });
    this.d = { ctx: null as unknown as CanvasRenderingContext2D, lit: false, anim: 0, hour: 9, stress: 0 };
    this.engine.currentScene.onPostUpdate = (_e: ex.Engine, elapsed: number) => this.tick(elapsed);
  }

  async start(): Promise<void> {
    await this.engine.start();
    this.engine.currentScene.camera.zoom = 0.9;
    scene.bakeSharedGraphics(this);
    scene.makeStructTileMap(this);
    scene.makeGround(this);
    scene.makeSky(this);
    scene.makeOverlay(this);
    // A boot-loaded autosave restores its saved view; a fresh tower centers.
    this.adoptCamera(this.sim.view);
    // Bake the boot scene against the real clock instead of the d defaults:
    // the hour-driven resync now defers a frame (towerSyncSchedule), so a
    // stale boot bake would actually display instead of being fixed pre-draw.
    this.d.hour = this.sim.clock.hour;
    this.d.lit = displayLit(this.sim.clock);
    this.litState = this.d.lit;
    this.lastSyncHour = this.d.hour;
    this.syncScene();
    this.syncMotion();
    this.syncFacade();
    this.builtRev = this.sim.tower.revision;
    this.mealOverlayRev = this.sim.tower.mealOverlayRevision;
    camera.bindInput(this);
  }

  private tick(elapsedMs: number): void {
    const c = this.sim.clock;
    // Advance the decorative animation clock by the frame's elapsed time, but
    // only while the game is running: paused (speed 0) freezes the walkers,
    // train and street just like the simulated crowd and elevators. `elapsedMs`
    // comes from the engine clock, not wall time, so a manually stepped clock
    // (the screenshot generator swaps in Excalibur's TestClock) advances the
    // decorations deterministically; under the standard clock it is the real
    // per-frame delta, so live play is effectively unchanged. The one visible
    // difference from the old performance.now() delta: Excalibur clamps a frame
    // longer than 200ms (a tab switch or stall) to 1ms, so the decorations
    // resume from where they froze instead of jumping ahead. That is a slight
    // improvement, and it never affects a screenshot (the clock is stepped).
    // Freeze the decorative clock when paused OR reduced-motion is on; functional
    // motion (cars, routed crowd) advances from sim state, not this clock.
    const animating = !this.paused && !this.reducedMotion;
    if (animating) this.animClock += elapsedMs / 1000;
    this.d.anim = this.animClock;
    this.syncEventFx(animating);
    this.d.hour = c.hour;
    this.d.lit = displayLit(c);
    // Drain last frame's deferred reconcile BEFORE the crane lit check and
    // the sim advance in onUpdate (re-stack rationale: drainSceneSync's doc).
    drainSceneSync(this);
    // Garage/waste display fractions (this.d.parkingUse / recycleFill) are
    // refreshed inside syncScene — the same moment the sprites that read them
    // re-bake — so they're never staler than the sprite, and the flood-fill /
    // scans stay off this per-frame path.
    // The crane repaints while the decorative clock moves (trolley, hook,
    // beacon); the lighting flip (cab window) rides the scene sync instead,
    // so it lands once, aligned with the room repaint (towerSyncSchedule).
    if (this.craneGfx && animating) this.craneGfx.flagDirty();
    this.d.stress = Math.max(0, Math.min(1, this.sim.congestion() - 1));
    // Read-only queue + car-fill projection for the transport render path.
    // Memoized on the (step, revision) key in the engine, so this per-frame read
    // returns the cached snapshot without re-scanning the crowd, except on the
    // first call after the sim steps or the tower structure changes (for example
    // a paused structural edit), which rebuilds once. The queue render that draws
    // from it is a follow-up story.
    this.d.elevatorQueue = this.sim.crowd.queueView(this.sim.tower);
    this.engine.backgroundColor = ex.Color.fromHex(scene.skyColor(c.hour));
    if (this.onUpdate) this.onUpdate(elapsedMs);

    // Reconcile room/structure actors when the model, lighting, the hour, or a
    // meal-overlay repaint trigger changes; hour-driven reconciles defer to
    // the next frame's drain above (towerSyncSchedule, spec CAP-3).
    runSceneSync(this);
    this.updateMotion();
    this.reconcileCrowd();
  }

  // ---- Delegations to friend-modules --------------------------------------

  setSim(sim: Simulation, opts?: { keepCamera?: boolean }): void {
    scene.setSim(this, sim, opts);
  }

  // Frame-pump steps for fake-driven ticks (stub these three directly). The
  // scene syncs route through towerSyncSchedule's module functions: whitebox
  // tests observe those with module mocks on towerReconcile/towerCrowd (see
  // towerEngineMealOverlay.test.ts); start() still uses the delegations below.
  private syncEventFx(animating: boolean): void { overlayFx.syncEventFx(this, animating); }
  private syncScene(): void { reconcile.syncScene(this); }
  private syncFacade(): void { reconcile.syncFacade(this); }
  private syncMotion(): void { crowd.syncMotion(this); }
  private updateMotion(): void { crowd.updateMotion(this); }
  private reconcileCrowd(): void { crowd.reconcileCrowd(this); }

  /** Camera policy for a swapped-in (or boot-loaded) tower (see towerInputCamera).
   *  @internal friend-module access (towerScene setSim). */
  adoptCamera(view: SerializedView | null, keepCamera?: boolean): void {
    camera.adoptCamera(this, view, keepCamera);
  }

  /** Top-most unit/transport whose Excalibur collider contains the point. */
  pickEntityAt(world: ex.Vector): Picked | null {
    return camera.pickEntityAt(this, world);
  }

  pan(dxScreen: number, dyScreen: number): void {
    camera.pan(this, dxScreen, dyScreen);
  }
  zoomAt(factor: number, sx: number, sy: number): void {
    camera.zoomAt(this, factor, sx, sy);
  }
  /** @internal friend-module access (towerInputCamera) / prototype tests. */
  dynamicMinZoom(): number {
    return camera.dynamicMinZoom(this);
  }
  /** @internal friend-module access (towerInputCamera) / prototype tests. */
  clampGestureZoom(z: number): number {
    return camera.clampGestureZoom(this, z);
  }
  center(): void {
    camera.center(this);
  }

  /** The live camera as save-file cargo (see towerInputCamera). */
  viewState(): SerializedView {
    return camera.viewState(this);
  }
  /** @internal friend-module access (towerInputCamera adoptCamera) / prototype tests. */
  applyView(v: SerializedView): void {
    camera.applyView(this, v);
  }
  /** Zoom by a factor about the current center (keyboard +/- zoom). */
  zoomBy(factor: number): void {
    camera.zoomBy(this, factor);
  }
  /** Pan the minimum amount so tile/floor sits within the viewport (with a margin). */
  ensureVisible(tile: number, floor: number): void {
    camera.ensureVisible(this, tile, floor);
  }
  setCamera(tileX: number, floor: number, zoom: number): void {
    camera.setCamera(this, tileX, floor, zoom);
  }

  focus(): ViewFocus {
    return camera.focus(this);
  }

  // ---- Coordinate math ----------------------------------------------------

  get viewWidth(): number {
    return this.engine.screen.resolution.width;
  }
  get viewHeight(): number {
    return this.engine.screen.resolution.height;
  }
  /** @internal friend-module access (towerInputCamera / towerOverlay). */
  get cam(): ex.Camera {
    return this.engine.currentScene.camera;
  }

  worldX(tile: number): number {
    return tile * TILE;
  }
  worldYTop(floor: number, h = 1): number {
    return -(floor + h - 1) * FLOOR;
  }
  /** @internal friend-module access (towerInputCamera). */
  screenToWorld(sx: number, sy: number): ex.Vector {
    return this.engine.screenToWorldCoordinates(ex.vec(sx, sy));
  }
  worldToScreenX(tile: number): number {
    return this.engine.worldToScreenCoordinates(ex.vec(tile * TILE, 0)).x;
  }
  worldToScreenY(floor: number): number {
    return this.engine.worldToScreenCoordinates(ex.vec(0, -floor * FLOOR)).y;
  }
  screenToTile(sx: number): number {
    return Math.floor(this.screenToWorld(sx, this.viewHeight / 2).x / TILE);
  }
  screenToFloor(sy: number): number {
    return Math.ceil(-this.screenToWorld(this.viewWidth / 2, sy).y / FLOOR);
  }

  // ---- Engine lifecycle (see towerScene) ----------------------------------

  /** True when the engine draws through WebGL (else a degraded Canvas2D
   *  fallback the recovery path treats as a failed rebuild). */
  rendersWithWebGL(): boolean {
    return scene.rendersWithWebGL(this);
  }

  /** Full teardown, used by in-place context-loss recovery before a rebuild. */
  dispose(): void {
    scene.dispose(this);
  }
}
