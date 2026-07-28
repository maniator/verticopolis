import * as ex from "excalibur";
import { GARBAGE_COLLECT_HOUR, isElevatorKind, transportCarCapacity } from "../../engine/facilities";
import type { FacilityKind } from "../../engine/types";
import { isOperational } from "../../engine/types";
import { drawCar, drawGarbageTruck, drawMetroTrain, drawStreetCar } from "../sprites";
import { METRO_TRAIN_H, GARBAGE_TRUCK_H } from "../sprites/facilities/vehicles";
import { buildWalkers } from "./towerWalkerBuild";
import { carIndicator, type CarIndicator } from "../carIndicator";
import type { Person } from "../../engine/Crowd";
import { FLOOR, TILE } from "../scale";
import type { TowerEngine } from "./TowerEngine";
import { applyCrowdCull, reassertCrowdCull } from "./crowdCull";

/**
 * Engine-driven crowd and motion for {@link TowerEngine}: the routed commuter
 * actors, elevator cars, metro train, garbage trucks, garage cars and the
 * ambient walkers. Friend functions taking the engine instance. Extracted from
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

/** A single engine-driven walking figure (lobby/corridor walker or climber). */
export interface Walker {
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
  /** Origin tile of the run this figure paces (the transport's tile for a stair
   *  or escalator climber). Carried but NOT yet read: `walkerReachable` asks per
   *  floor today, and switches to the per-position probe once #647's segment
   *  routing lands, where a gap-split floor can strand one run while a sibling
   *  run of the same floor still routes to the lobby. */
  tileX: number;
  /** True for corridor loiterers gated on their floor's live occupancy; false
   *  for lobby/stair figures gated on the whole tower's busyness. */
  perFloor: boolean;
}

/** Draw the engine-owned commuters: add/remove/position one actor per live
 * person, by stable id. Read-only, the engine advances the crowd in tick(). */
export function reconcileCrowd(engine: TowerEngine): void {
  // Zoom cull (CAP-1): while the moving layer is sub-legible, skip the whole
  // add/remove/position pass. People who spawn or leave meanwhile are settled
  // by the first reconcile after the camera zooms back in. Runs the same
  // idempotent hysteresis step as updateMotion rather than reading the raw
  // latch, so correctness never rests on which pass the frame loop calls
  // first: whichever runs first this frame advances the latch, and an un-cull
  // frame always reconciles (rider hiding, despawn reaping) before rendering.
  if (applyCrowdCull(engine)) return;
  const seen = new Set<number>();
  for (const p of engine.sim.crowd.people) {
    seen.add(p.id);
    let rec = engine.crowdActors.get(p.id);
    if (!rec) {
      const gfx = p.staff ? engine.personGfxStaff : engine.personGfx[Math.abs(p.seed) % engine.personGfx.length];
      // Size the actor from the baked canvas so the collider and ground-line
      // anchor can never drift from the sprite's real footprint.
      const a = new ex.Actor({ pos: ex.vec(0, 0), width: gfx.width, height: gfx.height, anchor: ex.vec(0.5, 1), z: 3 });
      a.graphics.use(gfx);
      engine.engine.add(a);
      rec = { actor: a, gfx, red: false };
      engine.crowdActors.set(p.id, rec);
    }
    positionPerson(engine, p, rec);
  }
  reap(engine.crowdActors, seen, (rec) => rec.actor.kill());
}

