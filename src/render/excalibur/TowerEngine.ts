import * as ex from "excalibur";
import type { Simulation, HeatmapMode, HeatCell } from "../../engine/Simulation";
import { GARBAGE_COLLECT_HOUR, GRID, facilityFloors, hasBusinessHours, isElevatorKind, isOpenAt, transportCarCapacity } from "../../engine/facilities";
import type { FacilityKind, Transport, Unit, WeatherKind } from "../../engine/types";
import { isOperational } from "../../engine/types";
import {
  CRANE_H,
  CRANE_W,
  craneAnchorTile,
  drawCar,
  drawCrane,
  drawEscapeStairs,
  drawGarbageTruck,
  drawMetroTrain,
  drawStreetCar,
  drawTransport,
  drawUnit,
  ESCAPE_W,
  LOBBY_VARIANTS,
  lobbyVariant,
  type DrawCtx,
} from "../sprites";
import { drawSanta, drawExplosion, drawThief, drawTreasure, drawVipLimo } from "../sprites/events";
import { carIndicator, type CarIndicator } from "../carIndicator";
import { person, SHIRTS } from "../pixelSprites";
import type { Person } from "../../engine/Crowd";
import { clampCameraY } from "../cameraBounds";
import { facadeGeometry, type FloorEdge } from "../facadeGeometry";

/** World pixels per tile / per floor. */
export const TILE = 11;
export const FLOOR = 34;

/** Max floors drawn into a single shaft-graphic band. A shaft's backing bitmap
 *  is `floors * FLOOR` px tall; a mobile GPU's MAX_TEXTURE_SIZE is often 4096 and
 *  sometimes 2048, and a bitmap past that fails to upload (renders black). 48
 *  floors → 1632px, safely under both, so tall shafts are split into bands. */
const TRANSPORT_BAND_FLOORS = 48;

/** Camera zoom range (screen pixels per world pixel). */
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3;
const clampZoom = (z: number): number =>
  Number.isFinite(z) ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)) : MIN_ZOOM;

/** The empty, idle cab state used to seed a fresh car's graphic. */
const IDLE_CAR: CarIndicator = { riders: 0, arrow: null, full: false };

/** Legend copy for each stats-overlay mode. */
export const HEATMAP_LABELS: Record<HeatmapMode, { title: string; good: string; bad: string }> = {
  congestion: { title: "Congestion", good: "clear", bad: "jammed" },
  occupancy: { title: "Occupancy", good: "full", bad: "vacant" },
  satisfaction: { title: "Satisfaction", good: "happy", bad: "unhappy" },
};

/** The overlay modes in cycle order (a UI toggle steps Off → each → Off). */
export const HEATMAP_MODES: HeatmapMode[] = ["congestion", "occupancy", "satisfaction"];

/** Heatmap ramp stops (green → chartreuse → amber → red). The chartreuse
 *  waypoint gives the green→amber leg real resolution, so the lived-in low end
 *  of a metric (e.g. a healthy tower's congestion) reads as a gradient rather
 *  than one flat green. The congestion overlay pins its amber stop (⅔) to the
 *  churn threshold — see `CONGESTION_AMBER_SEVERITY` in the engine. Module-level
 *  so the color mixer doesn't rebuild the table on every call (it runs once per
 *  visible floor per frame while an overlay is active). */
export const HEAT_STOPS: readonly (readonly [number, number, number])[] = [
  [63, 184, 90], // green (good)
  [163, 199, 71], // chartreuse
  [224, 169, 78], // amber — the congestion overlay pins churn here (see below)
  [214, 52, 47], // red (bad)
];
const HEAT_SEGS = HEAT_STOPS.length - 1;

/** Severity 0..1 → an rgba tint (green → chartreuse → amber → red) at a fixed
 *  overlay alpha. Linear segments through the evenly-spaced {@link HEAT_STOPS}
 *  so the ramp reads cleanly. Allocation-light (no per-call array/closure) since
 *  it's on the draw path.
 *
 *  Exported for the overlay test that locks the "amber = churn" invariant: the
 *  congestion ramp's `CONGESTION_AMBER_SEVERITY` (⅔) must land exactly on the
 *  amber stop, which holds only while the palette keeps amber at position
 *  ⅔ — i.e. a 4-stop ramp. A test asserts that so a palette edit can't silently
 *  break the anchor. */
