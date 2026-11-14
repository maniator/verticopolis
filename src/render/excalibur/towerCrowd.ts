import * as ex from "excalibur";
import { Z } from "../depthPlanes";
import { isElevatorKind } from "../../presentation/viewKinds";
import { catalogFacility } from "../../catalog/catalogTypes";
import { towerCatalog } from "../../catalog/towerCatalog";
import type { FacilityKind } from "../../shared/types";
import { isOperational } from "../../shared/unitState";
import { drawCar, drawGarbageTruck, drawStreetCar } from "../sprites";
import { GARBAGE_TRUCK_H } from "../sprites/facilities/vehicles";
import { metroTrainAt } from "../metroTrainSchedule";
import { addMetros } from "./towerMetro";
import { buildWalkers } from "./towerWalkerBuild";
import { cabFit, carIndicator, type CarIndicator } from "../carIndicator";
import { cabRidersOf, ridersAboard } from "./cabRiders";
import { glideCar, newCarDraw, type CarDrawState } from "../carMotion";
import type { PersonView } from "../../simport/view";
import { FLOOR, TILE } from "../scale";
import type { TowerEngine } from "./TowerEngine";
import { climbDrawX, leaveFlight, type Climber } from "../climbPath";
import { applyCrowdCull, reassertCrowdCull } from "./crowdCull";
import { FIGURE_ANCHOR, FIGURE_H, FIGURE_W } from "./peopleGfx";
import { advanceGlide, figureKey, newGlide, newStepClock, stepProgress, strideFrame, tickStepClock, type Glide, type StepClock } from "./crowdLook";
import { doorPlane, personFigure, ridingHidden, waitShaftMid, walkingPlane, type CrowdLook } from "./crowdFigure";
import { pushThroughDoors, turnHallDoors, type Pusher } from "./towerHallDoors";

/**
 * Engine-driven crowd and motion for {@link TowerEngine}: the routed commuter
 * actors, elevator cars, metro train, garbage trucks, garage cars and the
 * decorative passers-by. Friend functions taking the engine instance. Extracted from
 * `TowerEngine.ts`; the class keeps thin delegations. Pure code move: the
 * positioning, cadence and Excalibur calls are unchanged.
 */

/** The empty, idle cab state used to seed a fresh car's graphic. */
const IDLE_CAR: CarIndicator = { riders: 0, arrow: null, full: false };


/** Retained-actor reconciliation tail: kill and forget every entry the
 *  current pass didn't mark as seen. Each reconciler supplies its own
 *  disposal (kill one actor, kill a pair, drop a parallel sig entry). Shared
 *  by `towerCrowd` and `towerReconcile`. */
export function reap<K, V>(map: Map<K, V>, seen: ReadonlySet<K>, dispose: (v: V, k: K) => void): void {
  for (const [k, v] of map) {
    if (seen.has(k)) continue;
    dispose(v, k);
    map.delete(k);
  }
}

/** A decorative passer-by: a corridor figure that is not a person the engine
 *  knows about (#2091; built by `buildWalkers`, Modern only). */
export interface Walker {
  actor: ex.Actor;
  /** Its cast look (an index into `LOOKS`). */
  look: number;
  /** The bake it shows now (`figureKey`), so the graphic swaps only on a change. */
  key: number;
  x0w: number;
  x1w: number;
  /** The world y its feet stand on. */
  yw: number;
  speed: number;
  dir: number;
  phase: number;
  /** 0..1 position in its floor's crowd; shown only when the floor is busy enough. */
  rank: number;
  /** Floor this figure belongs to (for per-floor occupancy gating). */
  floor: number;
}

/** One drawn person: the actor, its glide between the engine's positions, and
 *  the bake it shows (`figureKey`), so the graphic swaps only on a change. */
export interface CrowdActor extends Pusher, Climber {
  actor: ex.Actor;
  glide: Glide;
  key: number;
  /** Whether the figure is drawn as inside a car (hidden). It follows the
   *  engine's riding state once the drawn car gets there. */
  inCar: boolean;
  /** The step on which this person got in or out of a car, while the drawn
   *  car is still on its way (see `positionPerson`). */
  boardStep?: number;
  /** The middle of the shaft this person waits at (`waitShaftMid`), found
   *  once per wait; `undefined` while not waiting. */
  shaftMid?: number | null;
  /** The floor `shaftMid` was found on: a wait on another floor finds its
   *  own shaft, even when the zoom cull hid the ride between them. */
  shaftFloor?: number;
}

