import * as ex from "excalibur";
import { GRID, isCommercialKind } from "../../engine/facilities";
import { FACILITIES } from "../../engine/facilitiesData";
import type { FacilityKind, SerializedView, WeatherKind } from "../../engine/types";
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN } from "../../engine/types";
import { clampCameraY, fitZoom } from "../cameraBounds";
import { stablePointerId } from "../pinchTracker";
import { FLOOR, TILE } from "../scale";
import type { TowerEngine } from "./TowerEngine";

/**
 * Pointer input, entity picking, camera control and the audio view-focus for
 * {@link TowerEngine}, as friend functions taking the engine instance.
 * Extracted from `TowerEngine.ts`; the class keeps thin delegations and the
 * coordinate transforms these read (worldX, the worldToScreen and screenTo
 * helpers, the cam getter and viewport getters). Pure code move: no gesture,
 * camera or picking math changed.
 */

/** Camera zoom range (screen pixels per world pixel). The values live in
 *  engine/types (VIEW_ZOOM_MIN/MAX) because the save schema clamps a restored
 *  view's zoom at the deserialize trust boundary; re-exported here so render
 *  code keeps its familiar names and the range exists in one place. */
export const MIN_ZOOM = VIEW_ZOOM_MIN;
export const MAX_ZOOM = VIEW_ZOOM_MAX;
const clampZoom = (z: number): number =>
  Number.isFinite(z) ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)) : MIN_ZOOM;

/** Accumulated-movement value far above every tap-slop threshold. Assigned to
 *  `moved` when a pinch hands off to a single surviving finger, so releasing
 *  that finger can never register as a tap (and accidentally place). */
const TAP_SLOP_POISON = 1e6;

export interface ViewFocus {
  centerFloor: number;
  dominant: FacilityKind | "outside" | "lobby" | "empty";
  night: boolean;
  /**
   * Current camera zoom (world pixels multiplier). Low values are zoomed out
   * (the whole tower in frame; the tower-aware fit floor lets a tall tower reach
   * ~0.15 or lower) and 3 is a tight close-up. Audio uses this to pull back to a
   * wide "tower overview" bed when zoomed out and to fade in area-specific detail
   * (crowd, kitchen clatter, elevator dings) up close.
   */
  zoom: number;
  /** Today's sky weather; drives an outdoor rain layer in the ambient bed. */
  weather: WeatherKind;
  /** Sim clock hour as a float in [0, 24); the ambience layer's workday and
   *  evening gates read it (offices type at 10:00, sleep at 03:00). */
  hour: number;
  /** 0..1 live fill of the dominant kind's units in view (occupants against
   *  capacity), falling back to visible crowd density where the kind tracks no
   *  occupants (lobbies, the street). Drives honest ambience loudness: an
   *  empty venue is near-silent, a packed one murmurs. */
  crowd: number;
}

/** What the pointer is over: transports by Excalibur collider hit-test,
 *  every unit kind by the tower's grid lookup (see pickEntityAt). */
export interface Picked {
  type: "unit" | "transport";
  id: number;
  kind: FacilityKind;
}