export function heatColor(severity: number): string {
  // Clamp to [0,1]; the `> 0` form also folds NaN to 0 so a poisoned severity
  // can never index past the palette and throw on the draw path.
  const s = severity > 0 ? (severity > 1 ? 1 : severity) : 0;
  const seg = Math.min(HEAT_SEGS - 1, Math.floor(s * HEAT_SEGS));
  const t = s * HEAT_SEGS - seg; // 0..1 within the segment
  const a = HEAT_STOPS[seg];
  const b = HEAT_STOPS[seg + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgba(${r},${g},${bl},0.4)`;
}

/**
 * The crowd advances on *game* time, not real time, so the speed control only
 * compresses time and never changes gameplay outcomes (tenant stress). One
 * in-game minute is worth this many of the crowd's internal seconds — small
 * enough that a commute spans a few game-minutes, so at fast speed people
 * simply zip through their trips. A single frame's advance is capped so a long
 * stall (or a freshly loaded save) can't teleport the whole crowd at once.
 */

export interface ViewFocus {
  centerFloor: number;
  dominant: FacilityKind | "outside" | "lobby" | "empty";
  night: boolean;
  /**
   * Current camera zoom (world pixels multiplier). ~0.3 is fully zoomed out
   * — the whole tower in frame — and 3 is a tight close-up. Audio uses this to
   * pull back to a wide "tower overview" bed when zoomed out and to fade in
   * area-specific detail (crowd, kitchen clatter, elevator dings) up close.
   */
  zoom: number;
  /** Today's sky weather; drives an outdoor rain layer in the ambient bed. */
  weather: WeatherKind;
}

/** What the pointer is over, resolved by Excalibur's collider hit-testing. */
export interface Picked {
  type: "unit" | "transport";
  id: number;
  kind: FacilityKind;
}

interface Run {
  kind: "floor" | "lobby";
  floor: number;
  x0: number;
  x1: number;
}

/** A retained room actor plus the mutable inputs its draw closure reads live.
 *  A signature change repaints IN PLACE (`cv.flagDirty()` re-rasterizes the
 *  same bitmap and re-uploads the same WebGL texture) instead of allocating a
 *  fresh canvas + texture. At top speed a big tower flips ~100 room
 *  signatures per real second (hour/lighting/occupancy churn), and the
 *  old kill-and-recreate path let dead canvases and GPU textures pile up
 *  faster than Excalibur's 60s texture GC could drain them — enough sustained
 *  memory pressure that phones killed (and auto-reloaded) the tab. */
interface RoomRec {
  actor: ex.Actor;
  cv: ex.Canvas;
  /** Burning/under-construction rooms animate (cache:false, redrawn every
   *  frame); a transition into or out of an animated state still rebuilds. */
  animated: boolean;
  /** Mutable inputs the draw closure reads live — currently just the "dead
   *  parking space" flag (red X overlay). A separate holder (not a field on
   *  the record) so the closure can capture it before the actor/canvas exist
   *  and the record stays fully typed with no placeholder casts. */
  live: { dead: boolean };
}

/** A single engine-driven walking figure (lobby/corridor walker or climber). */
interface Walker {
  actor: ex.Actor;
  gfx: ex.Canvas;
  x0w: number;
  x1w: number;
  y0w: number;
  y1w: number;
  speed: number;
  dir: number;
  phase: number;
  impatient: boolean;
  red: boolean;
  /** 0..1 position in the crowd; shown only when the tower is busy enough. */
  rank: number;
  /** Floor this figure belongs to (for per-floor occupancy gating). */
  floor: number;
  /** True for corridor loiterers gated on their floor's live occupancy; false
   *  for lobby/stair figures gated on the whole tower's busyness. */
  perFloor: boolean;
}

/**
 * The Excalibur-powered tower renderer. Excalibur owns the game loop, scene,
 * camera, off-screen culling, collision/hit-testing and drawing. Every visible
 * piece is a retained `ex.Actor`: structural tiles, rooms and transport shafts
 * are reconciled incrementally (added/removed/refreshed only when the model
 * actually changes — never a full teardown), while everything that *moves*
 * (elevator cars, the metro train, walking people) is its own actor the engine
 * repositions each frame. The controller (main.ts) drives tools, the sim tick
 * and the DOM UI through the hooks below.
 */
/** How long Santa takes to cross the sky, and how long a bomb flash lingers
 *  (seconds of the decorative anim clock — so both freeze under pause /
 *  reduced motion, like every other decoration). */
const SANTA_FLIGHT_SECONDS = 7;
const EXPLOSION_SECONDS = 0.9;
const THIEF_RUN_SECONDS = 4;
const TREASURE_SECONDS = 1.8;
const VIP_VISIT_SECONDS = 6.5;
/** Hard cap on simultaneous flashes/sparkles — the events are rare, but never
 *  let the lists grow unbounded (immediate-mode draws, no actors, so this is the
 *  only bound needed). */
const MAX_EXPLOSIONS = 8;
const MAX_TREASURES = 6;

export class TowerEngine {
  engine: ex.Engine;
  sim: Simulation;
  private d: DrawCtx;

  // ---- Event visuals (immediate-mode; no Excalibur actors to leak) --------
  /** anim-clock time the current Santa flight started, or null when not flying. */
  private santaStart: number | null = null;
  private lastSantaSeq = 0;
  /** In-flight bomb flashes: epicenter tile/floor + the anim time it began. */
  private explosions: { x: number; floor: number; start: number }[] = [];
  private lastExplosionSeq = 0;
  /** A thief slinking along a tower floor; caught → a guard trails him. */
  private thiefStart: number | null = null;
  private thiefCaught = false;
  private thiefFloor = 1;
  private lastThiefSeq = 0;
  /** Sparkles at unearthed-treasure dig sites (world tile/floor). */
  private treasures: { x: number; floor: number; start: number }[] = [];
  private lastTreasureSeq = 0;
  /** The VIP limo's arrival at the lobby. */
  private vipStart: number | null = null;
  private lastVipSeq = 0;

  // Set by the controller each frame; rendered by the overlay.
  preview: { kind: FacilityKind; floor: number; x: number; valid: boolean; span?: number } | null = null;
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
  /** Screen rects of the selected elevator's extend arrows, for hit-testing. */
  private arrowHit: { up?: ScreenRect; down?: ScreenRect } = {};
  /** Active extend-arrow drag (which end of the shaft is being dragged). */
  private arrowDrag: { end: "up" | "down" } | null = null;

  // Excalibur pointer gesture state.
  private pointers = new Map<number, { sx: number; sy: number }>();
  private gesture: "pan" | "action" | null = null;
  private pinch: { dist: number } | null = null;
  private moved = 0;
  private downTouch = false;
  private lastSx = 0;
  private lastSy = 0;

  // Retained scene graph, reconciled by stable id.
  private structActors = new Map<number, ex.Actor>();
  private roomActors = new Map<number, RoomRec>();
  private roomSig = new Map<number, string>();
  private transportActors = new Map<number, ex.Actor>();
  private transportSig = new Map<number, string>();
  // Engine-animated actors, regenerated when the layout changes.
  private carActors: {
    actor: ex.Actor;
    t: Transport;
    i: number;
    seed: number;
    w: number;
    /** Lazily-built cab graphics keyed by indicator state (riders:arrow:full). */
    gfx: Map<string, ex.Canvas>;
    shown: string;
  }[] = [];
  private trainActors: { actor: ex.Actor; u: Unit; w: number }[] = [];
  /** The pre-dawn garbage truck: one per recycling center, visible only during
   *  the collection hour (drives in, loads, drives off — like the metro train). */
  private truckActors: { actor: ex.Actor; u: Unit; w: number }[] = [];
  /** Commute cars cruising the garage decks at rush hours: one per basement
   *  floor that carries parking, ping-ponging along that floor's parking run. */
  private garageCars: { actor: ex.Actor; floor: number; x0w: number; x1w: number; seed: number }[] = [];
  private walkers: Walker[] = [];
  /** Active colored stats overlay (congestion / occupancy / satisfaction), or
   *  null for off. Set by the controller from a UI toggle; drawn over the tower
   *  as a semi-transparent per-floor heatmap with a legend. */
  overlayMode: HeatmapMode | null = null;
  /** Cached heatmap for the active overlay, refreshed on the hour, on a layout
   *  change, or when the mode flips — never per frame (it scans the unit list). */
  private heatmap: HeatCell[] = [];
  private heatmapHour = -1;
  private heatmapRev = -1;
  private heatmapMode: HeatmapMode | null = null;
  /** The busiest floor's raw congestion ratio when the congestion overlay was
   *  last (re)built — surfaced in the legend so an all-green map still reports
   *  its headroom. 0 for the non-congestion overlays. Refreshed with the cache,
   *  never per frame. */
  private heatmapPeakCongestion = 0;
  /** Garage/waste display fractions (parking-in-use, recycling-fill), computed
   *  once per syncScene — reusing the parking flood-fill that sync already does
   *  for the dead-bit — so they're exactly as fresh as the sprites that consume
   *  them and never run on the per-frame path (updateMotion reads them too). */
  private displayParkingUse = 0;
  private displayRecycleFill = 0;
  /** Per-floor live occupancy in 0..1 (people on the floor, capped), so corridor
   *  loiterers only appear where tenants actually are. Cached and recomputed on
   *  the hour or when the layout changes — not scanned every frame. */
  private floorLive = new Map<number, number>();
  private floorLiveHour = -1;
  private floorLiveRev = -1;
  private builtRev = -1;
  private litState = false;
  private lastSyncHour = -1;
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
    this.reducedMotion = on;
    // A frozen anim clock can't advance an event visual to completion, so drop
    // any in flight rather than leave one stuck on screen.
    if (on) {
      this.santaStart = null;
      this.explosions = [];
      this.thiefStart = null;
      this.thiefCaught = false;
      this.treasures = [];
      this.vipStart = null;
    }
  }

  /**
   * Poll the sim's cosmetic fx counters and start/retire the matching event
   * visuals. New visuals only begin while animating (reduced motion / pause
   * suppress fresh motion, matching every other decoration); in-flight ones
   * retire when their window on the anim clock elapses. No Excalibur actors are
   * involved — these are immediate-mode draws — so there is nothing to leak.
   */
  private syncEventFx(animating: boolean): void {
    if (this.sim.santaFxSeq !== this.lastSantaSeq) {
      this.lastSantaSeq = this.sim.santaFxSeq;
      if (animating) this.santaStart = this.d.anim;
    }
    if (this.sim.explosionFx.seq !== this.lastExplosionSeq) {
      this.lastExplosionSeq = this.sim.explosionFx.seq;
      if (animating && this.explosions.length < MAX_EXPLOSIONS) {
        this.explosions.push({ x: this.sim.explosionFx.x, floor: this.sim.explosionFx.floor, start: this.d.anim });
      }
    }
    if (this.sim.thiefFx.seq !== this.lastThiefSeq) {
      this.lastThiefSeq = this.sim.thiefFx.seq;
      if (animating) {
        this.thiefStart = this.d.anim;
        this.thiefCaught = this.sim.thiefFx.caught;
        this.thiefFloor = this.sim.thiefFx.floor;
      }
    }
    if (this.sim.treasureFx.seq !== this.lastTreasureSeq) {
      this.lastTreasureSeq = this.sim.treasureFx.seq;
      if (animating && this.treasures.length < MAX_TREASURES) {
        this.treasures.push({ x: this.sim.treasureFx.x, floor: this.sim.treasureFx.floor, start: this.d.anim });
      }
    }
    if (this.sim.vipFxSeq !== this.lastVipSeq) {
      this.lastVipSeq = this.sim.vipFxSeq;
      if (animating) this.vipStart = this.d.anim;
    }
    if (this.santaStart !== null && this.d.anim - this.santaStart > SANTA_FLIGHT_SECONDS) {
      this.santaStart = null;
    }
    if (this.explosions.length > 0) {
      this.explosions = this.explosions.filter((e) => this.d.anim - e.start <= EXPLOSION_SECONDS);
    }
    if (this.thiefStart !== null && this.d.anim - this.thiefStart > THIEF_RUN_SECONDS) {
      this.thiefStart = null;
    }
    if (this.treasures.length > 0) {
      this.treasures = this.treasures.filter((t) => this.d.anim - t.start <= TREASURE_SECONDS);
    }
    if (this.vipStart !== null && this.d.anim - this.vipStart > VIP_VISIT_SECONDS) {
      this.vipStart = null;
    }
  }
  /** Wall-clock-derived animation time that only advances while unpaused. */
  private animClock = 0;
  private lastAnimWall = 0;

  // Individually-routed commuters (SimTower's signature) are owned and advanced
  // by the engine; the renderer only draws each person and removes them as they
  // despawn — it never mutates the simulation.
  private crowdActors = new Map<number, { actor: ex.Actor; gfx: ex.Canvas; red: boolean }>();

  // Shared graphics so thousands of tiles/people cost almost nothing.
  private floorGfx!: ex.Canvas;
  /** Lobby tile variants, baked per [lit][ground][variant] so the concourse
   *  pattern (columns, chandeliers/planters) repeats and lights up at night. */
  private lobbyGfx!: ex.Canvas[][][];
  /** Fire-escape segments, baked per [side][floor parity] (shared by all floors). */
  private escGfx!: { left: ex.Canvas[]; right: ex.Canvas[] };
  /** Exterior escape-stair actors per above-ground floor, keyed by floor. */
  private escapeActors = new Map<number, { l: ex.Actor; r: ex.Actor; sig: string }>();
  /** The rooftop construction crane (present until the 100th floor tops out). */
  private craneActor: ex.Actor | null = null;
  /** The crane's canvas; tick() flags it dirty while the decorative clock runs. */
  private craneGfx: ex.Canvas | null = null;
  private personGfx: ex.Canvas[] = [];
  private personGfxRed!: ex.Canvas;
  private personGfxStaff!: ex.Canvas;

  private overlay!: ex.ScreenElement;
  private overlayCanvas!: ex.Canvas;
  private sky!: ex.ScreenElement;
  private skyCanvas!: ex.Canvas;

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
    });
    this.d = { ctx: null as unknown as CanvasRenderingContext2D, lit: false, anim: 0, hour: 9, stress: 0 };
    this.engine.currentScene.onPostUpdate = (_e: ex.Engine, elapsed: number) => this.tick(elapsed);
  }

  async start(): Promise<void> {
    await this.engine.start();
    this.engine.currentScene.camera.zoom = 0.9;
    this.bakeSharedGraphics();
    this.makeGround();
    this.makeSky();
    this.makeOverlay();
    this.center();
    this.litState = this.d.lit;
    this.syncScene();
    this.syncMotion();
    this.syncFacade();
    this.builtRev = this.sim.tower.revision;
    this.bindInput();
  }

  // ---- Input (Excalibur pointer system) ----------------------------------

  private tf(ev: ex.PointerEvent): { tile: number; floor: number } {
    return { tile: Math.floor(ev.worldPos.x / TILE), floor: Math.ceil(-ev.worldPos.y / FLOOR) };
  }

  private bindInput(): void {
    const ptr = this.engine.input.pointers;
    ptr.on("down", (ev) => this.pointerDown(ev as ex.PointerEvent));
    ptr.on("move", (ev) => this.pointerMove(ev as ex.PointerEvent));
    ptr.on("up", (ev) => this.pointerUp(ev as ex.PointerEvent));
    ptr.on("cancel", (ev) => this.pointerUp(ev as ex.PointerEvent));
    ptr.on("wheel", (ev) => {
      const w = ev as ex.WheelEvent;
      this.zoomAt(w.deltaY < 0 ? 1.12 : 0.89, w.x, w.y);
    });
  }

  /** Top-most unit/transport whose Excalibur collider contains the point. */
  pickEntityAt(world: ex.Vector): Picked | null {
    let best: Picked | null = null;
    let bestZ = -Infinity;
    for (const [id, a] of this.transportActors) {
      if (a.z >= bestZ && a.contains(world.x, world.y)) {
        const t = this.sim.tower.getTransport(id);
        if (t) {
          best = { type: "transport", id, kind: t.kind };
          bestZ = a.z;
        }
      }
    }
    const considerUnit = (id: number, a: ex.Actor) => {
      if (a.z >= bestZ && a.contains(world.x, world.y)) {
        const u = this.sim.tower.getUnit(id);
        if (u) {
          best = { type: "unit", id, kind: u.kind };
          bestZ = a.z;
        }
      }
    };
    for (const [id, rec] of this.roomActors) considerUnit(id, rec.actor);
    for (const [id, a] of this.structActors) considerUnit(id, a);
    return best;
  }

  private pointerDown(ev: ex.PointerEvent): void {
    this.pointers.set(ev.pointerId, { sx: ev.screenPos.x, sy: ev.screenPos.y });
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy) };
      this.gesture = null;
      this.preview = null;
      this.transportPreview = null;
      return;
    }
    if (this.pointers.size > 2) return;
    this.lastSx = ev.screenPos.x;
    this.lastSy = ev.screenPos.y;
    this.moved = 0;
    const touch = ev.pointerType === "Touch";
    this.downTouch = touch;
    const space = this.engine.input.keyboard.isHeld(ex.Keys.Space);
    // Left-click on a selected elevator's extend arrow grows the shaft.
    if (buttonNum(ev) === 0 && this.onExtendTo) {
      const ps = ev.screenPos;
      const inRect = (r?: ScreenRect) =>
        !!r && ps.x >= r.x && ps.x <= r.x + r.w && ps.y >= r.y && ps.y <= r.y + r.h;
      const end = inRect(this.arrowHit.up) ? "up" : inRect(this.arrowHit.down) ? "down" : null;
      if (end) {
        // Begin a drag: a plain click extends one floor (on pointer-up), while
        // dragging up/down grows or shrinks the shaft floor-by-floor.
        this.arrowDrag = { end };
        this.gesture = null;
        return;
      }
    }
    // Right-click always inspects what's under the cursor, whatever tool is
    // active — it never pans or builds.
    if (buttonNum(ev) === 2 && this.onSecondary) {
      this.onSecondary(this.pickEntityAt(ev.worldPos));
      this.gesture = null;
      return;
    }
    this.gesture = this.classifyDown ? this.classifyDown(buttonNum(ev), touch, space) : "pan";
    if (this.gesture === "action") {
      const { tile, floor } = this.tf(ev);
      this.onActionDown?.(tile, floor, touch, this.pickEntityAt(ev.worldPos));
    }
  }

  private pointerMove(ev: ex.PointerEvent): void {
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { sx: ev.screenPos.x, sy: ev.screenPos.y });
    if (this.pinch) {
      const pts = [...this.pointers.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy);
      const mx = (pts[0].sx + pts[1].sx) / 2;
      const my = (pts[0].sy + pts[1].sy) / 2;
      if (this.pinch.dist > 0) this.zoomAt(dist / this.pinch.dist, mx, my);
      this.pinch.dist = dist;
      return;
    }
    if (this.arrowDrag) {
      this.moved += Math.abs(ev.screenPos.y - this.lastSy);
      this.lastSy = ev.screenPos.y;
      this.onExtendTo?.(this.arrowDrag.end, this.screenToFloor(ev.screenPos.y));
      return;
    }
    const { tile, floor } = this.tf(ev);
    if (this.gesture === "pan") {
      const dx = ev.screenPos.x - this.lastSx;
      const dy = ev.screenPos.y - this.lastSy;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.pan(dx, dy);
      this.lastSx = ev.screenPos.x;
      this.lastSy = ev.screenPos.y;
    } else if (this.gesture === "action") {
      this.onActionMove?.(tile, floor, this.pickEntityAt(ev.worldPos));
    } else {
      this.onHover?.(tile, floor, this.pickEntityAt(ev.worldPos));
    }
  }

  private pointerUp(ev: ex.PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.gesture = null;
      return;
    }
    if (this.arrowDrag) {
      // A press without a drag extends a single floor.
      if (this.moved < 5) {
        const t = this.selectedId == null ? undefined : this.sim.tower.getTransport(this.selectedId);
        if (t) {
          const target = this.arrowDrag.end === "up" ? t.top + 1 : t.bottom - 1;
          this.onExtendTo?.(this.arrowDrag.end, target);
        }
      }
      this.onExtendEnd?.();
      this.arrowDrag = null;
      this.gesture = null;
      return;
    }
    const { tile, floor } = this.tf(ev);
    if (this.gesture === "pan") {
      // Touch taps jitter more than mouse clicks, so allow a larger slop.
      if (this.moved < (this.downTouch ? 14 : 5)) {
        this.onTap?.(tile, floor, ev.pointerType === "Touch", this.pickEntityAt(ev.worldPos));
      }
    } else if (this.gesture === "action") {
      this.onActionUp?.(tile, floor, this.pickEntityAt(ev.worldPos));
    }
    this.gesture = null;
  }

  setSim(sim: Simulation): void {
    this.disposeScene();
    this.clearCrowd();
    // Drop any in-flight event visuals and adopt the new sim's fx baselines, so
    // a tower swap neither leaves Santa mid-sky nor re-fires a stale flash.
    this.santaStart = null;
    this.explosions = [];
    this.thiefStart = null;
    this.thiefCaught = false;
    this.thiefFloor = 1;
    this.treasures = [];
    this.vipStart = null;
    this.lastSantaSeq = sim.santaFxSeq;
    this.lastExplosionSeq = sim.explosionFx.seq;
    this.lastThiefSeq = sim.thiefFx.seq;
    this.lastTreasureSeq = sim.treasureFx.seq;
    this.lastVipSeq = sim.vipFxSeq;
    this.sim = sim;
    this.builtRev = -1;
    // Invalidate the per-floor occupancy cache so a swapped-in tower (new game /
    // load) can't briefly gate walkers on the previous sim's occupancy even if
    // its hour and revision happen to match the cached keys.
    this.floorLiveHour = -1;
    this.floorLiveRev = -1;
    this.floorLive.clear();
    this.center();
  }

  private tick(elapsed: number): void {
    const c = this.sim.clock;
    // Advance the decorative animation clock by real elapsed time, but only
    // while the game is running — paused (speed 0) freezes the walkers, train
    // and street just like the simulated crowd and elevators.
    const nowWall = (globalThis.performance ? performance.now() : 0) / 1000;
    if (this.lastAnimWall === 0) this.lastAnimWall = nowWall;
    // Freeze the decorative clock when paused OR reduced-motion is on; functional
    // motion (cars, routed crowd) advances from sim state, not this clock.
    const animating = !this.paused && !this.reducedMotion;
    if (animating) this.animClock += nowWall - this.lastAnimWall;
    this.lastAnimWall = nowWall;
    this.d.anim = this.animClock;
    this.syncEventFx(animating);
    this.d.hour = c.hour;
    this.d.lit = c.isNight() || c.isEvening();
    // Garage/waste display fractions (this.d.parkingUse / recycleFill) are
    // refreshed inside syncScene — the same moment the sprites that read them
    // re-bake — so they're never staler than the sprite, and the flood-fill /
    // scans stay off this per-frame path.
    // The crane repaints while its inputs move: the decorative clock (trolley,
    // hook, beacon) or a lighting flip (cab window). Frozen clock → no repaint.
    if (this.craneGfx && (animating || this.d.lit !== this.litState)) this.craneGfx.flagDirty();
    this.d.stress = Math.max(0, Math.min(1, this.sim.congestion() - 1));
    this.engine.backgroundColor = ex.Color.fromHex(skyColor(c.hour));
    if (this.onUpdate) this.onUpdate(elapsed);

    // Reconcile room/structure actors when the model, lighting, or the hour
    // changes (occupancy shifts on the hour, so sprites must re-bake then).
    const structuralChanged = this.sim.tower.revision !== this.builtRev;
    if (structuralChanged || this.d.lit !== this.litState || this.d.hour !== this.lastSyncHour) {
      this.litState = this.d.lit;
      this.lastSyncHour = this.d.hour;
      this.syncScene();
    }
    // Motion actors and the exterior facade (escape stairs, roof crane) only
    // need reconciling when the layout itself changes.
    if (structuralChanged) {
      this.syncMotion();
      this.syncFacade();
      this.builtRev = this.sim.tower.revision;
    }
    this.updateMotion();
    this.reconcileCrowd();
  }

  /** Draw the engine-owned commuters: add/remove/position one actor per live
   * person, by stable id. Read-only — the engine advances the crowd in tick(). */
  private reconcileCrowd(): void {
    const seen = new Set<number>();
    for (const p of this.sim.crowd.people) {
      seen.add(p.id);
      let rec = this.crowdActors.get(p.id);
      if (!rec) {
        const gfx = p.staff ? this.personGfxStaff : this.personGfx[Math.abs(p.seed) % this.personGfx.length];
        const a = new ex.Actor({ pos: ex.vec(0, 0), width: 8, height: 14, anchor: ex.vec(0.5, 1), z: 3 });
        a.graphics.use(gfx);
        this.engine.add(a);
        rec = { actor: a, gfx, red: false };
        this.crowdActors.set(p.id, rec);
      }
      this.positionPerson(p, rec);
    }
    this.reap(this.crowdActors, seen, (rec) => rec.actor.kill());
  }

  /** Retained-actor reconciliation tail: kill and forget every entry the
   *  current pass didn't mark as seen. Each reconciler supplies its own
   *  disposal (kill one actor, kill a pair, drop a parallel sig entry). */
  private reap<K, V>(map: Map<K, V>, seen: ReadonlySet<K>, dispose: (v: V, k: K) => void): void {
    for (const [k, v] of map) {
      if (seen.has(k)) continue;
      dispose(v, k);
      map.delete(k);
    }
  }

  private positionPerson(p: Person, rec: { actor: ex.Actor; gfx: ex.Canvas; red: boolean }): void {
    // While riding, a tenant is inside a car — the cab's own rider count shows
    // them, so we hide the standalone figure to avoid drawing them twice.
    // Staff stay visible while riding: a lone housekeeper in a 16-person
    // service cab rounds to zero on the cab's load indicator, and watching
    // them ride to the room floor is the whole point of the mechanic.
    const hidden = p.state === "riding" && !p.staff;
    if (rec.actor.graphics.visible !== !hidden) rec.actor.graphics.visible = !hidden;
    if (hidden) return;
    // Use the continuous floor (fy) so a stair/escalator climber animates
    // smoothly between floors; for every other state fy equals the floor.
    rec.actor.pos = ex.vec(this.worldX(p.x), this.worldYTop(p.fy) + FLOOR - 3);
    // Long waits redden the figure, the original's "this tenant is fed up" cue.
    // Staff never redden — they're on the clock, not an unhappy tenant.
    const red = !p.staff && p.wait > 25;
    if (red !== rec.red) {
      rec.red = red;
      rec.actor.graphics.use(red ? this.personGfxRed : rec.gfx);
    }
  }

  private clearCrowd(): void {
    // Only the drawn actors are ours; the crowd model belongs to the sim.
    for (const rec of this.crowdActors.values()) rec.actor.kill();
    this.crowdActors.clear();
  }

  // ---- Coordinate math ----------------------------------------------------

  get viewWidth(): number {
    return this.engine.screen.resolution.width;
  }
  get viewHeight(): number {
    return this.engine.screen.resolution.height;
  }
  private get cam(): ex.Camera {
    return this.engine.currentScene.camera;
  }

  worldX(tile: number): number {
    return tile * TILE;
  }
  worldYTop(floor: number, h = 1): number {
    return -(floor + h - 1) * FLOOR;
  }
  private screenToWorld(sx: number, sy: number): ex.Vector {
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

  // ---- Camera control (Excalibur camera) ----------------------------------

  pan(dxScreen: number, dyScreen: number): void {
    this.cam.pos = ex.vec(this.cam.pos.x - dxScreen / this.cam.zoom, this.cam.pos.y - dyScreen / this.cam.zoom);
    this.clamp();
  }
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = clampZoom(this.cam.zoom * factor);
    const after = this.screenToWorld(sx, sy);
    this.cam.pos = ex.vec(this.cam.pos.x + (before.x - after.x), this.cam.pos.y + (before.y - after.y));
    this.clamp();
  }
  private clamp(): void {
    const x = Math.max(0, Math.min(GRID.width * TILE, this.cam.pos.x));
    // Zoom-aware vertical clamp: bound the visible top/bottom edges (not just
    // the center) so panning/zooming out never exposes empty void below the
    // deepest buildable basement. See {@link clampCameraY}.
    const y = clampCameraY(this.cam.pos.y, this.viewHeight, this.cam.zoom, FLOOR, GRID.minFloor, GRID.maxFloor);
    this.cam.pos = ex.vec(x, y);
  }
  center(): void {
    const hi = this.sim.tower.highestFloor;
    this.cam.pos = ex.vec((GRID.width / 2) * TILE, -(Math.max(6, hi) / 2) * FLOOR);
  }

  /** Zoom by a factor about the current center (keyboard +/- zoom). */
  zoomBy(factor: number): void {
    this.cam.zoom = clampZoom(this.cam.zoom * factor);
    this.clamp(); // bound both axes, same as pointer zoom
  }

  /** Pan the camera the minimum amount so tile/floor sits within the viewport
   *  (with a margin) — used to follow the keyboard build cursor. */
  ensureVisible(tile: number, floor: number): void {
    const wx = tile * TILE;
    const wy = -floor * FLOOR;
    const halfW = this.viewWidth / 2 / this.cam.zoom;
    const halfH = this.viewHeight / 2 / this.cam.zoom;
    const mx = TILE * 3;
    const my = FLOOR * 1.5;
    let px = this.cam.pos.x;
    let py = this.cam.pos.y;
    if (wx < px - halfW + mx) px = wx + halfW - mx;
    else if (wx > px + halfW - mx) px = wx - halfW + mx;
    if (wy < py - halfH + my) py = wy + halfH - my;
    else if (wy > py + halfH - my) py = wy - halfH + my;
    this.cam.pos = ex.vec(px, py);
    this.clamp(); // bound both axes, same as pointer pan
  }
  setCamera(tileX: number, floor: number, zoom: number): void {
    // Validate zoom to the supported range: the vertical clamp divides by zoom,
    // so a zero/negative/NaN value here would poison later pan/zoom math.
    this.cam.zoom = clampZoom(zoom);
    this.cam.pos = ex.vec(tileX * TILE, -floor * FLOOR);
  }

  // ---- Static scene elements ----------------------------------------------

  private makeGround(): void {
    const total = GRID.width * TILE * 3;
    const centerX = (GRID.width / 2) * TILE;
    const depth = (2 - GRID.minFloor + 14) * FLOOR;
    const leftEdge = centerX - total / 2;
    // One rectangle this wide (~11k px) would rasterize to a bitmap past the GPU
    // texture limit (4096 on mobile) and render as a black band. It needs the
    // full width to cover the dirt when zoomed out at the camera's edge, so tile
    // it into texture-safe segments instead (seamless — same solid color).
    // Keep each segment under 2048px — the lowest MAX_TEXTURE_SIZE on older
    // mobile GPUs (the transport-shaft cap stays under this too).
    const MAX_SEG = 2000;
    const segments = Math.ceil(total / MAX_SEG);
    const segW = total / segments;
    for (let i = 0; i < segments; i++) {
      const segCx = leftEdge + segW * (i + 0.5);
      const dirt = new ex.Actor({
        pos: ex.vec(segCx, 0),
        width: segW + 1, // overlap neighbors by 1px to hide any seam
        height: depth,
        anchor: ex.vec(0.5, 0),
        z: -50,
        color: ex.Color.fromHex("#3a3326"),
      });
      this.engine.add(dirt);
      this.engine.add(
        new ex.Actor({
          pos: ex.vec(segCx, 0),
          width: segW + 1,
          height: 6,
          anchor: ex.vec(0.5, 0.5),
          z: -49,
          color: ex.Color.fromHex("#6f6a60"),
        }),
      );
    }
  }

  /**
   * Sun/moon on a screen-space layer placed *below* the world ground and tower
   * (a z under the dirt). They hang in the open sky, and as you pan, the dirt
   * and the building slide over them and hide them at the horizon — so it pans
   * correctly with no manual clipping.
   */
  private makeSky(): void {
    // cache:false is deliberate (like the overlay below): this is a full-viewport
    // screen layer whose pixels change every frame — the sun/moon arc and clouds
    // drift on the decorative clock. A cached canvas would have to flagDirty()
    // every frame, which re-rasterizes AND re-uploads the whole texture anyway
    // (see the RoomRec cache note) — no reuse to gain, just extra plumbing.
    this.skyCanvas = new ex.Canvas({
      width: this.viewWidth,
      height: this.viewHeight,
      cache: false,
      draw: (ctx) => this.drawSky(ctx),
    });
    this.sky = new ex.ScreenElement({ x: 0, y: 0, z: -60 });
    this.sky.graphics.use(this.skyCanvas);
    this.engine.add(this.sky);
  }

  private drawSky(ctx: CanvasRenderingContext2D): void {
    if (this.skyCanvas.width !== this.viewWidth || this.skyCanvas.height !== this.viewHeight) {
      this.skyCanvas.width = this.viewWidth;
      this.skyCanvas.height = this.viewHeight;
    }
    ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
    this.drawSun(ctx);
    this.drawClouds(ctx);
    this.renderSanta(ctx);
  }

  /** Santa's sleigh crossing the sky during a holiday cameo (see syncEventFx). */
  private renderSanta(ctx: CanvasRenderingContext2D): void {
    if (this.santaStart === null) return;
    const p = (this.d.anim - this.santaStart) / SANTA_FLIGHT_SECONDS;
    if (p < 0 || p > 1) return;
    // Slide fully across, offscreen to offscreen, with a gentle bob.
    const x = -160 + p * (this.viewWidth + 320);
    const y = this.viewHeight * 0.15 + Math.sin(p * Math.PI * 3) * 12;
    drawSanta(ctx, x, y, 1.15);
  }

  private makeOverlay(): void {
    // cache:false is deliberate: this full-viewport screen layer changes every
    // frame — the ruler always draws, the build-preview ghost tracks the cursor,
    // rain animates, and the stats heatmap's tints follow the camera (their
    // screen coords come from worldToScreen). Nothing here is stable across
    // frames, so a cached canvas would need a per-frame flagDirty() that
    // re-rasterizes and re-uploads the whole texture regardless — equal cost to
    // cache:false, plus extra plumbing and a staleness-bug risk. The *expensive*
    // input (the per-hour heatmap scan) is cached separately in drawStatsMap.
    this.overlayCanvas = new ex.Canvas({
      width: this.viewWidth,
      height: this.viewHeight,
      cache: false,
      draw: (ctx) => this.drawOverlay(ctx),
    });
    this.overlay = new ex.ScreenElement({ x: 0, y: 0, z: 100 });
    this.overlay.graphics.use(this.overlayCanvas);
    this.engine.add(this.overlay);
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    if (this.overlayCanvas.width !== this.viewWidth || this.overlayCanvas.height !== this.viewHeight) {
      this.overlayCanvas.width = this.viewWidth;
      this.overlayCanvas.height = this.viewHeight;
    }
    ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
    this.drawStatsMap(ctx);
    this.drawRain(ctx);
    this.renderExplosions(ctx);
    this.renderTreasures(ctx);
    this.renderVip(ctx);
    this.renderThief(ctx);
    this.drawPreview(ctx);
    this.drawSelection(ctx);
    this.drawRuler(ctx);
  }

  /** Bomb-blast flashes at their epicenters, projected to screen (see syncEventFx). */
  private renderExplosions(ctx: CanvasRenderingContext2D): void {
    if (this.explosions.length === 0) return;
    for (const e of this.explosions) {
      const p = (this.d.anim - e.start) / EXPLOSION_SECONDS;
      if (p < 0 || p > 1) continue;
      const sx = this.worldToScreenX(e.x);
      const sy = this.worldToScreenY(e.floor) + (FLOOR * this.cam.zoom) / 2;
      const radius = (24 + p * 56) * this.cam.zoom;
      drawExplosion(ctx, sx, sy, radius, p);
    }
  }

  /** Gold sparkles rising from unearthed-treasure dig sites (see syncEventFx). */
  private renderTreasures(ctx: CanvasRenderingContext2D): void {
    if (this.treasures.length === 0) return;
    for (const t of this.treasures) {
      const p = (this.d.anim - t.start) / TREASURE_SECONDS;
      if (p < 0 || p > 1) continue;
      const sx = this.worldToScreenX(t.x);
      const sy = this.worldToScreenY(t.floor) + (FLOOR * this.cam.zoom) / 2;
      drawTreasure(ctx, sx, sy, Math.max(0.8, this.cam.zoom), p);
    }
  }

  /** The VIP limo arriving at the ground lobby: in from the left, hold, off right. */
  private renderVip(ctx: CanvasRenderingContext2D): void {
    if (this.vipStart === null) return;
    const p = (this.d.anim - this.vipStart) / VIP_VISIT_SECONDS;
    if (p < 0 || p > 1) return;
    const centerSx = this.worldToScreenX(GRID.width / 2);
    const groundSy = this.worldToScreenY(1) + FLOOR * this.cam.zoom * 0.5;
    const off = this.viewWidth * 0.6;
    // The limo faces right, so it drives rightward: in from the left, hold, out
    // to the right (otherwise it moon-walks).
    let x = centerSx;
    if (p < 0.25) x = centerSx - (1 - p / 0.25) * off; // arrive from the left
    else if (p > 0.75) x = centerSx + ((p - 0.75) / 0.25) * off; // depart to the right
    drawVipLimo(ctx, x, groundSy, Math.max(0.9, this.cam.zoom));
  }

  /** A thief slinking along a tower floor (a guard trails him if caught). He
   *  sweeps left→right across the viewport, but his feet are pinned to the
   *  floor he's prowling (world-space Y, like the VIP limo) — so he walks the
   *  tower and scrolls with the camera instead of floating at mid-screen. */
  private renderThief(ctx: CanvasRenderingContext2D): void {
    if (this.thiefStart === null) return;
    const p = (this.d.anim - this.thiefStart) / THIEF_RUN_SECONDS;
    if (p < 0 || p > 1) return;
    const x = -80 + p * (this.viewWidth + 160);
    const y = this.worldToScreenY(this.thiefFloor) + FLOOR * this.cam.zoom * 0.5;
    drawThief(ctx, x, y, Math.max(0.9, this.cam.zoom), this.thiefCaught);
  }

  /** The colored stats overlay: draw each heatmap cell by the active metric
   *  (green = good … red = bad) with a legend — one cell per floor for
   *  congestion/occupancy, one per present unit for satisfaction (so a floor can
   *  show several tints). The heatmap is recomputed only when its inputs change
   *  (hour / layout / mode), never per frame. */
  private drawStatsMap(ctx: CanvasRenderingContext2D): void {
    if (!this.overlayMode) return;
    const hour = this.sim.clock.hour;
    const rev = this.sim.tower.revision;
    if (this.overlayMode !== this.heatmapMode || hour !== this.heatmapHour || rev !== this.heatmapRev) {
      this.heatmap = this.sim.floorHeatmap(this.overlayMode);
      this.heatmapPeakCongestion = this.overlayMode === "congestion" ? this.sim.peakCongestion() : 0;
      this.heatmapMode = this.overlayMode;
      this.heatmapHour = hour;
      this.heatmapRev = rev;
    }
    const z = this.cam.zoom;
    // Visible floor band (computed once) to skip the coordinate transforms for
    // off-screen cells. The loop still visits every cell, but worldToScreenX/Y
    // each run the engine's affine transform and satisfaction can emit one cell
    // per present tenant unit, so gating those two transforms on the band avoids
    // paying them for every off-screen unit in a tall tower each frame.
    const topFloor = this.screenToFloor(0) + 1;
    const botFloor = this.screenToFloor(this.viewHeight) - 1;
    for (const cell of this.heatmap) {
      if (cell.floor < botFloor || cell.floor > topFloor) continue;
      const sx = this.worldToScreenX(cell.minX);
      const sy = this.worldToScreenY(cell.floor);
      const sw = (cell.maxX - cell.minX + 1) * TILE * z;
      const sh = FLOOR * z;
      // Exact per-cell cull for horizontal extent (and any residual vertical
      // slop past the floor-band margin) so partial-edge tints still draw right.
      if (sy + sh < 0 || sy > this.viewHeight || sx + sw < 0 || sx > this.viewWidth) continue;
      ctx.fillStyle = heatColor(cell.severity);
      ctx.fillRect(sx, sy, sw, sh);
    }
    this.drawHeatLegend(ctx);
  }

  /** A compact legend for the active overlay: its name and a good→bad gradient. */
  private drawHeatLegend(ctx: CanvasRenderingContext2D): void {
    const label = HEATMAP_LABELS[this.overlayMode ?? "congestion"];
    const pad = 10;
    const x = 12;
    const y = 12;
    const w = 150;
    const h = 46;
    ctx.fillStyle = "rgba(16,20,28,0.8)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = "#e6ecf5";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label.title, x + pad, y + 17);
    // Congestion reports its busiest floor as a number so an all-green map still
    // tells the player their headroom (peak = share of a shaft's rush budget in
    // use; >100% means over the churn line). Right-aligned on the title row.
    if (this.overlayMode === "congestion") {
      ctx.textAlign = "right";
      ctx.fillStyle = "#c7d0e0";
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.fillText(`peak ${Math.round(this.heatmapPeakCongestion * 100)}%`, x + w - pad, y + 17);
      ctx.textAlign = "left";
    }
    // Gradient bar.
    const bx = x + pad;
    const by = y + 24;
    const bw = w - pad * 2;
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    for (let i = 0; i < HEAT_STOPS.length; i++) grad.addColorStop(i / HEAT_SEGS, heatColor(i / HEAT_SEGS));
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, bw, 7);
    ctx.fillStyle = "#9aa6bd";
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillText(label.good, bx, by + 18);
    ctx.textAlign = "right";
    ctx.fillText(label.bad, bx + bw, by + 18);
    ctx.textAlign = "left";
  }

  /** Clouds drift across the sky on overcast and rainy days (sky layer). */
  private drawClouds(ctx: CanvasRenderingContext2D): void {
    const w = this.sim.weather;
    if (w === "clear") return;
    const W = this.viewWidth;
    const H = this.viewHeight;
    const t = this.d.anim;
    ctx.fillStyle = w === "rain" ? "rgba(86,92,108,0.55)" : "rgba(244,247,255,0.72)";
    for (let i = 0; i < 5; i++) {
      const seed = i * 97 + 11;
      const speed = 6 + (seed % 7);
      const y = H * 0.1 + ((seed % 100) / 100) * H * 0.22;
      const x = (((seed * 53) % (W + 240)) + t * speed) % (W + 240) - 120;
      this.drawCloud(ctx, x, y, 56 + (seed % 44));
    }
  }

  private drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
    ctx.arc(x + r * 0.5, y + 4, r * 0.4, 0, Math.PI * 2);
    ctx.arc(x - r * 0.5, y + 4, r * 0.38, 0, Math.PI * 2);
    ctx.arc(x, y + 9, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Rain falls in front of the tower on rainy days (overlay layer). */
  private drawRain(ctx: CanvasRenderingContext2D): void {
    if (this.sim.weather !== "rain") return;
    const W = this.viewWidth;
    const H = this.viewHeight;
    const t = this.d.anim;
    // A faint overcast tint over the whole scene.
    ctx.fillStyle = "rgba(34,40,56,0.16)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(200,214,236,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 140; i++) {
      const x = ((i * 2654435761) >>> 0) % W;
      const y = (((i * 37) % H) + t * 320) % H;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 9);
    }
    ctx.stroke();
  }

  private drawSun(ctx: CanvasRenderingContext2D): void {
    const hour = this.sim.clock.hour + this.sim.clock.minute / 60;
    // The sun arcs across 06:00→18:00; the moon takes the same arc 18:00→06:00,
    // so both rise in the east, climb, and set in the west.
    const day = hour >= 6 && hour < 18;
    const arc = day ? ((hour - 6) / 12) * Math.PI : (((hour - 18 + 24) % 24) / 12) * Math.PI;
    const cx = (arc / Math.PI) * this.viewWidth;
    const cy = this.viewHeight * 0.62 - Math.sin(arc) * this.viewHeight * 0.5;
    ctx.fillStyle = day ? "#fff7c0" : "#eef";
    ctx.beginPath();
    ctx.arc(cx, cy, day ? 16 : 11, 0, Math.PI * 2);
    ctx.fill();
  }

  /** The translucent placement ghost: gold when valid, red when not. One
   *  explicit stroke width for both ghost kinds — the old transport ghost
   *  never set its own and inherited whatever the overlay context last used
   *  (1, 1.5, or 2 depending on rain/selection), a nondeterminism this pins. */
  private drawGhostRect(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, valid: boolean): void {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = valid ? "#ffd24a" : "#cc3333";
    ctx.fillRect(sx, sy, sw, sh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = valid ? "#fff" : "#ff5555";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
  }

  /** The golden selection outline shared by units and shafts. */
  private strokeSelection(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number): void {
    ctx.strokeStyle = "#ffd24a";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 1, sy - 1, sw + 2, sh + 2);
  }

  private drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.preview) {
      const p = this.preview;
      const hgt = facilityFloors(p.kind);
      // Floor/lobby tools lay a multi-tile brush strip; `span` (when set) is the
      // real footprint so the shadow matches what a click actually places.
      const w = p.span ?? this.sim.tower.facilityOf({ kind: p.kind } as Unit).width;
      const sx = this.worldToScreenX(p.x);
      const sy = this.worldToScreenY(p.floor + hgt - 1);
      const sw = w * TILE * this.cam.zoom;
      const sh = hgt * FLOOR * this.cam.zoom;
      this.drawGhostRect(ctx, sx, sy, sw, sh, p.valid);
    }
    if (this.transportPreview) {
      const p = this.transportPreview;
      const w = this.sim.tower.facilityOf({ kind: p.kind } as Unit).width;
      const sx = this.worldToScreenX(p.x);
      const sy = this.worldToScreenY(p.top);
      const sw = w * TILE * this.cam.zoom;
      const sh = (p.top - p.bottom + 1) * FLOOR * this.cam.zoom;
      this.drawGhostRect(ctx, sx, sy, sw, sh, p.valid);
    }
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
    this.arrowHit = {};
    if (this.selectedId == null) return;
    const u = this.sim.tower.getUnit(this.selectedId);
    if (u) {
      const hgt = facilityFloors(u.kind);
      const sx = this.worldToScreenX(u.x);
      const sy = this.worldToScreenY(u.floor + hgt - 1);
      this.strokeSelection(ctx, sx, sy, u.width * TILE * this.cam.zoom, hgt * FLOOR * this.cam.zoom);
      return;
    }
    const t = this.sim.tower.getTransport(this.selectedId);
    if (t) this.drawTransportSelection(ctx, t);
  }

  /** Outline the selected shaft and, for elevators, draw clickable extend
   *  arrows above the top and below the bottom (as in the original). */
  private drawTransportSelection(ctx: CanvasRenderingContext2D, t: Transport): void {
    const z = this.cam.zoom;
    const sx = this.worldToScreenX(t.x);
    const sw = t.width * TILE * z;
    const top = this.worldToScreenY(t.top);
    const bottom = top + (t.top - t.bottom + 1) * FLOOR * z;
    this.strokeSelection(ctx, sx, top, sw, bottom - top);
    if (!isElevatorKind(t.kind)) return; // only lifts extend by a tappable arrow

    // Small, subtle tabs centered on the shaft — discoverable without dominating
    // the view. The hit rect is a touch larger than the drawn tab for easy use.
    const cx = sx + sw / 2;
    const tabW = Math.min(sw, 18);
    const tabH = 11;
    const up: ScreenRect = { x: cx - tabW / 2, y: top - tabH - 3, w: tabW, h: tabH };
    const down: ScreenRect = { x: cx - tabW / 2, y: bottom + 3, w: tabW, h: tabH };
    this.arrowHit = {
      up: { x: up.x - 4, y: up.y - 4, w: up.w + 8, h: up.h + 8 },
      down: { x: down.x - 4, y: down.y - 4, w: down.w + 8, h: down.h + 8 },
    };
    const drawArrow = (r: ScreenRect, dir: "up" | "down") => {
      ctx.fillStyle = "rgba(20,24,32,0.6)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#ffd24a";
      const my = r.y + r.h / 2;
      const a = 4;
      ctx.beginPath();
      if (dir === "up") {
        ctx.moveTo(cx, my - a);
        ctx.lineTo(cx - a, my + a - 1);
        ctx.lineTo(cx + a, my + a - 1);
      } else {
        ctx.moveTo(cx, my + a);
        ctx.lineTo(cx - a, my - a + 1);
        ctx.lineTo(cx + a, my - a + 1);
      }
      ctx.closePath();
      ctx.fill();
    };
    drawArrow(up, "up");
    drawArrow(down, "down");
  }

  private drawRuler(ctx: CanvasRenderingContext2D): void {
    ctx.font = "10px monospace";
    ctx.textBaseline = "middle";
    const top = this.screenToFloor(0) + 1;
    const bot = this.screenToFloor(this.viewHeight) - 1;
    for (let f = bot; f <= top; f++) {
      // worldToScreenY(f) is floor f's TOP edge; center the label on the row
      // (+half a floor). Using -half shifted every label up one floor, so the
      // ground lobby (floor 1) showed the "B1" tag and the elevator's own floor
      // numbers didn't line up with the ruler.
      const sy = this.worldToScreenY(f) + (FLOOR * this.cam.zoom) / 2;
      if (sy < 12 || sy > this.viewHeight - 2) continue;
      const label = f >= 1 ? `${f}` : `B${1 - f}`;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, sy - 7, 22, 14);
      ctx.fillStyle = f === 1 || f % 15 === 0 ? "#ffd24a" : "#cfcfcf";
      ctx.fillText(label, 3, sy);
    }
    ctx.textBaseline = "alphabetic";
  }

  // ---- Shared graphics ----------------------------------------------------

  private bakeSharedGraphics(): void {
    // Structural tiles bake from a FIXED DrawCtx (not the live this.d): these
    // canvases cache on first render, so baking from live state would freeze
    // whatever lighting happened to be on screen at that moment into the tile.
    const bake = (u: Unit, lit: boolean) =>
      new ex.Canvas({
        width: TILE,
        height: FLOOR,
        cache: true,
        draw: (ctx) => drawUnit({ ctx, lit, anim: 0, hour: lit ? 20 : 12 }, u, 0, 0, TILE, FLOOR),
      });
    this.floorGfx = bake(fakeStruct("floor"), false);
    // Lobby variants: [lit 0/1][ground 0/1][variant]. The fake unit's floor
    // selects the grand ground style (1) vs the sky-lobby style; x the variant.
    this.lobbyGfx = [false, true].map((lit) =>
      [false, true].map((ground) =>
        Array.from({ length: LOBBY_VARIANTS }, (_, v) => bake(fakeStruct("lobby", ground ? 1 : 2, v), lit)),
      ),
    );
    const bakeEsc = (side: "left" | "right") =>
      [0, 1].map(
        (p) =>
          new ex.Canvas({
            width: ESCAPE_W,
            height: FLOOR,
            cache: true,
            draw: (ctx) => drawEscapeStairs(ctx, side, p as 0 | 1, FLOOR),
          }),
      );
    this.escGfx = { left: bakeEsc("left"), right: bakeEsc("right") };

    // The tenant/staff bake recipe (one home for the magic person() args).
    // The fed-up variant below is taller and shifts the figure to fit its
    // marker, so it hand-rolls the same args — keep the two in step.
    const bakePerson = (color: string): ex.Canvas =>
      new ex.Canvas({
        width: 8,
        height: 14,
        cache: true,
        draw: (ctx) => person(ctx, 2.5, 13, 1.1, 7, false, color),
      });
    for (const color of SHIRTS) this.personGfx.push(bakePerson(color));
    // Housekeepers wear a single work uniform, so staff read at a glance.
    this.personGfxStaff = bakePerson("#E8E4DA");
    // Fed-up figure carries BOTH the red tint AND a shape marker (a "!" with a
    // white halo above the head), so "this tenant is fed up" reads without color.
    this.personGfxRed = new ex.Canvas({
      width: 8,
      height: 16,
      cache: true,
      draw: (ctx) => {
        ctx.save();
        ctx.translate(0, 2); // shift the figure down to make room for the marker
        person(ctx, 2.5, 13, 1.1, 7, false, "#C24A3A");
        ctx.restore();
        ctx.fillStyle = "#ffffff"; // halo
        ctx.fillRect(2, 0, 4, 5);
        ctx.fillStyle = "#000000"; // "!"
        ctx.fillRect(3, 0, 2, 2);
        ctx.fillRect(3, 3, 2, 1);
      },
    });
  }

  // ---- Retained-scene reconciliation (no full rebuild) --------------------

  private syncScene(): void {
    const tower = this.sim.tower;
    // Fresh flood-fill (not cached — it depends on unit state); read ONCE here
    // per sync. A parking space absent from this set is "dead" and gets a red X.
    // The dead-bit joins the room signature, so a connectivity flip triggers a
    // re-bake alongside the existing state/lighting/hour bits — it adds no
    // per-frame work of its own.
    const parkingOK = tower.functionalParkingSet();
    // Garage/waste display fractions, refreshed here (not per frame) and reusing
    // the flood-fill just done — so they're exactly as fresh as the sprite
    // re-bake below and the garage-car motion visibility that reads them.
    this.displayParkingUse = this.sim.parkingUsage(parkingOK.size);
    this.displayRecycleFill = this.sim.recyclingFill();
    this.d.parkingUse = this.displayParkingUse;
    this.d.recycleFill = this.displayRecycleFill;
    const seenS = new Set<number>();
    const seenR = new Set<number>();
    for (const u of tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") {
        seenS.add(u.id);
        const a = this.structActors.get(u.id);
        if (!a) this.addStruct(u);
        else if (u.kind === "lobby") {
          // Lobby tiles swap their shared graphic when the evening lights come
          // on (chandeliers/sconces glow). Guarded: GraphicsComponent.use()
          // reallocates bounds even for the same graphic, so skip when current.
          const gfx = this.lobbyTileGfx(u);
          if (a.graphics.current !== gfx) a.graphics.use(gfx);
        }
      } else {
        seenR.add(u.id);
        // The signature must capture every input the room sprite draws from, so
        // it re-bakes exactly when its look changes. Crucially that includes the
        // hour-dependent bits — a commercial unit's open/closed shutter and a
        // condo's late-night "asleep" look — otherwise a shop baked closed at
        // dawn would wrongly stay shuttered all day until the next lighting flip.
        const open = hasBusinessHours(u.kind) ? (isOpenAt(u.kind, this.d.hour) ? "o" : "c") : "";
        const lateNight = u.kind === "condo" && (this.d.hour >= 23 || this.d.hour < 6) ? "s" : "";
        // Only mark a SETTLED space dead — a mid-build (or burning) space is
        // excluded from the set for other reasons and isn't a connectivity fault.
        const dead =
          u.kind === "parking" && u.state !== "construction" && u.state !== "fire" && !parkingOK.has(u.id) ? "x" : "";
        // Hour-bucketed live-display bits: how full the garage is (cars) and how
        // full the recycling centers are (garbage pile). syncScene already runs
        // on the hour, so these advance the same cadence as open/lateNight.
        const liveBits =
          u.kind === "parking"
            ? `:p${Math.round((this.d.parkingUse ?? 0) * 6)}`
            : u.kind === "recycling"
              ? `:r${Math.round((this.d.recycleFill ?? 0) * 8)}`
              : "";
        const sig = `${u.state}:${this.litState ? 1 : 0}:${u.width}:${u.occupants}:${open}${lateNight}${dead}${liveBits}`;
        const isDead = dead === "x";
        const rec = this.roomActors.get(u.id);
        const animated = u.state === "fire" || u.state === "construction";
        if (!rec) {
          this.addRoom(u, isDead, animated);
          this.roomSig.set(u.id, sig);
        } else if (this.roomSig.get(u.id) !== sig) {
          if (animated === rec.animated && rec.cv.width === u.width * TILE) {
            // Repaint in place: the draw closure reads the unit's live state, so
            // flagging the canvas dirty re-bakes the SAME bitmap into the SAME
            // GPU texture. No actor churn, no new allocations — see RoomRec.
            rec.live.dead = isDead;
            rec.cv.flagDirty();
          } else {
            // Rebuild (rare): animated↔static flips the canvas cache mode, which
            // is fixed at construction (fire ignition/extinguish, build done);
            // the width guard is belt-and-braces — the sig treats width as a
            // repaint trigger, but only a rebuild can re-derive the bitmap size,
            // actor footprint and collider (no engine path resizes a unit today).
            rec.actor.kill();
            this.roomActors.delete(u.id);
            this.addRoom(u, isDead, animated);
          }
          this.roomSig.set(u.id, sig);
        }
      }
    }
    this.reap(this.structActors, seenS, (a) => a.kill());
    this.reap(this.roomActors, seenR, (rec, id) => {
      rec.actor.kill();
      this.roomSig.delete(id);
    });

    const seenT = new Set<number>();
    for (const t of tower.transports) {
      seenT.add(t.id);
      const sig = `${t.bottom}:${t.top}:${t.cars}:${t.kind}:${(t.skipFloors ?? []).join(",")}`;
      const a = this.transportActors.get(t.id);
      if (!a) {
        this.addTransport(t);
        this.transportSig.set(t.id, sig);
      } else if (this.transportSig.get(t.id) !== sig) {
        a.kill();
        this.transportActors.delete(t.id);
        this.addTransport(t);
        this.transportSig.set(t.id, sig);
      }
    }
    this.reap(this.transportActors, seenT, (a, id) => {
      a.kill();
      this.transportSig.delete(id);
    });
  }

  /**
   * Reconcile the building's exterior dressing — escape stairs and the roof
   * crane — to the tower silhouette. Runs only on structural changes (like
   * syncMotion): the silhouette can't move on an hour tick or a lighting flip.
   */
  private syncFacade(): void {
    // Above-ground silhouette + top-row tiles in ONE pass over the units:
    // escape stairs read the per-floor edges, the crane reads the top row's
    // built columns. (Every story of a multi-floor room counts, so a two-story
    // cinema at the edge still gets stairs on its upper row.)
    const hi = this.sim.tower.highestFloor;
    const { edges, topTiles } = facadeGeometry(this.sim.tower.units, hi);
    this.syncEscapes(edges);
    this.syncCrane(hi, topTiles);
  }

  /** Reconcile the exterior escape-stair segments: one left + one right actor
   *  per above-ground floor row, slid in place when the row's edge moves. */
  private syncEscapes(edges: Map<number, FloorEdge>): void {
    for (const [floor, e] of edges) {
      const sig = `${e.min}:${e.max}`;
      const y = this.worldYTop(floor);
      const lx = e.min * TILE - ESCAPE_W;
      const rx = e.max * TILE;
      const rec = this.escapeActors.get(floor);
      if (rec) {
        // Same graphic (parity is fixed per floor) — just follow the edge.
        if (rec.sig !== sig) {
          rec.l.pos = ex.vec(lx, y);
          rec.r.pos = ex.vec(rx, y);
          rec.sig = sig;
        }
        continue;
      }
      const parity = (floor % 2) as 0 | 1;
      const hang = (x: number, side: "left" | "right"): ex.Actor => {
        const a = new ex.Actor({ pos: ex.vec(x, y), width: ESCAPE_W, height: FLOOR, anchor: ex.vec(0, 0), z: -2 });
        a.graphics.use(this.escGfx[side][parity]);
        this.engine.add(a);
        return a;
      };
      this.escapeActors.set(floor, { l: hang(lx, "left"), r: hang(rx, "right"), sig });
    }
    this.reap(this.escapeActors, new Set(edges.keys()), (rec) => {
      rec.l.kill();
      rec.r.kill();
    });
  }

  /** Keep the rooftop crane perched over the highest built floor's run. It
   *  comes down once the tower tops out at the 100th floor (and stays away
   *  unless the top is demolished back below it — the crane is derived state,
   *  not a latch). No above-ground floors → no crane (empty/basement lots). */
  private syncCrane(hi: number, topTiles: Set<number>): void {
    // No above-ground structure on the top row (basement-only/empty lot) or the
    // tower has topped out at the cap → no crane.
    if (hi >= GRID.maxFloor || topTiles.size === 0) {
      if (this.craneActor) {
        this.craneActor.kill();
        this.craneActor = null;
        this.craneGfx = null;
      }
      return;
    }
    // Center over the widest CONTIGUOUS built run on the top floor, not the
    // (min,max) midpoint: a top row built in disjoint sections — a setback, or
    // a partly-leased office row — leaves the midpoint hovering in the gap
    // between blocks, floating the crane over open sky. For a fully-built row
    // the widest run IS the whole span, so this matches the old midpoint.
    const pos = ex.vec(craneAnchorTile(topTiles) * TILE, this.worldYTop(hi));
    if (!this.craneActor) {
      // cache:true + flagDirty from tick(): the crane re-rasterizes only while
      // the decorative clock advances, so pause/reduced-motion stops the
      // per-frame canvas repaint AND the GPU re-upload, not just the motion.
      this.craneGfx = new ex.Canvas({
        width: CRANE_W,
        height: CRANE_H,
        cache: true,
        draw: (ctx) => drawCrane(ctx, this.d.anim, this.d.lit),
      });
      this.craneActor = new ex.Actor({
        pos,
        width: CRANE_W,
        height: CRANE_H,
        anchor: ex.vec(0.5, 1),
        z: -2,
      });
      this.craneActor.graphics.use(this.craneGfx);
      this.engine.add(this.craneActor);
    } else {
      this.craneActor.pos = pos;
    }
  }

  /** The shared retained-actor ritual: top-left anchored, box collider the
   *  size of the graphic, added to the engine. Callers keep their own maps. */
  private addBoxActor(pos: ex.Vector, w: number, h: number, z: number, gfx: ex.Graphic): ex.Actor {
    const a = new ex.Actor({ pos, width: w, height: h, anchor: ex.vec(0, 0), z });
    a.graphics.use(gfx);
    a.collider.set(ex.Shape.Box(w, h, ex.vec(0, 0)));
    this.engine.add(a);
    return a;
  }

  private addStruct(u: Unit): void {
    const gfx = u.kind === "lobby" ? this.lobbyTileGfx(u) : this.floorGfx;
    this.structActors.set(u.id, this.addBoxActor(ex.vec(this.worldX(u.x), this.worldYTop(u.floor)), TILE, FLOOR, -1, gfx));
  }

  /** The shared lobby tile graphic for this unit's lighting, style and slot. */
  private lobbyTileGfx(u: Unit): ex.Canvas {
    return this.lobbyGfx[this.litState ? 1 : 0][u.floor === 1 ? 1 : 0][lobbyVariant(u.x)];
  }

  /** Build and retain a room actor. `animated` (burning / under construction:
   *  redraws every frame; the rest bake once and re-bake in place — see
   *  RoomRec) is computed by syncScene, the only caller with a unit in hand,
   *  so the repaint-vs-rebuild gate and the canvas cache mode can never drift
   *  apart on two copies of the predicate. */
  private addRoom(u: Unit, deadParking: boolean, animated: boolean): void {
    const hgt = facilityFloors(u.kind);
    const w = u.width * TILE;
    const h = hgt * FLOOR;
    // The draw closure reads `u` and `live.dead` LIVE, so a later signature
    // change repaints by flagging the canvas dirty instead of rebuilding it.
    const live = { dead: deadParking };
    const cv = new ex.Canvas({
      width: w,
      height: h,
      cache: !animated,
      draw: (ctx) => {
        this.d.ctx = ctx;
        // Set per-unit: a dead (unchained) parking space draws no cars. Every
        // room bake writes it, so one unit's flag can't leak into the next.
        this.d.parkingDead = live.dead;
        drawUnit(this.d, u, 0, 0, w, h);
        // Canon "red X" on a parking space that isn't chained to a ramp (dead —
        // no relief). Baked into the sprite; the dead-bit participates in the room
        // signature, so this re-bakes when the signature changes (state/lighting/
        // hour or the dead-bit). live.dead is refreshed on each sync from the
        // caller's single functionalParkingSet() read — no per-unit recompute.
        if (live.dead) {
          // Dark under-stroke so the X reads as a SHAPE independent of hue
          // (color-blind cue), then the red X on top.
          for (const [style, wd] of [["#111", 4] as const, ["#C24A3A", 2] as const]) {
            ctx.strokeStyle = style;
            ctx.lineWidth = wd;
            ctx.beginPath();
            ctx.moveTo(2, 2);
            ctx.lineTo(w - 2, h - 2);
            ctx.moveTo(w - 2, 2);
            ctx.lineTo(2, h - 2);
            ctx.stroke();
          }
        }
      },
    });
    const a = this.addBoxActor(ex.vec(this.worldX(u.x), this.worldYTop(u.floor, hgt)), w, h, 0, cv);
    this.roomActors.set(u.id, { actor: a, cv, animated, live });
  }

  private addTransport(t: Transport): void {
    const w = t.width * TILE;
    const totalFloors = t.top - t.bottom + 1;
    const h = totalFloors * FLOOR;
    const gfx = this.transportGraphic(t, w, totalFloors);
    this.transportActors.set(t.id, this.addBoxActor(ex.vec(this.worldX(t.x), this.worldYTop(t.top)), w, h, 1, gfx));
  }

  /**
   * Build a shaft graphic whose backing bitmap can't exceed the GPU texture
   * limit. A tall shaft is `floors * FLOOR` px high, which on a mobile GPU
   * (MAX_TEXTURE_SIZE often 4096, sometimes 2048) can fail to upload and render
   * as a black rectangle. A tall shaft is therefore split into stacked bands,
   * each its own small cached Canvas, composed onto one GraphicsGroup — a single
   * actor, so the rest of the engine (sync, removal, collider) is unchanged.
   */
  private transportGraphic(t: Transport, w: number, totalFloors: number): ex.Graphic {
    const band = (fromTop: number, floors: number): ex.Canvas =>
      new ex.Canvas({
        width: w,
        height: floors * FLOOR,
        cache: true,
        quality: 1, // background structure — keep the bitmap at its logical size
        draw: (ctx) => {
          this.d.ctx = ctx;
          // Draw the whole shaft shifted up so only this band lands in-bounds; the
          // rest is clipped. Bands abut seamlessly (each draws the full shaft).
          drawTransport(ctx, t, 0, -fromTop * FLOOR, w, FLOOR);
        },
      });
    if (totalFloors <= TRANSPORT_BAND_FLOORS) return band(0, totalFloors);
    const members: { graphic: ex.Graphic; offset: ex.Vector }[] = [];
    for (let from = 0; from < totalFloors; from += TRANSPORT_BAND_FLOORS) {
      const floors = Math.min(TRANSPORT_BAND_FLOORS, totalFloors - from);
      members.push({ graphic: band(from, floors), offset: ex.vec(0, from * FLOOR) });
    }
    return new ex.GraphicsGroup({ members, useAnchor: false });
  }

  // ---- Engine-driven motion (cars, train, walkers) ------------------------

  private clearMotion(): void {
    for (const c of this.carActors) c.actor.kill();
    for (const t of this.trainActors) t.actor.kill();
    for (const t of this.truckActors) t.actor.kill();
    for (const g of this.garageCars) g.actor.kill();
    for (const w of this.walkers) w.actor.kill();
    this.carActors = [];
    this.trainActors = [];
    this.truckActors = [];
    this.garageCars = [];
    this.walkers = [];
  }

  /** Stable cache key for a cab graphic's indicator state. */
  private carKey(ind: CarIndicator): string {
    return `${ind.riders}:${ind.arrow ?? "x"}:${ind.full ? "f" : "e"}`;
  }

  /** Get-or-create the cab graphic for a given indicator state. Keying and
   *  drawing both derive from the one {@link CarIndicator}, so the cache key and
   *  the painted cab can't fall out of sync. */
  private carGfx(entry: { seed: number; w: number; gfx: Map<string, ex.Canvas> }, ind: CarIndicator): ex.Canvas {
    const key = this.carKey(ind);
    let cv = entry.gfx.get(key);
    if (!cv) {
      const { seed, w } = entry;
      cv = new ex.Canvas({
        width: w,
        height: FLOOR,
        cache: true,
        draw: (ctx) => drawCar(ctx, seed, w, FLOOR, ind.riders, ind.arrow, ind.full),
      });
      entry.gfx.set(key, cv);
    }
    return cv;
  }

  private syncMotion(): void {
    this.clearMotion();
    for (const t of this.sim.tower.transports) {
      if (!isElevatorKind(t.kind)) continue;
      const w = t.width * TILE;
      for (let i = 0; i < t.cars; i++) {
        const seed = (i * 7 + t.id) | 0;
        // Cab graphics are built lazily and cached by indicator state (rider
        // count, direction lantern, FULL) so we only ever draw each variant once.
        const gfx = new Map<string, ex.Canvas>();
        const a = new ex.Actor({ pos: ex.vec(this.worldX(t.x), -t.carPositions[i] * FLOOR), width: w, height: FLOOR, anchor: ex.vec(0, 0), z: 2 });
        a.graphics.use(this.carGfx({ seed, w, gfx }, IDLE_CAR));
        this.engine.add(a);
        this.carActors.push({ actor: a, t, i, seed, w, gfx, shown: this.carKey(IDLE_CAR) });
      }
    }
    for (const u of this.sim.tower.units) {
      if (u.kind !== "metro") continue;
      const w = u.width * TILE - 6;
      const cv = new ex.Canvas({ width: w, height: 9, cache: true, draw: (ctx) => drawMetroTrain(ctx, w, true) });
      const a = new ex.Actor({ pos: ex.vec(this.worldX(u.x) + 3, this.worldYTop(u.floor) + FLOOR - 15), width: w, height: 9, anchor: ex.vec(0, 0), z: 0.6 });
      a.graphics.use(cv);
      this.engine.add(a);
      this.trainActors.push({ actor: a, u, w });
    }
    // Garbage trucks: one per recycling center, parked off-screen until the
    // collection hour (updateMotion drives them in and out along the bottom
    // story, exactly the metro-train pattern).
    for (const u of this.sim.tower.units) {
      if (u.kind !== "recycling") continue;
      const w = 44;
      const cv = new ex.Canvas({ width: w, height: 16, cache: true, draw: (ctx) => drawGarbageTruck(ctx, w) });
      const a = new ex.Actor({
        pos: ex.vec(this.worldX(u.x), this.worldYTop(u.floor) + FLOOR - 16),
        width: w,
        height: 16,
        anchor: ex.vec(0, 0),
        z: 0.6,
      });
      a.graphics.use(cv);
      a.graphics.visible = false;
      this.engine.add(a);
      this.truckActors.push({ actor: a, u, w });
    }
    // Commute cars: one per floor that carries parking structure, cruising the
    // extent of that floor's parking/ramp run at rush hours.
    const runs = new Map<number, { min: number; max: number }>();
    for (const u of this.sim.tower.units) {
      if (u.kind !== "parking" && u.kind !== "parkingRamp") continue;
      const r = runs.get(u.floor);
      const right = u.x + u.width;
      if (!r) runs.set(u.floor, { min: u.x, max: right });
      else {
        if (u.x < r.min) r.min = u.x;
        if (right > r.max) r.max = right;
      }
    }
    for (const [floor, r] of runs) {
      const x0w = this.worldX(r.min) + 2;
      const x1w = this.worldX(r.max) - 18;
      // A run too short for the car to travel gets none — bail BEFORE creating
      // the actor, so an untracked actor is never added to the engine (it would
      // leak: clearMotion only kills what's in this.garageCars).
      if (x1w <= x0w) continue;
      const seed = (floor * 97 + r.min * 13) | 0;
      const cv = new ex.Canvas({ width: 16, height: 8, cache: true, draw: (ctx) => drawStreetCar(ctx, seed) });
      const a = new ex.Actor({ pos: ex.vec(x0w, this.worldYTop(floor) + FLOOR - 10), width: 16, height: 8, anchor: ex.vec(0, 0), z: 0.5 });
      a.graphics.use(cv);
      a.graphics.visible = false;
      this.engine.add(a);
      this.garageCars.push({ actor: a, floor, x0w, x1w, seed });
    }
    this.buildWalkers();
  }

  private buildWalkers(): void {
    const byFloor = new Map<number, Map<number, "floor" | "lobby">>();
    for (const u of this.sim.tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") {
        let row = byFloor.get(u.floor);
        if (!row) byFloor.set(u.floor, (row = new Map()));
        row.set(u.x, u.kind);
      }
    }
    let budget = 400;
    for (const [floor, row] of byFloor) {
      for (const run of mergeRuns(floor, row)) {
        if (budget <= 0) break;
        const wTiles = run.x1 - run.x0 + 1;
        const density = run.kind === "lobby" ? 0.5 : 0.14;
        const count = Math.min(run.kind === "lobby" ? 20 : 8, Math.floor(wTiles * density));
        const foot = this.worldYTop(floor) + FLOOR - 3;
        const x0w = this.worldX(run.x0) + 3;
        const x1w = this.worldX(run.x1 + 1) - 3;
        const runW = x1w - x0w;
        for (let i = 0; i < count && budget > 0; i++, budget--) {
          const seed = (floor * 131 + run.x0 * 7 + i * 53) | 0;
          const rank = (i + 0.5) / count; // only the first few show until it fills
          const speed = 7 + (Math.abs(seed) % 6);
          if (run.kind === "lobby") {
            // Concourse: figures stroll the whole width, gated on tower busyness.
            this.spawnWalker(x0w, x1w, foot, foot, seed, speed, rank, floor, false);
          } else {
            // Corridor: loiter in a short stretch around a spread-out anchor, so a
            // lone figure shuffles in place instead of sprinting the whole floor —
            // and only appears when this floor actually has occupants.
            const anchor = x0w + rank * runW;
            const half = Math.min(14, runW / 2);
            // Clamp the loiter span to the run so a figure never paces past the
            // corridor ends — robust even if the count/density constants change.
            const segX0 = Math.max(x0w, anchor - half);
            const segX1 = Math.min(x1w, anchor + half);
            this.spawnWalker(segX0, segX1, foot, foot, seed, speed, rank, floor, true);
          }
        }
      }
    }
    for (const t of this.sim.tower.transports) {
      if (t.kind !== "stairs" && t.kind !== "escalator") continue;
      const x0w = this.worldX(t.x) + 2;
      const x1w = this.worldX(t.x + t.width) - 3;
      const yb = this.worldYTop(t.bottom) + FLOOR - 2;
      const yt = yb - (FLOOR - 4);
      const n = t.kind === "escalator" ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const seed = (t.id * 17 + i * 29) | 0;
        // Low ranks so stairs/escalators show climbers even in a modest tower —
        // otherwise the routed crowd (elevators only) makes stairs look unused.
        this.spawnWalker(x0w, x1w, yb, yt, seed, t.kind === "escalator" ? 12 : 7, 0.04 + i * 0.18, t.bottom, false);
      }
    }
  }

  private spawnWalker(
    x0w: number,
    x1w: number,
    y0w: number,
    y1w: number,
    seed: number,
    speed: number,
    rank: number,
    floor: number,
    perFloor: boolean,
  ): void {
    const gfx = this.personGfx[Math.abs(seed) % this.personGfx.length];
    const a = new ex.Actor({ pos: ex.vec(x0w, y0w), width: 8, height: 14, anchor: ex.vec(0.5, 1), z: 0.4 });
    a.graphics.use(gfx);
    this.engine.add(a);
    this.walkers.push({
      actor: a,
      gfx,
      x0w,
      x1w,
      y0w,
      y1w,
      speed,
      dir: seed % 2 === 0 ? 1 : -1,
      phase: (Math.abs(seed) % 100) / 100,
      impatient: (((seed >>> 8) & 0xff) / 255) < 0.5,
      red: false,
      rank,
      floor,
      perFloor,
    });
  }

  /** Refresh the per-floor occupancy map (0..1) when the hour or layout changes,
   *  so corridor loiterers appear only where tenants actually are. */
  private refreshFloorLiveliness(): void {
    const hour = this.sim.clock.hour;
    const rev = this.sim.tower.revision;
    if (hour === this.floorLiveHour && rev === this.floorLiveRev) return;
    this.floorLiveHour = hour;
    this.floorLiveRev = rev;
    const people = new Map<number, number>();
    for (const u of this.sim.tower.units) {
      if (u.occupants > 0) people.set(u.floor, (people.get(u.floor) ?? 0) + u.occupants);
    }
    this.floorLive.clear();
    // Scale present occupants to 0..1: ~16 on a floor reads as fully lively (all
    // its loiterers shown); a busier floor shows more, an empty or all-vacant
    // floor shows none. (How many the fraction reveals scales with the floor's
    // width, since a corridor's walker count comes from its tile span.)
    for (const [f, n] of people) this.floorLive.set(f, Math.min(1, n / 16));
  }

  /** Repositions every moving actor each frame (the engine then draws them). */
  private updateMotion(): void {
    const anim = this.d.anim;
    for (const c of this.carActors) {
      c.actor.pos = ex.vec(this.worldX(c.t.x), -c.t.carPositions[c.i] * FLOOR);
      // Indicator state (riders bucket scaled to capacity, direction lantern,
      // FULL) is derived by the tested carIndicator helper; the cab graphic is
      // cached per state so we only redraw when the state actually changes.
      const load = c.t.carLoad?.[c.i] ?? 0;
      const dir = c.t.carDir?.[c.i] ?? 0;
      const ind = carIndicator(dir, load, transportCarCapacity(c.t.kind));
      const key = this.carKey(ind);
      if (key !== c.shown) {
        c.shown = key;
        c.actor.graphics.use(this.carGfx(c, ind));
      }
    }
    for (const tr of this.trainActors) {
      const cycle = (anim % 12) / 12;
      const span = tr.w + 12;
      let offset: number;
      if (cycle < 0.25) offset = (1 - cycle / 0.25) * -span;
      else if (cycle < 0.75) offset = 0;
      else offset = ((cycle - 0.75) / 0.25) * span;
      tr.actor.pos = ex.vec(this.worldX(tr.u.x) + 3 + offset, this.worldYTop(tr.u.floor) + FLOOR - 15);
    }
    // The garbage truck runs on GAME time (the collection is a sim event, not
    // ambience): during the collection hour it drives in along the center's
    // bottom story, loads, and drives off — pausing the game freezes it.
    const clock = this.sim.clock;
    const truckHour = clock.hour === GARBAGE_COLLECT_HOUR;
    for (const tk of this.truckActors) {
      // No collection at a center that isn't running (under construction, on
      // fire, or a gutted shell) — a non-operational plant processes no waste.
      const show = truckHour && isOperational(tk.u);
      if (tk.actor.graphics.visible !== show) tk.actor.graphics.visible = show;
      if (!show) continue;
      const p = (clock.minuteOfDay - GARBAGE_COLLECT_HOUR * 60) / 60; // 0..1 through the hour
      const base = this.worldX(tk.u.x);
      const uw = tk.u.width * TILE;
      let x: number;
      if (p < 0.25) x = base - 60 + (p / 0.25) * 60; // roll in from the left
      else if (p < 0.7) x = base; // loading at the mouth
      else x = base + ((p - 0.7) / 0.3) * (uw + 20); // drive off across the deck
      tk.actor.pos = ex.vec(x, this.worldYTop(tk.u.floor) + FLOOR - 16);
    }
    // Garage commute cars: cruise the parking decks during the morning and
    // evening rushes, but only when the garage actually has cars to move.
    // Reads the fraction computed in syncScene (per sync, not per frame), so
    // this frame-path never runs the parking flood-fill itself.
    const rushing = (clock.isMorning() || clock.isEvening()) && this.displayParkingUse > 0;
    for (const g of this.garageCars) {
      if (g.actor.graphics.visible !== rushing) g.actor.graphics.visible = rushing;
      if (!rushing) continue;
      let p = (Math.abs(g.seed) % 100) / 100 + anim * 0.05;
      p -= Math.floor(p);
      const tt = 1 - Math.abs(2 * p - 1); // ping-pong along the deck
      g.actor.pos = ex.vec(g.x0w + tt * (g.x1w - g.x0w), this.worldYTop(g.floor) + FLOOR - 10);
    }
    const stress = this.d.stress ?? 0;
    // How busy the building looks right now: scales with population so an empty
    // tower has an empty lobby, and thins out overnight.
    const night = this.sim.clock.isNight();
    const crowd = Math.min(1, this.sim.population / 350) * (night ? 0.35 : 1);
    this.refreshFloorLiveliness();
    for (const w of this.walkers) {
      // Corridor loiterers gate on their own floor's live occupancy (so an empty
      // floor stays empty); lobby/stair figures gate on the whole tower's crowd.
      const threshold = w.perFloor ? (this.floorLive.get(w.floor) ?? 0) : crowd;
      const visible = w.rank <= threshold;
      if (w.actor.graphics.visible !== visible) w.actor.graphics.visible = visible;
      if (!visible) continue;
      let p = w.phase + (w.dir > 0 ? 0 : 0.5) + anim * w.speed * 0.03;
      p -= Math.floor(p);
      // Ping-pong 0→1→0 so figures pace back and forth (and stair climbers go
      // up *and* down) instead of teleporting from the far end back to the
      // start each loop — the old sawtooth made people look like they spawned on
      // one side, ran across, then vanished.
      const tt = 1 - Math.abs(2 * p - 1);
      w.actor.pos = ex.vec(w.x0w + tt * (w.x1w - w.x0w), w.y0w + tt * (w.y1w - w.y0w));
      const red = w.impatient && stress > 0.25;
      if (red !== w.red) {
        w.red = red;
        w.actor.graphics.use(red ? this.personGfxRed : w.gfx);
      }
    }
  }

  private disposeScene(): void {
    for (const a of this.structActors.values()) a.kill();
    for (const rec of this.roomActors.values()) rec.actor.kill();
    for (const a of this.transportActors.values()) a.kill();
    for (const rec of this.escapeActors.values()) {
      rec.l.kill();
      rec.r.kill();
    }
    this.escapeActors.clear();
    if (this.craneActor) {
      this.craneActor.kill();
      this.craneActor = null;
      this.craneGfx = null;
    }
    this.structActors.clear();
    this.roomActors.clear();
    this.roomSig.clear();
    this.transportActors.clear();
    this.transportSig.clear();
    this.clearMotion();
  }

  // ---- Audio focus --------------------------------------------------------

  focus(): ViewFocus {
    const centerFloor = this.screenToFloor(this.viewHeight / 2);
    const night = this.sim.clock.isNight();
    const t0 = this.screenToTile(this.viewWidth * 0.3);
    const t1 = this.screenToTile(this.viewWidth * 0.7);
    const f0 = this.screenToFloor(this.viewHeight * 0.7);
    const f1 = this.screenToFloor(this.viewHeight * 0.3);
    const tally = new Map<FacilityKind, number>();
    for (const u of this.sim.tower.units) {
      if (u.floor < f0 || u.floor > f1) continue;
      if (u.x + u.width < t0 || u.x > t1) continue;
      tally.set(u.kind, (tally.get(u.kind) ?? 0) + u.width);
    }
    let dominant: ViewFocus["dominant"] = "empty";
    let best = 0;
    for (const [k, v] of tally) {
      if (k === "floor") continue;
      if (v > best) {
        best = v;
        dominant = k === "lobby" ? "lobby" : k;
      }
    }
    if (dominant === "empty" && centerFloor <= 0) dominant = "outside";
    return { centerFloor, dominant, night, zoom: this.cam.zoom, weather: this.sim.weather };
  }

  dispose(): void {
    this.engine.stop();
  }
}

interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function buttonNum(ev: ex.PointerEvent): number {
  if (ev.button === ex.PointerButton.Middle) return 1;
  if (ev.button === ex.PointerButton.Right) return 2;
  return 0;
}

function fakeStruct(kind: "floor" | "lobby", floor = 1, x = 0): Unit {
  return {
    id: -1,
    kind,
    floor,
    x,
    width: 1,
    state: "occupied",
    satisfaction: 1,
    occupants: 0,
    everOccupied: false,
    pendingIncome: 0,
    label: "",
  };
}

function mergeRuns(floor: number, row: Map<number, "floor" | "lobby">): Run[] {
  const xs = [...row.keys()].sort((a, b) => a - b);
  const runs: Run[] = [];
  if (xs.length === 0) return runs;
  let start = xs[0];
  let prev = xs[0];
  let kind = row.get(xs[0])!;
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    const k = row.get(x)!;
    if (x === prev + 1 && k === kind) {
      prev = x;
    } else {
      runs.push({ kind, floor, x0: start, x1: prev });
      start = prev = x;
      kind = k;
    }
  }
  runs.push({ kind, floor, x0: start, x1: prev });
  return runs;
}

function skyColor(hour: number): string {
  const t = Math.cos(((hour - 13) / 24) * Math.PI * 2) * 0.5 + 0.5; // 1 at midday
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const r = mix(28, 130);
  const g = mix(34, 175);
  const b = mix(70, 224);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