const stepClocks = new WeakMap<TowerEngine, StepClock>();

/** The renderer's step clock, advanced once per frame by `tickCrowdClock`. */
function stepClockOf(engine: TowerEngine): StepClock {
  let c = stepClocks.get(engine);
  if (!c) {
    c = newStepClock(engine.sim.clock.minutes);
    stepClocks.set(engine, c);
  }
  return c;
}

/** Advance the step clock the cars and the people glide on by one frame of
 *  `elapsedMs`, before either is drawn (`updateMotion` calls it first). A
 *  paused game passes no time. */
export function tickCrowdClock(engine: TowerEngine, elapsedMs: number): void {
  tickStepClock(stepClockOf(engine), engine.sim.clock.minutes, engine.paused ? 0 : elapsedMs);
}

/** Draw the engine-owned commuters: add/remove/position one actor per live
 * person, by stable id. Read-only, the engine advances the crowd in tick().
 * The step clock (`tickCrowdClock`) paces the glide and the beats. */
export function reconcileCrowd(engine: TowerEngine): void {
  const clock = stepClockOf(engine);
  // Zoom cull (CAP-1): while the moving layer is sub-legible, skip the whole
  // add/remove/position pass. People who spawn or leave meanwhile are settled
  // by the first reconcile after the camera zooms back in. Runs the same
  // idempotent hysteresis step as updateMotion rather than reading the raw
  // latch, so correctness never rests on which pass the frame loop calls
  // first: whichever runs first this frame advances the latch, and an un-cull
  // frame always reconciles (rider hiding, despawn reaping) before rendering.
  if (applyCrowdCull(engine)) return;
  const rules = towerCatalog(engine.sim).rules;
  const look: CrowdLook = { lit: rules.shadedLook, fedUpWait: rules.fedUpWait, progress: stepProgress(clock), clock };
  const seen = new Set<number>();
  for (const p of engine.sim.crowd.people) {
    seen.add(p.id);
    let rec = engine.crowdActors.get(p.id);
    if (!rec) {
      const a = new ex.Actor({ pos: ex.vec(0, 0), width: FIGURE_W, height: FIGURE_H, anchor: FIGURE_ANCHOR, z: Z.crowd });
      engine.engine.add(a);
      rec = { actor: a, glide: newGlide(p.x, p.fy, (p.seed & 1) === 1), key: -1, inCar: ridingHidden(p) };
      engine.crowdActors.set(p.id, rec);
    }
    positionPerson(engine, p, rec, look);
  }
  turnHallDoors(engine);
  reap(engine.crowdActors, seen, (rec) => rec.actor.kill());
}