function positionPerson(engine: TowerEngine, p: Person, rec: { actor: ex.Actor; gfx: ex.Canvas; red: boolean }): void {
  // While riding, a tenant is inside a car, the cab's own rider count shows
  // them, so we hide the standalone figure to avoid drawing them twice.
  // Staff stay visible while riding: a lone housekeeper in a 16-person
  // service cab rounds to zero on the cab's load indicator, and watching
  // them ride to the room floor is the whole point of the mechanic.
  const hidden = p.state === "riding" && !p.staff;
  if (rec.actor.graphics.visible !== !hidden) rec.actor.graphics.visible = !hidden;
  if (hidden) return;
  // Use the continuous floor (fy) so a stair/escalator climber animates
  // smoothly between floors; for every other state fy equals the floor.
  rec.actor.pos = ex.vec(engine.worldX(p.x), engine.worldYTop(p.fy) + FLOOR - 3);
  // Long waits redden the figure, the original's "this tenant is fed up" cue.
  // Staff never redden, they're on the clock, not an unhappy tenant.
  const red = !p.staff && p.wait > 25;
  if (red !== rec.red) {
    rec.red = red;
    rec.actor.graphics.use(red ? engine.personGfxRed : rec.gfx);
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
  for (const t of engine.truckActors) t.actor.kill();
  for (const g of engine.garageCars) g.actor.kill();
  for (const w of engine.walkers) w.actor.kill();
  engine.carActors = [];
  engine.trainActors = [];
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
  clearMotion(engine);
  for (const t of engine.sim.tower.transports) {
    if (!isElevatorKind(t.kind)) continue;
    const w = t.width * TILE;
    for (let i = 0; i < t.cars; i++) {
      const seed = (i * 7 + t.id) | 0;
      // Cab graphics are built lazily and cached by indicator state (rider
      // count, direction lantern, FULL) so we only ever draw each variant once.
      const gfx = new Map<string, ex.Canvas>();
      const a = new ex.Actor({ pos: ex.vec(engine.worldX(t.x), -t.carPositions[i] * FLOOR), width: w, height: FLOOR, anchor: ex.vec(0, 0), z: 2 });
      a.graphics.use(carGfx({ seed, w, kind: t.kind, gfx }, IDLE_CAR));
      engine.engine.add(a);
      engine.carActors.push({ actor: a, t, i, seed, w, kind: t.kind, gfx, shown: carKey(IDLE_CAR) });
    }
  }
  for (const u of engine.sim.tower.units) {
    if (u.kind !== "metro") continue;
    const w = u.width * TILE - 6;
    // The car sits on the track just below the platform edge: its base is 3px
    // off the station floor and it stands METRO_TRAIN_H tall (was a 9px sliver
    // stranded mid-trough).
    const trainY = engine.worldYTop(u.floor) + FLOOR - 3 - METRO_TRAIN_H;
    const cv = new ex.Canvas({ width: w, height: METRO_TRAIN_H, cache: true, draw: (ctx) => drawMetroTrain(ctx, w, true) });
    const a = new ex.Actor({ pos: ex.vec(engine.worldX(u.x) + 3, trainY), width: w, height: METRO_TRAIN_H, anchor: ex.vec(0, 0), z: 0.6 });
    a.graphics.use(cv);
    engine.engine.add(a);
    engine.trainActors.push({ actor: a, u, w });
  }
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
      z: 0.6,
    });
    a.graphics.use(cv);
    a.graphics.visible = false;
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
    const a = new ex.Actor({ pos: ex.vec(x0w, engine.worldYTop(floor) + FLOOR - 10), width: 16, height: 8, anchor: ex.vec(0, 0), z: 0.5 });
    a.graphics.use(cv);
    a.graphics.visible = false;
    engine.engine.add(a);
    engine.garageCars.push({ actor: a, floor, x0w, x1w, seed });
  }
  buildWalkers(engine);
  // A structural rebuild recreates the moving layer visible; while the camera
  // is culled-out, hide it again before it can flash for a frame.
  reassertCrowdCull(engine);
}


/** Refresh the per-floor occupancy map (0..1) when the hour or layout changes,
 *  so corridor loiterers appear only where tenants actually are. */
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
  // floor shows none. (How many the fraction reveals scales with the floor's
  // width, since a corridor's walker count comes from its tile span.)
  for (const [f, n] of people) engine.floorLive.set(f, Math.min(1, n / 16));
}

/** True when a commuter could reach the spot this figure paces (#639): a sky
 *  lobby nobody can get to must draw nobody. Reachability and not
 *  `isFloorServed`, because it runs the passenger router, so Classic's walk
 *  budget hides a lobby reachable only by a too-long stair climb (no commuter
 *  spawns for it either) while Modern's served-equals-reachable needs no era
 *  branch. Floor 1 short-circuits to true in the engine, so the main lobby is
 *  untouched. The verdict is memoized there per `tower.revision` in a per-sim
 *  WeakMap, so this is an O(1) lookup that cannot go stale across a load.
 *
 *  Known gap, and it fails safe: a climber carries its transport's BOTTOM floor,
 *  so a stair whose bottom is reachable but whose top is not still shows
 *  climbers. Reaching that needs Classic's walk budget to cut the flight one way
 *  (the router itself walks stairs, so a reachable bottom normally implies a
 *  reachable top), and it errs toward showing rather than hiding. Backlog row
 *  `walker-reachability-refinements`. */
function walkerReachable(engine: TowerEngine, w: Walker): boolean {
  return engine.sim.floorReachable(w.floor);
}