export interface ScreenRect {
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

// ---- Input (Excalibur pointer system) ----------------------------------

function tf(ev: ex.PointerEvent): { tile: number; floor: number } {
  return worldToCell(ev.worldPos);
}

/** World point → grid cell, the single inverse of worldX/worldYTop. Shared
 *  by pointer handling and the pick fallback so the two can't drift. */
function worldToCell(world: ex.Vector): { tile: number; floor: number } {
  return { tile: Math.floor(world.x / TILE), floor: Math.ceil(-world.y / FLOOR) };
}

export function bindInput(engine: TowerEngine): void {
  const ptr = engine.engine.input.pointers;
  ptr.on("down", (ev) => pointerDown(engine, ev as ex.PointerEvent));
  ptr.on("move", (ev) => pointerMove(engine, ev as ex.PointerEvent));
  ptr.on("up", (ev) => pointerUp(engine, ev as ex.PointerEvent));
  ptr.on("cancel", (ev) => pointerUp(engine, ev as ex.PointerEvent));
  ptr.on("wheel", (ev) => {
    const w = ev as ex.WheelEvent;
    // Browsers remap Shift+wheel to horizontal scroll (deltaY 0, motion in
    // deltaX), so under the Shift pan key the fallback axis carries the zoom
    // intent. Gated on Shift (w.ev is the native DOM event): an unmodified
    // sideways trackpad swipe is a scroll, not a zoom, and dead events drop.
    const d = w.deltaY !== 0 ? w.deltaY : (w.ev as { shiftKey?: boolean } | undefined)?.shiftKey ? w.deltaX : 0;
    if (d === 0) return;
    zoomAt(engine, d < 0 ? 1.12 : 0.89, w.x, w.y);
  });
}

/** Top-most unit/transport under the point: transports by their Excalibur
 *  colliders (z 1, they overlay every unit), units by grid lookup. */
export function pickEntityAt(engine: TowerEngine, world: ex.Vector): Picked | null {
  let best: Picked | null = null;
  let bestZ = -Infinity;
  for (const [id, a] of engine.transportActors) {
    if (a.z >= bestZ && a.contains(world.x, world.y)) {
      const t = engine.sim.tower.getTransport(id);
      if (t) {
        best = { type: "transport", id, kind: t.kind };
        bestZ = a.z;
      }
    }
  }
  // Every unit kind resolves by grid lookup now, the way floor/lobby tiles
  // (which never had per-tile actors) already did. The tower's tile index is
  // footprint-complete (Tower.register claims every story of a multi-floor
  // unit), units never overlap, and rooms always sat below transports, so
  // one O(1) unitAt matches what the O(rooms) actor scan returned while
  // freeing the pick from the render's actor model entirely, which the
  // region-composition story (rooms stop owning per-unit actors) needs.
  if (!best) {
    const { tile, floor } = worldToCell(world);
    const u = engine.sim.tower.unitAt(floor, tile);
    if (u) best = { type: "unit", id: u.id, kind: u.kind };
  }
  return best;
}

function pointerDown(engine: TowerEngine, ev: ex.PointerEvent): void {
  const contact = engine.tracker.down(stablePointerId(ev.pointerId, ev.nativeEvent), ev.screenPos.x, ev.screenPos.y);
  if (contact === "pinch-start") {
    // A live extend-arrow drag must end here: pointerMove checks arrowDrag
    // right after the pinch branch, so a stale one would resume (with a
    // positional jump) the moment the pinch hands off to a pan.
    if (engine.arrowDrag) {
      engine.onExtendEnd?.();
      engine.arrowDrag = null;
    }
    engine.gesture = null;
    engine.preview = null;
    engine.transportPreview = null;
    return;
  }
  if (contact === "pinch-extra") return;
  engine.lastSx = ev.screenPos.x;
  engine.lastSy = ev.screenPos.y;
  engine.moved = 0;
  const touch = ev.pointerType === "Touch";
  engine.downTouch = touch;
  // Pan key: Space (Excalibur keyboard) or Shift off the native pointer event
  // (the press carries the modifier). Down-only, like Space: release mid-drag keeps the pan.
  const native = ev.nativeEvent as { shiftKey?: boolean } | undefined;
  const panKey = engine.engine.input.keyboard.isHeld(ex.Keys.Space) || native?.shiftKey === true;
  // Left-click on a selected elevator's extend arrow grows the shaft. A held
  // pan key skips the arrow: the modifier promises the drag only pans, and a
  // shaft resize is exactly the paid mutation it exists to escape.
  if (buttonNum(ev) === 0 && !panKey && engine.onExtendTo) {
    const ps = ev.screenPos;
    const inRect = (r?: ScreenRect) =>
      !!r && ps.x >= r.x && ps.x <= r.x + r.w && ps.y >= r.y && ps.y <= r.y + r.h;
    const end = inRect(engine.arrowHit.up) ? "up" : inRect(engine.arrowHit.down) ? "down" : null;
    if (end) {
      // Begin a drag: a plain click extends one floor (on pointer-up), while
      // dragging up/down grows or shrinks the shaft floor-by-floor.
      engine.arrowDrag = { end };
      engine.gesture = null;
      return;
    }
  }
  // Right-click always inspects what's under the cursor, whatever tool is
  // active, it never pans or builds.
  if (buttonNum(ev) === 2 && engine.onSecondary) {
    engine.onSecondary(pickEntityAt(engine, ev.worldPos));
    engine.gesture = null;
    return;
  }
  engine.gesture = engine.classifyDown ? engine.classifyDown(buttonNum(ev), touch, panKey) : "pan";
  if (engine.gesture === "action") {
    const { tile, floor } = tf(ev);
    engine.onActionDown?.(tile, floor, touch, pickEntityAt(engine, ev.worldPos));
  }
}

function pointerMove(engine: TowerEngine, ev: ex.PointerEvent): void {
  const mv = engine.tracker.move(stablePointerId(ev.pointerId, ev.nativeEvent), ev.screenPos.x, ev.screenPos.y);
  if (engine.tracker.pinching) {
    if (mv) {
      // Two fingers translate the camera by their midpoint delta (pan) AND
      // scale by their distance ratio (zoom): the standard map gesture.
      pan(engine, mv.panDx, mv.panDy);
      if (mv.zoom !== 1) zoomAt(engine, mv.zoom, mv.cx, mv.cy);
    }
    return;
  }
  if (engine.arrowDrag) {
    engine.moved += Math.abs(ev.screenPos.y - engine.lastSy);
    engine.lastSy = ev.screenPos.y;
    engine.onExtendTo?.(engine.arrowDrag.end, engine.screenToFloor(ev.screenPos.y));
    return;
  }
  const { tile, floor } = tf(ev);
  if (engine.gesture === "pan") {
    const dx = ev.screenPos.x - engine.lastSx;
    const dy = ev.screenPos.y - engine.lastSy;
    engine.moved += Math.abs(dx) + Math.abs(dy);
    pan(engine, dx, dy);
    engine.lastSx = ev.screenPos.x;
    engine.lastSy = ev.screenPos.y;
  } else if (engine.gesture === "action") {
    engine.onActionMove?.(tile, floor, pickEntityAt(engine, ev.worldPos));
  } else if (ev.pointerType !== "Touch") {
    // Hover is a mouse/pen concept. A touch move can only reach this branch
    // in odd gestureless states (e.g. a finger held across a setSim input
    // reset); letting it hover would strand a build-preview ghost that no
    // later touch event clears.
    engine.onHover?.(tile, floor, pickEntityAt(engine, ev.worldPos));
  }
}

function pointerUp(engine: TowerEngine, ev: ex.PointerEvent): void {
  const r = engine.tracker.up(stablePointerId(ev.pointerId, ev.nativeEvent));
  if (r.pinch === "continues") {
    engine.gesture = null;
    return;
  }
  if (r.pinch === "ended") {
    if (r.survivor) {
      // Hand the surviving finger a pan continuation: seed the pan from its
      // tracked position and poison the tap slop so its release can neither
      // tap-place nor fall into the mouse hover path (which used to strand a
      // gold "valid" ghost on touch that nothing could commit or clear).
      engine.gesture = "pan";
      engine.lastSx = r.survivor.x;
      engine.lastSy = r.survivor.y;
      engine.moved = TAP_SLOP_POISON;
    } else {
      engine.gesture = null;
    }
    return;
  }
  if (engine.arrowDrag) {
    // A press without a drag extends a single floor.
    if (engine.moved < 5) {
      const t = engine.selectedId == null ? undefined : engine.sim.tower.getTransport(engine.selectedId);
      if (t) {
        const target = engine.arrowDrag.end === "up" ? t.top + 1 : t.bottom - 1;
        engine.onExtendTo?.(engine.arrowDrag.end, target);
      }
    }
    engine.onExtendEnd?.();
    engine.arrowDrag = null;
    engine.gesture = null;
    return;
  }
  const { tile, floor } = tf(ev);
  if (engine.gesture === "pan") {
    // Touch taps jitter more than mouse clicks, so allow a larger slop.
    if (engine.moved < (engine.downTouch ? 14 : 5)) {
      engine.onTap?.(tile, floor, ev.pointerType === "Touch", pickEntityAt(engine, ev.worldPos));
    }
  } else if (engine.gesture === "action") {
    engine.onActionUp?.(tile, floor, pickEntityAt(engine, ev.worldPos));
  }
  engine.gesture = null;
}

/** Camera policy for a swapped-in (or boot-loaded) tower: an undo/redo
 *  restore keeps the camera where the player is looking (keepCamera); a
 *  genuine tower swap (new game / load / import) restores the save's own
 *  view when it carries one, else centers as always. */
export function adoptCamera(engine: TowerEngine, view: SerializedView | null, keepCamera?: boolean): void {
  if (keepCamera) return;
  if (view) engine.applyView(view);
  else engine.center();
}

// ---- Camera control (Excalibur camera) ----------------------------------

export function pan(engine: TowerEngine, dxScreen: number, dyScreen: number): void {
  engine.cam.pos = ex.vec(engine.cam.pos.x - dxScreen / engine.cam.zoom, engine.cam.pos.y - dyScreen / engine.cam.zoom);
  clamp(engine);
}
export function zoomAt(engine: TowerEngine, factor: number, sx: number, sy: number): void {
  const before = engine.screenToWorld(sx, sy);
  engine.cam.zoom = clampGestureZoom(engine, engine.cam.zoom * factor);
  const after = engine.screenToWorld(sx, sy);
  engine.cam.pos = ex.vec(engine.cam.pos.x + (before.x - after.x), engine.cam.pos.y + (before.y - after.y));
  clamp(engine);
}

/** The tower-aware zoom-out floor for the CURRENT tower and viewport: a pinch
 *  or wheel can pull back until the whole built tower plus a breath of sky
 *  fits, then stops, rather than drifting into empty void. Recomputed per
 *  gesture because it moves as the tower grows and as the viewport resizes.
 *  Basements count: the span runs from the highest built floor to the lowest,
 *  so a deep tower frames its cellars too. See {@link fitZoom}. */
export function dynamicMinZoom(engine: TowerEngine): number {
  const span = engine.sim.tower.highestFloor - engine.sim.tower.lowestFloor + 1;
  return fitZoom(engine.viewHeight, span, FLOOR, MIN_ZOOM);
}

/** Clamp a gesture-driven zoom to `[effectiveMin, MAX_ZOOM]`. The static
 *  {@link clampZoom} (trust-boundary floor) still guards the save-restore path
 *  in {@link setCamera}; the tighter tower-aware floor applies only to live
 *  pinch/wheel/keyboard zoom so the player can't zoom out past their tower.
 *
 *  The floor only ever stops further zoom-OUT; it must never FORCE a zoom-in.
 *  The camera can legitimately sit below the current floor after a rotation
 *  that grew the viewport (a taller screen raises the floor) or a cross-device
 *  save whose zoom was set on a different viewport. Snapping such a view inward
 *  on the player's next pinch, especially a pinch-OUT, reads as the camera
 *  fighting them. So the effective floor drops to the current zoom when the
 *  camera is already below `lo`: the player still cannot zoom out any further,
 *  can zoom in freely, and the normal tower-aware floor re-engages the moment
 *  they climb back above it. */
export function clampGestureZoom(engine: TowerEngine, z: number): number {
  const lo = dynamicMinZoom(engine);
  const cur = engine.cam.zoom;
  const effectiveLo = Number.isFinite(cur) && cur < lo ? cur : lo;
  return Number.isFinite(z) ? Math.max(effectiveLo, Math.min(MAX_ZOOM, z)) : effectiveLo;
}
function clamp(engine: TowerEngine): void {
  const x = Math.max(0, Math.min(GRID.width * TILE, engine.cam.pos.x));
  // Zoom-aware vertical clamp: bound the visible top/bottom edges (not just
  // the center) so panning/zooming out never exposes empty void below the
  // deepest buildable basement. See {@link clampCameraY}.
  const y = clampCameraY(engine.cam.pos.y, engine.viewHeight, engine.cam.zoom, FLOOR, GRID.minFloor, GRID.maxFloor);
  engine.cam.pos = ex.vec(x, y);
}
export function center(engine: TowerEngine): void {
  const hi = engine.sim.tower.highestFloor;
  engine.cam.pos = ex.vec((GRID.width / 2) * TILE, -(Math.max(6, hi) / 2) * FLOOR);
}

/** The live camera as save-file cargo: center in grid units plus zoom (the
 *  exact inverse of {@link applyView}, so a same-device round trip is
 *  lossless). Stamped onto the sim by the UI layer right before a save. */
export function viewState(engine: TowerEngine): SerializedView {
  return { tile: engine.cam.pos.x / TILE, floor: -engine.cam.pos.y / FLOOR, zoom: engine.cam.zoom };
}

/** Restore a saved view. Zoom is optional (a TDT import has none): absent,
 *  the session's current zoom stays. Everything funnels through setCamera's
 *  clampZoom and the standard clamp() so a view saved on another device (or
 *  forged in a file) is re-bounded for THIS viewport before it can render. */
export function applyView(engine: TowerEngine, v: SerializedView): void {
  engine.setCamera(v.tile, v.floor, v.zoom ?? engine.cam.zoom);
  clamp(engine);
}

/** Zoom by a factor about the current center (keyboard +/- zoom). */
export function zoomBy(engine: TowerEngine, factor: number): void {
  engine.cam.zoom = clampGestureZoom(engine, engine.cam.zoom * factor);
  clamp(engine); // bound both axes, same as pointer zoom
}

/** Pan the camera the minimum amount so tile/floor sits within the viewport
 *  (with a margin), used to follow the keyboard build cursor. */
export function ensureVisible(engine: TowerEngine, tile: number, floor: number): void {
  const wx = tile * TILE;
  const wy = -floor * FLOOR;
  const halfW = engine.viewWidth / 2 / engine.cam.zoom;
  const halfH = engine.viewHeight / 2 / engine.cam.zoom;
  const mx = TILE * 3;
  const my = FLOOR * 1.5;
  let px = engine.cam.pos.x;
  let py = engine.cam.pos.y;
  if (wx < px - halfW + mx) px = wx + halfW - mx;
  else if (wx > px + halfW - mx) px = wx - halfW + mx;
  if (wy < py - halfH + my) py = wy + halfH - my;
  else if (wy > py + halfH - my) py = wy - halfH + my;
  engine.cam.pos = ex.vec(px, py);
  clamp(engine); // bound both axes, same as pointer pan
}
export function setCamera(engine: TowerEngine, tileX: number, floor: number, zoom: number): void {
  // Validate zoom to the supported range: the vertical clamp divides by zoom,
  // so a zero/negative/NaN value here would poison later pan/zoom math.
  engine.cam.zoom = clampZoom(zoom);
  engine.cam.pos = ex.vec(tileX * TILE, -floor * FLOOR);
}

// ---- Audio focus --------------------------------------------------------

/** Census cache per engine: the occupancy tally refreshes at most once per
 *  second (the GDD's cap), while the cheap dominant/zoom/clock reads stay per
 *  call. Keyed weakly so a torn-down engine drops its entry. */
const censusCache = new WeakMap<TowerEngine, { at: number; dominant: string; crowd: number }>();
const CENSUS_REFRESH_MS = 1000;

/** The occupancy walk behind {@link ViewFocus.crowd}: fill of the dominant
 *  kind's units in view, with a drawn-crowd fallback for kinds that track no
 *  occupants (lobbies, the street). 24 visible people count as a full house
 *  for the fallback. */
function censusCrowd(
  engine: TowerEngine,
  dominant: ViewFocus["dominant"],
  bounds: { t0: number; t1: number; f0: number; f1: number },
): number {
  let occ = 0;
  let cap = 0;
  if (dominant !== "empty" && dominant !== "outside") {
    for (const u of engine.sim.tower.units) {
      if (u.kind !== dominant) continue;
      if (u.floor < bounds.f0 || u.floor > bounds.f1) continue;
      if (u.x + u.width < bounds.t0 || u.x > bounds.t1) continue;
      const def = FACILITIES[u.kind];
      if (!def) continue; // a kind the catalog no longer knows: skip, never throw
      const unitCap = def.population > 0 ? def.population : (def.attendance ?? 0);
      if (unitCap > 0) {
        // Population>0 commercial venues (restaurant, fast food, shop) get
        // their `occupants` stamped to the full catalog population while open
        // (EconomySystem's open-hour pass), so the live fill is `customersIn`,
        // the routed-customer tally. Attendance venues (cinema, party hall)
        // already mirror `customersIn` into `occupants`, and every other kind
        // owns `occupants` via updatePresence, so both read `occupants`.
        // (`customersIn` is not persisted: right after a save load a busy
        // venue reads empty and quiet for the seconds it takes the crowd
        // system to re-route diners in. That is honest, the sim really has
        // nobody seated yet, and it self-heals; see the ambience backlog.)
        occ +=
          isCommercialKind(u.kind) && def.population > 0
            ? (u.customersIn ?? 0)
            : (u.occupants ?? 0);
        cap += unitCap;
      }
    }
  }
  if (cap > 0) return Math.min(1, Math.max(0, occ / cap));
  let visible = 0;
  for (const p of engine.sim.crowd.people) {
    if (p.floor < bounds.f0 || p.floor > bounds.f1) continue;
    if (p.x < bounds.t0 || p.x > bounds.t1) continue;
    visible++;
  }
  return Math.min(1, visible / 24);
}

export function focus(engine: TowerEngine): ViewFocus {
  const centerFloor = engine.screenToFloor(engine.viewHeight / 2);
  const night = engine.sim.clock.isNight();
  const t0 = engine.screenToTile(engine.viewWidth * 0.3);
  const t1 = engine.screenToTile(engine.viewWidth * 0.7);
  const f0 = engine.screenToFloor(engine.viewHeight * 0.7);
  const f1 = engine.screenToFloor(engine.viewHeight * 0.3);
  const tally = new Map<FacilityKind, number>();
  for (const u of engine.sim.tower.units) {
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
  // The occupancy walk refreshes at most once per second (or when the
  // dominant kind changes, so a pan onto a new venue reads it immediately);
  // ambience level changes are slow ramps, so a 1 s census is plenty.
  // A real, monotonically advancing clock: `performance.now()` where it exists,
  // else `Date.now()`. A constant 0 fallback would freeze `now - cached.at` at
  // 0 forever, so the 1 s refresh window would never elapse and the census
  // would stay stale for the life of the engine in any environment without
  // `performance`.
  const now =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const cached = censusCache.get(engine);
  let crowd: number;
  if (cached && cached.dominant === dominant && now - cached.at < CENSUS_REFRESH_MS) {
    crowd = cached.crowd;
  } else {
    crowd = censusCrowd(engine, dominant, { t0, t1, f0, f1 });
    censusCache.set(engine, { at: now, dominant, crowd });
  }
  const hour = engine.sim.clock.minuteOfDay / 60;
  return {
    centerFloor,
    dominant,
    night,
    zoom: engine.cam.zoom,
    weather: engine.sim.weather,
    hour,
    crowd,
  };
}