function positionPerson(engine: TowerEngine, p: PersonView, rec: CrowdActor, look: CrowdLook): void {
  const inCar = ridingHidden(p);
  // A rider walking into the car keeps the shaft found while they waited.
  const boarding = inCar && !rec.inCar;
  if ((p.state !== "waiting" && !boarding) || p.floor !== rec.shaftFloor) rec.shaftMid = undefined;
  const wasShown = rec.actor.graphics.isVisible;
  let doorX: number | undefined;
  // Getting in or out shows when the drawn car gets there: the cars glide
  // over the same step, so the change waits for the step's glide to end (or
  // the next step to land) instead of happening while the car is drawn a
  // floor away.
  if (rec.inCar !== inCar) {
    rec.boardStep ??= look.clock.steps;
    if (look.progress < 1 && look.clock.steps === rec.boardStep) {
      // Getting on: walk from the line into the car's door, reaching it as
      // the step's glide ends and the figure is hidden.
      if (!rec.inCar) doorX = rec.shaftMid ?? p.x;
      else {
        // Still in the drawn car: stay hidden, and follow the engine.
        if (wasShown) rec.actor.graphics.isVisible = false;
        advanceGlide(rec.glide, p.x, p.fy, look.clock.stepped, look.progress, false);
        return;
      }
    } else rec.inCar = inCar;
  }
  if (doorX === undefined) rec.boardStep = undefined;
  const hidden = rec.inCar;
  if (wasShown !== !hidden) rec.actor.graphics.isVisible = !hidden;
  // Off a stairway or escalator, the walk starts from the landing.
  if (p.state !== "climbing") {
    const landing = leaveFlight(rec);
    if (landing !== undefined) rec.glide.x = landing;
  }
  // A hidden rider still follows the engine, so it reappears where it gets
  // out instead of gliding there from the floor it boarded on.
  advanceGlide(rec.glide, doorX ?? p.x, p.fy, look.clock.stepped, look.progress, wasShown && !hidden, p.state === "riding");
  // A rider leaves no trail for the doors: their next step on foot is
  // measured from where they get out, not where they got in.
  if (hidden) {
    rec.lastX = undefined;
    return;
  }
  const g = rec.glide;
  // Use the continuous floor (fy) so a stair/escalator climber animates
  // smoothly between floors; for every other state fy equals the floor.
  // A climber is drawn along the flight's run, not up its middle.
  const climbX = p.state === "climbing" ? climbDrawX(rec, engine.sim.tower.transports, p.x, p.floor, g.fy, g.toFy < g.fromFy, engine.flightPass.winding) : undefined;
  if (climbX !== undefined) g.left = rec.climbLeft === true;
  rec.actor.pos = ex.vec(engine.worldX(climbX ?? g.x), engine.worldYTop(g.fy) + FLOOR - 3);
  // Inside a revolving door between lobby halls (#2068) a walker pushes it:
  // walking left they pass behind its center post, walking right in front.
  const onFloor = g.fy === p.floor;
  if (!onFloor) rec.lastX = undefined;
  const through = onFloor ? pushThroughDoors(engine, rec, p.floor, rec.actor.pos.x) : undefined;
  // Elsewhere, walking along a floor, a person passes behind the shafts and
  // cabs. The waiting line, a climber and a rider stay in front: the line's
  // mood colors are the traffic gauge, and the others are on the transport.
  const z = through !== undefined ? doorPlane(through) : walkingPlane(p);
  if (rec.actor.z !== z) rec.actor.z = z;
  if (p.state === "waiting" && rec.shaftMid === undefined) {
    rec.shaftMid = waitShaftMid(engine.sim.tower.transports, p);
    rec.shaftFloor = p.floor;
  }
  const key = personFigure(p, g, look, through, rec.shaftMid);
  if (key !== rec.key) {
    rec.key = key;
    rec.actor.graphics.use(engine.people.get(key));
  }
}

export function clearCrowd(engine: TowerEngine): void {
  // Only the drawn actors are ours; the crowd model belongs to the sim.
  for (const rec of engine.crowdActors.values()) rec.actor.kill();
  engine.crowdActors.clear();
}

// ---- Engine-driven motion (cars, train, walkers) ------------------------

export function clearMotion(engine: TowerEngine): void {
  for (const c of engine.carActors) c.actor.kill();
  for (const t of engine.trainActors) t.actor.kill();
  for (const t of engine.tunnelActors) t.kill();
  for (const t of engine.truckActors) t.actor.kill();
  for (const g of engine.garageCars) g.actor.kill();
  for (const w of engine.walkers) w.actor.kill();
  engine.carActors = [];
  engine.trainActors = [];
  engine.tunnelActors = [];
  engine.truckActors = [];
  engine.garageCars = [];
  engine.walkers = [];
}

/** Stable cache key for a cab graphic's indicator state. */
function carKey(ind: CarIndicator): string {
  return `${ind.riders}:${ind.arrow ?? "x"}:${ind.full ? "f" : "e"}`;
}

/** Get-or-create the cab graphic for a given indicator state. Keying and
 *  drawing both derive from the one {@link CarIndicator} plus the entry's
 *  fixed kind; the key can skip the kind only because each cache map belongs
 *  to a single car whose shaft never changes kind (any rebuild goes through
 *  syncMotion, which recreates the entry). */
function carGfx(entry: { seed: number; w: number; kind: FacilityKind; gfx: Map<string, ex.Canvas> }, ind: CarIndicator): ex.Canvas {
  const key = carKey(ind);
  let cv = entry.gfx.get(key);
  if (!cv) {
    const { seed, w, kind } = entry;
    cv = new ex.Canvas({
      width: w,
      height: FLOOR,
      cache: true,
      draw: (ctx) => drawCar(ctx, seed, w, FLOOR, ind.riders, ind.arrow, ind.full, kind),
    });
    entry.gfx.set(key, cv);
  }
  return cv;
}