/** Repositions every moving actor each frame (the engine then draws them). */
export function updateMotion(engine: TowerEngine): void {
  // Zoom cull (CAP-1): owns the hysteresis step for the frame. While culled,
  // every per-frame position/graphic loop below is skipped along with the
  // sibling reconcileCrowd pass.
  if (applyCrowdCull(engine)) return;
  const anim = engine.d.anim;
  for (const c of engine.carActors) {
    c.actor.pos = ex.vec(engine.worldX(c.t.x), -c.t.carPositions[c.i] * FLOOR);
    // Indicator state (riders bucket scaled to capacity, direction lantern,
    // FULL) is derived by the tested carIndicator helper; the cab graphic is
    // cached per state so we only redraw when the state actually changes.
    const load = c.t.carLoad?.[c.i] ?? 0;
    const dir = c.t.carDir?.[c.i] ?? 0;
    const ind = carIndicator(dir, load, transportCarCapacity(c.t.kind));
    const key = carKey(ind);
    if (key !== c.shown) {
      c.shown = key;
      c.actor.graphics.use(carGfx(c, ind));
    }
  }
  for (const tr of engine.trainActors) {
    const cycle = (anim % 12) / 12;
    const span = tr.w + 12;
    let offset: number;
    if (cycle < 0.25) offset = (1 - cycle / 0.25) * -span;
    else if (cycle < 0.75) offset = 0;
    else offset = ((cycle - 0.75) / 0.25) * span;
    tr.actor.pos = ex.vec(engine.worldX(tr.u.x) + 3 + offset, engine.worldYTop(tr.u.floor) + FLOOR - 3 - METRO_TRAIN_H);
  }
  // The garbage truck runs on GAME time (the collection is a sim event, not
  // ambience): during the collection hour it drives in along the center's
  // bottom story, loads, and drives off, pausing the game freezes it.
  const clock = engine.sim.clock;
  const truckHour = clock.hour === GARBAGE_COLLECT_HOUR;
  for (const tk of engine.truckActors) {
    // No collection at a center that isn't running (under construction, on
    // fire, or a gutted shell), a non-operational plant processes no waste.
    const show = truckHour && isOperational(tk.u);
    if (tk.actor.graphics.visible !== show) tk.actor.graphics.visible = show;
    if (!show) continue;
    const p = (clock.minuteOfDay - GARBAGE_COLLECT_HOUR * 60) / 60; // 0..1 through the hour
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
  const rushing = (clock.isMorning() || clock.isEvening()) && engine.displayParkingUse > 0;
  for (const g of engine.garageCars) {
    if (g.actor.graphics.visible !== rushing) g.actor.graphics.visible = rushing;
    if (!rushing) continue;
    let p = (Math.abs(g.seed) % 100) / 100 + anim * 0.05;
    p -= Math.floor(p);
    const tt = 1 - Math.abs(2 * p - 1); // ping-pong along the deck
    g.actor.pos = ex.vec(g.x0w + tt * (g.x1w - g.x0w), engine.worldYTop(g.floor) + FLOOR - 10);
  }
  const stress = engine.d.stress ?? 0;
  // How busy the building looks right now: scales with population so an empty
  // tower has an empty lobby, and thins out overnight.
  const night = engine.sim.clock.isNight();
  const crowd = Math.min(1, engine.sim.population / 350) * (night ? 0.35 : 1);
  refreshFloorLiveliness(engine);
  for (const w of engine.walkers) {
    // Corridor loiterers gate on their own floor's live occupancy (so an empty
    // floor stays empty); lobby/stair figures gate on the whole tower's crowd.
    const threshold = w.perFloor ? (engine.floorLive.get(w.floor) ?? 0) : crowd;
    // Lobby and stair figures gate on tower-wide busyness, which says nothing
    // about whether anyone can get to that floor, so they also need the
    // reachability check (#639). Corridor loiterers do not: their floor has live
    // occupants, and stranded tenants are real people who are genuinely there
    // (a floor can lose its access and keep its leases until they churn out).
    const visible = w.rank <= threshold && (w.perFloor || walkerReachable(engine, w));
    if (w.actor.graphics.visible !== visible) w.actor.graphics.visible = visible;
    if (!visible) continue;
    let p = w.phase + (w.dir > 0 ? 0 : 0.5) + anim * w.speed * 0.03;
    p -= Math.floor(p);
    // Ping-pong 0→1→0 so figures pace back and forth (and stair climbers go
    // up *and* down) instead of teleporting from the far end back to the
    // start each loop, the old sawtooth made people look like they spawned on
    // one side, ran across, then vanished.
    const tt = 1 - Math.abs(2 * p - 1);
    w.actor.pos = ex.vec(w.x0w + tt * (w.x1w - w.x0w), w.y0w + tt * (w.y1w - w.y0w));
    const red = w.impatient && stress > 0.25;
    if (red !== w.red) {
      w.red = red;
      w.actor.graphics.use(red ? engine.personGfxRed : w.gfx);
    }
  }
}