export function syncMotion(engine: TowerEngine): void {
  // Carry each car's glide state across the rebuild, keyed by shaft id +
  // car index: structural edits run syncMotion on every revision bump, and
  // without the carry-over an unrelated place/demolish would snap every
  // mid-travel car to its sim position (GH #688). A shaft that vanished simply
  // has no new entry to claim its old state; a genuinely new car seeds lazily
  // at its sim position in updateMotion (the CAP-3 rebuild snap).
  const carried = new Map<string, CarDrawState>();
  for (const c of engine.carActors) {
    const s = carDrawStates.get(c);
    if (s) carried.set(`${c.t.id}:${c.i}`, s);
  }
  clearMotion(engine);
  for (const t of engine.sim.tower.transports) {
    if (!isElevatorKind(t.kind)) continue;
    const w = t.width * TILE;
    for (let i = 0; i < t.cars; i++) {
      const seed = (i * 7 + t.id) | 0;
      // Cab graphics are built lazily and cached by indicator state (rider
      // count, direction lantern, FULL) so we only ever draw each variant once.
      const gfx = new Map<string, ex.Canvas>();
      const a = new ex.Actor({ pos: ex.vec(engine.worldX(t.x), -t.carPositions[i] * FLOOR), width: w, height: FLOOR, anchor: ex.vec(0, 0), z: Z.cab });
      a.graphics.use(carGfx({ seed, w, kind: t.kind, gfx }, IDLE_CAR));
      engine.engine.add(a);
      const entry = { actor: a, t, i, seed, w, kind: t.kind, gfx, shown: carKey(IDLE_CAR) };
      const prev = carried.get(`${t.id}:${i}`);
      if (prev) carDrawStates.set(entry, prev);
      freshCabs.add(entry);
      engine.carActors.push(entry);
    }
  }
  addMetros(engine, engine.sim.tower.units.filter((u) => u.kind === "metro"));
  // Garbage trucks: one per recycling center, parked off-screen until the
  // collection hour (updateMotion drives them in and out along the bottom
  // story, exactly the metro-train pattern).
  for (const u of engine.sim.tower.units) {
    if (u.kind !== "recycling") continue;
    const w = 68;
    const cv = new ex.Canvas({ width: w, height: GARBAGE_TRUCK_H, cache: true, draw: (ctx) => drawGarbageTruck(ctx, w) });
    const a = new ex.Actor({
      pos: ex.vec(engine.worldX(u.x), engine.worldYTop(u.floor) + FLOOR - GARBAGE_TRUCK_H),
      width: w,
      height: GARBAGE_TRUCK_H,
      anchor: ex.vec(0, 0),
      z: Z.vehicle,
    });
    a.graphics.use(cv);
    a.graphics.isVisible = false;
    engine.engine.add(a);
    engine.truckActors.push({ actor: a, u, w });
  }
  // Commute cars: one per floor that carries parking structure, cruising the
  // extent of that floor's parking/ramp run at rush hours.
  const runs = new Map<number, { min: number; max: number }>();
  for (const u of engine.sim.tower.units) {
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
    const x0w = engine.worldX(r.min) + 2;
    const x1w = engine.worldX(r.max) - 18;
    // A run too short for the car to travel gets none, bail BEFORE creating
    // the actor, so an untracked actor is never added to the engine (it would
    // leak: clearMotion only kills what's in this.garageCars).
    if (x1w <= x0w) continue;
    const seed = (floor * 97 + r.min * 13) | 0;
    const cv = new ex.Canvas({ width: 16, height: 8, cache: true, draw: (ctx) => drawStreetCar(ctx, seed) });
    const a = new ex.Actor({ pos: ex.vec(x0w, engine.worldYTop(floor) + FLOOR - 10), width: 16, height: 8, anchor: ex.vec(0, 0), z: Z.streetCar });
    a.graphics.use(cv);
    a.graphics.isVisible = false;
    engine.engine.add(a);
    engine.garageCars.push({ actor: a, floor, x0w, x1w, seed });
  }
  buildWalkers(engine);
  // A structural rebuild recreates the moving layer visible; while the camera
  // is culled-out, hide it again before it can flash for a frame.
  reassertCrowdCull(engine);
}


/** Refresh the per-floor occupancy map (0..1) when the hour or layout changes,
 *  so decorative passers-by appear only where tenants actually are. */
function refreshFloorLiveliness(engine: TowerEngine): void {
  const hour = engine.sim.clock.hour;
  const rev = engine.sim.tower.revision;
  if (hour === engine.floorLiveHour && rev === engine.floorLiveRev) return;
  engine.floorLiveHour = hour;
  engine.floorLiveRev = rev;
  const people = new Map<number, number>();
  for (const u of engine.sim.tower.units) {
    if (u.occupants > 0) people.set(u.floor, (people.get(u.floor) ?? 0) + u.occupants);
  }
  engine.floorLive.clear();
  // Scale present occupants to 0..1: ~16 on a floor reads as fully lively (all
  // its loiterers shown); a busier floor shows more, an empty or all-vacant
  // floor shows none.
  for (const [f, n] of people) engine.floorLive.set(f, Math.min(1, n / 16));
}

/** Per-entry glide state for the elevator cars (GH #688, #2097). Keyed off the
 *  carActors entry object so syncMotion's full rebuild naturally forgets old
 *  cars, and a fresh entry lazily seeds AT its sim position (its first frame
 *  snaps, exactly the old behavior, which also keeps fake-entry tests exact).
 *  Deliberately not gated on `d.anim`: car motion is functional, so it keeps
 *  gliding under reduced motion, the same rule the routed crowd follows. */
const carDrawStates = new WeakMap<object, CarDrawState>();
/** The step on which a car's riders changed, while the drawn car is still on
 *  its way there. */
const cabChangeStep = new WeakMap<object, number>();
/** Cars just rebuilt by `syncMotion`: their first riders show at once. */
const freshCabs = new WeakSet<object>();

/** Repositions every moving actor each frame (the engine then draws them).
 *  `elapsedMs` is the engine update's frame delta (stepped by the screenshot
 *  TestClock, so the glide below stays deterministic); it advances the step
 *  clock the cars and the people share, and the default keeps legacy callers
 *  and tests on a plain 60fps frame. */
export function updateMotion(engine: TowerEngine, elapsedMs = 1000 / 60): void {
  // The step clock runs even while culled, so a zoom-in finds it current.
  tickCrowdClock(engine, elapsedMs);
  const clock = stepClockOf(engine);
  const progress = stepProgress(clock);
  // Zoom cull (CAP-1): owns the hysteresis step for the frame. While culled,
  // every per-frame position/graphic loop below is skipped along with the
  // sibling reconcileCrowd pass.
  if (applyCrowdCull(engine)) return;
  const anim = engine.d.anim;
  const aboard = cabRidersOf(engine, clock.stepped);
  for (const c of engine.carActors) {
    const target = c.t.carPositions[c.i];
    let drawn = carDrawStates.get(c);
    if (!drawn) {
      drawn = newCarDraw(target);
      carDrawStates.set(c, drawn);
    }
    // The drawn car glides to the engine's position over the step, on the
    // people's step clock, instead of catching up and waiting between floors.
    glideCar(drawn, target, clock.stepped, progress);
    // A stale or hostile engine value beyond the shaft never draws past it.
    if (typeof c.t.bottom === "number" && drawn.pos < c.t.bottom) drawn.pos = c.t.bottom;
    if (typeof c.t.top === "number" && drawn.pos > c.t.top) drawn.pos = c.t.top;
    c.actor.pos = ex.vec(engine.worldX(c.t.x), -drawn.pos * FLOOR);
    // carIndicator turns the boarded riders, the lantern and FULL into the
    // cab's state; its graphic is cached per state and redrawn on a change.
    const [load, cap] = [c.t.carLoad?.[c.i] ?? 0, catalogFacility(towerCatalog(engine.sim), c.t.kind).carCapacity ?? 0];
    const ind = carIndicator(c.t.carDir?.[c.i] ?? 0, load, cap, cabFit(c.w), ridersAboard(aboard, c.t.id, c.i));
    // The cab's riders change when the drawn car gets there, on the same rule
    // as the people getting in or out (`positionPerson`), so nobody shows in
    // the cab and on the landing at once, or in neither.
    const key = carKey(ind);
    const fresh = freshCabs.delete(c);
    if (key === c.shown) cabChangeStep.delete(c);
    else {
      const since = cabChangeStep.get(c) ?? clock.steps;
      if (progress >= 1 || clock.steps > since || fresh) {
        c.shown = key;
        cabChangeStep.delete(c);
        c.actor.graphics.use(carGfx(c, ind));
      } else cabChangeStep.set(c, since);
    }
  }
  // The metro's one train per line runs on GAME time like the garbage truck:
  // a run per daytime hour, none overnight, held while the game is paused.
  for (const tr of engine.trainActors) {
    const c = engine.sim.clock;
    tr.shift(metroTrainAt(c.minuteOfDay, tr.line, tr.w + 12, c.isNight()) - tr.line[tr.stop]);
  }
  // The garbage truck runs on GAME time (the collection is a sim event, not
  // ambience): during the collection hour it drives in along the center's
  // bottom story, loads, and drives off, pausing the game freezes it.
  const simClock = engine.sim.clock;
  const garbageCollectHour = towerCatalog(engine.sim).economy.garbageCollectHour;
  const truckHour = simClock.hour === garbageCollectHour;
  for (const tk of engine.truckActors) {
    // No collection at a center that isn't running (under construction, on
    // fire, or a gutted shell), a non-operational plant processes no waste.
    const show = truckHour && isOperational(tk.u);
    if (tk.actor.graphics.isVisible !== show) tk.actor.graphics.isVisible = show;
    if (!show) continue;
    const p = (simClock.minuteOfDay - garbageCollectHour * 60) / 60; // 0..1 through the hour
    const base = engine.worldX(tk.u.x);
    const uw = tk.u.width * TILE;
    let x: number;
    if (p < 0.25) x = base - 60 + (p / 0.25) * 60; // roll in from the left
    else if (p < 0.7) x = base; // loading at the mouth
    else x = base + ((p - 0.7) / 0.3) * (uw + 20); // drive off across the deck
    tk.actor.pos = ex.vec(x, engine.worldYTop(tk.u.floor) + FLOOR - GARBAGE_TRUCK_H);
  }
  // Garage commute cars: cruise the parking decks during the morning and
  // evening rushes, but only when the garage actually has cars to move.
  // Reads the fraction computed in syncScene (per sync, not per frame), so
  // this frame-path never runs the parking flood-fill itself.
  // While guards search for a bomb the engine holds every person and car
  // still, so the decorations that stand for people (garage cars,
  // passers-by) leave too.
  const lockdown = engine.sim.bombSearch?.lockdown === true;
  const rushing = (simClock.isMorning() || simClock.isEvening()) && engine.displayParkingUse > 0 && !lockdown;
  for (const g of engine.garageCars) {
    if (g.actor.graphics.isVisible !== rushing) g.actor.graphics.isVisible = rushing;
    if (!rushing) continue;
    let p = (Math.abs(g.seed) % 100) / 100 + anim * 0.05;
    p -= Math.floor(p);
    const tt = 1 - Math.abs(2 * p - 1); // ping-pong along the deck
    g.actor.pos = ex.vec(g.x0w + tt * (g.x1w - g.x0w), engine.worldYTop(g.floor) + FLOOR - 10);
  }
  // A tower with no passers-by (every Classic tower) skips the occupancy walk.
  if (engine.walkers.length > 0) refreshFloorLiveliness(engine);
  // The Settings switch (Modern, default off) and reduced motion each hide every
  // passer-by; reduced motion promises to calm background animation (#2091).
  const passersShown = engine.passersBy && !engine.reducedMotion && !lockdown;
  const lit = engine.walkers.length > 0 && towerCatalog(engine.sim).rules.shadedLook;
  for (const w of engine.walkers) {
    // A passer-by shows only while its own floor has live occupants, so an
    // empty floor stays empty.
    const visible = passersShown && w.rank <= (engine.floorLive.get(w.floor) ?? 0);
    if (w.actor.graphics.isVisible !== visible) w.actor.graphics.isVisible = visible;
    if (!visible) continue;
    let p = w.phase + (w.dir > 0 ? 0 : 0.5) + anim * w.speed * 0.03;
    p -= Math.floor(p);
    // Ping-pong 0→1→0 so figures pace back and forth instead of teleporting
    // from the far end back to the start each loop.
    const tt = 1 - Math.abs(2 * p - 1);
    // A passer-by never turns amber or red: it has no wait, and a mood color
    // is how a player spots a real person waiting too long. It faces the way
    // it paces (the first half of the ping-pong runs toward x1w).
    w.actor.pos = ex.vec(w.x0w + tt * (w.x1w - w.x0w), w.yw);
    const key = figureKey(w.look, "walk", strideFrame(lit, w.actor.pos.x, w.look), "content", p > 0.5, lit);
    if (key !== w.key) {
      w.key = key;
      w.actor.graphics.use(engine.people.get(key));
    }
  }
}
