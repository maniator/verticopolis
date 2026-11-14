import { describe, it, expect, vi } from "vitest";
import { kindFacts } from "../../tests/catalogKinds";
import * as ex from "excalibur";
import { FLOOR, TILE } from "../scale";
import { cabFit, carIndicator, type CarIndicator } from "../carIndicator";
import { reap, reconcileCrowd, clearCrowd, clearMotion, tickCrowdClock, updateMotion } from "./towerCrowd";
import { Z } from "../depthPlanes";
import { HallDoorLayer } from "./towerHallDoors";
import { advanceGlide, figureOf, MAX_STEP_MS, MAX_STRIDE_TILES, newGlide } from "./crowdLook";
import { FIGURE_H, FIGURE_W } from "./peopleGfx";
import { castIndex, LOOK } from "../pixelSprites/people";

/** One drawn frame of `ms`: the step clock, then the crowd pass (the order `TowerEngine.tick` runs them in). */
function frame(e: any, ms = 1000 / 60): void {
  tickCrowdClock(e, ms);
  reconcileCrowd(e);
}

/**
 * Engine-driven crowd and motion for the tower renderer. The parts that BAKE
 * cab/train/walker graphics (syncMotion, buildWalkers) allocate `ex.Canvas`,
 * which needs a real 2D context and can't run under happy-dom; those stay on
 * the Playwright tier. Everything that repositions or reconciles pre-built
 * actors IS unit-testable with real (drawing-free) `ex.Actor`s and fake
 * graphics: this drives the crowd reconciler, the clear paths, the pure `reap`
 * tail, and updateMotion across cars, the metro train, the garbage truck,
 * and garage cars, asserting positions/visibility, not just no-throw (the
 * passers-by live in towerCrowdMotion.test.ts).
 */

const gfx = () => ({ width: 9, height: 25 }) as ex.Graphic;
// Match the walker bake footprint (9x25) the production actors adopt from their
// canvas, so fixtures never encode the legacy 8x14 size.
const actor = () => new ex.Actor({ pos: ex.vec(0, 0), width: 9, height: 25 });
const carKey = (ind: CarIndicator) => `${ind.riders}:${ind.arrow ?? "x"}:${ind.full ? "f" : "e"}`;

/** A fake engine carrying the fields the motion/crowd functions read, plus the
 *  two pure world-coordinate helpers the class exposes. */

/** The fake `sim` the render helpers read, with `over` merged on top. Tests that
 *  need their own units or clock go through this instead of writing a whole `sim`
 *  literal, so a new engine call read by the render layer
 *  only has to be defaulted in one place. */
function simFixture(over: Record<string, any> = {}): any {
  return {
    mode: "modern",
    population: 400,
    crowd: { people: [] },
    clock: { minutes: 0, hour: 12, minuteOfDay: 12 * 60, isMorning: () => false, isEvening: () => false, isNight: () => false },
    tower: { revision: 1, units: [], transports: [] },
    ...over,
  };
}

function eng(over: Record<string, any> = {}): any {

  const e: any = {
    engine: { add: vi.fn() },
    d: { anim: 0, stress: 0 },
    // The zoom cull (crowdCull.ts) reads these at the top of every pass; a
    // legible zoom keeps the moving layer live for the motion assertions.
    cam: { zoom: 1 },
    crowdCulled: false,
    crowdActors: new Map(),
    hallDoors: new HallDoorLayer(),
    carActors: [],
    trainActors: [],
    tunnelActors: [],
    truckActors: [],
    garageCars: [],
    walkers: [],
    passersBy: true,
    reducedMotion: false,
    floorLive: new Map(),
    floorLiveHour: -1,
    floorLiveRev: -1,
    displayParkingUse: 0,
    people: { get: vi.fn((_key: number) => gfx()) },
    worldX: (tile: number) => tile * TILE,
    worldYTop: (floor: number, h = 1) => -(floor + h - 1) * FLOOR,
    sim: simFixture(),
    ...over,
  };
  return e;
}

describe("reap (retained-actor reconciliation tail)", () => {
  it("disposes and drops every entry the pass did not mark seen", () => {
    const killed: number[] = [];
    const map = new Map([[1, "a"], [2, "b"], [3, "c"]]);
    reap(map, new Set([2]), (_v, k) => killed.push(k));
    expect(killed.sort()).toEqual([1, 3]);
    expect([...map.keys()]).toEqual([2]);
  });
});

describe("reconcileCrowd draws one actor per live person", () => {
  it("adds an actor for a new person, positions it, and reaps the departed", () => {
    const e = eng({ sim: { ...eng().sim, crowd: { people: [{ id: 1, seed: 0, staff: false, state: "toDest", x: 10, fy: 5, wait: 0 }] } } });
    frame(e);
    expect(e.crowdActors.size).toBe(1);
    expect(e.engine.add).toHaveBeenCalledTimes(1);
    const rec = e.crowdActors.get(1);
    expect(rec.actor.pos.x).toBeCloseTo(10 * TILE, 6);
    // Every figure shares one canvas size, so the footprint never depends on
    // the pose the frame shows.
    expect(rec.actor.width).toBeCloseTo(FIGURE_W, 6);
    expect(rec.actor.height).toBeCloseTo(FIGURE_H, 6);
    // A person who has not moved yet stands, in their own cast look.
    const shown = figureOf(e.people.get.mock.calls[0][0]);
    expect(shown).toMatchObject({ look: castIndex(0), pose: "stand", mood: "content", lit: true });

    // Next pass: the person is gone, so its actor is reaped.
    e.sim.crowd.people = [];
    frame(e);
    expect(e.crowdActors.size).toBe(0);
  });

  it("hides a riding tenant but keeps riding staff visible", () => {
    const e = eng({
      sim: { ...eng().sim, crowd: { people: [
        { id: 1, seed: 0, staff: false, state: "riding", x: 10, fy: 5, wait: 0 },
        { id: 2, seed: 1, staff: true, state: "riding", x: 12, fy: 6, wait: 0 },
      ] } },
    });
    frame(e);
    expect(e.crowdActors.get(1).actor.graphics.isVisible).toBe(false);
    expect(e.crowdActors.get(2).actor.graphics.isVisible).toBe(true);
  });

  it("shows a wait as a pose and a mood: the time, then hips in amber, then arms up in red", () => {
    // The fixture catalog's fed-up line is 25 minutes (`rules.fedUpWait`).
    const waits = [2, 10, 18, 30];
    const e = eng({ sim: { ...eng().sim, crowd: { people: waits.map((wait, i) => ({ id: i + 1, seed: i, staff: false, state: "waiting", x: 10 + i, fy: 5, wait })) } } });
    frame(e);
    const shown = waits.map((_w, i) => figureOf(e.crowdActors.get(i + 1).key));
    expect(shown.map((f) => [f.pose, f.mood])).toEqual([
      ["stand", "content"],
      ["watch", "content"],
      ["hips", "impatient"],
      ["armsUp", "fedUp"],
    ]);
  });

  it("waits facing the shaft it walked into, then finds the shaft again at the next wait", () => {
    // The engine walks a rider into the middle of the shaft (x 10-14, middle
    // 12), starts the wait there, then lines them up beside it. A second
    // shaft at 18 is nearer the line, and is not theirs.
    const person = { id: 1, seed: 0, staff: false, state: "toShaft", x: 4, floor: 5, fy: 5, wait: 0 };
    const car = { kind: "elevatorStandard", width: 4, bottom: 0, top: 20, cars: 1, carPositions: [0], carDir: [0] };
    const transports = [{ id: 9, x: 10, ...car }, { id: 8, x: 18, ...car }];
    const e = eng({ sim: simFixture({ crowd: { people: [person] }, tower: { revision: 1, units: [], transports } }) });
    const step = (minutes: number, change: object) => {
      Object.assign(person, change);
      e.sim.clock = { ...e.sim.clock, minutes };
      frame(e, MAX_STEP_MS);
      frame(e, MAX_STEP_MS);
    };
    frame(e, MAX_STEP_MS);
    step(1, { x: 12, state: "waiting" });
    step(2, { x: 17 }); // walked right, out of the shaft to the line
    const rec = e.crowdActors.get(1);
    expect(figureOf(rec.key).left).toBe(true);
    // Riding up and waiting on the far side of the other shaft faces that one.
    step(3, { state: "toDest" });
    step(4, { x: 20, state: "waiting" });
    step(5, { x: 23 });
    expect(figureOf(rec.key).left).toBe(true);
    step(6, { state: "toDest" });
    step(7, { x: 20, state: "waiting" });
    step(8, { x: 16 });
    expect(figureOf(rec.key).left).toBe(false);
  });

  it("glides between the engine's positions and walks while it moves, instead of hopping", () => {
    const person = { id: 1, seed: 0, staff: false, state: "toDest", x: 10, fy: 5, wait: 0 };
    const e = eng({ sim: { ...eng().sim, crowd: { people: [person] } } });
    // A step every ten frames, the first one standing still.
    for (let i = 0; i < 10; i++) frame(e, 16);
    e.sim.clock = { ...e.sim.clock, minutes: 1 };
    frame(e, 16);
    for (let i = 0; i < 9; i++) frame(e, 16);
    // A sim step moves the person 12 tiles at once, as the slowest speed does.
    person.x = 22;
    e.sim.clock = { ...e.sim.clock, minutes: 2 };
    frame(e, 16);
    const rec = e.crowdActors.get(1);
    // The step's own frame already draws a tenth of the way (the frame is
    // part of the step), so the figure never holds still for a frame.
    expect(rec.actor.pos.x).toBeCloseTo(11.2 * TILE, 6);
    frame(e, 16);
    const first = rec.actor.pos.x;
    expect(first).toBeGreaterThan(10 * TILE);
    expect(first).toBeLessThan(22 * TILE);
    expect(figureOf(rec.key)).toMatchObject({ pose: "walk", left: false });
    // Frames with no new step carry it on toward the engine's position, never past it.
    let last = first;
    for (let i = 0; i < 30; i++) {
      frame(e, 16);
      expect(rec.actor.pos.x).toBeGreaterThanOrEqual(last);
      last = rec.actor.pos.x;
    }
    expect(rec.actor.pos.x).toBeCloseTo(22 * TILE, 6);
    // Arrived, it stops walking; heading back, it turns around.
    expect(figureOf(rec.key).pose).toBe("stand");
    person.x = 16;
    e.sim.clock = { ...e.sim.clock, minutes: 3 };
    frame(e, 16);
    expect(figureOf(rec.key)).toMatchObject({ pose: "walk", left: true });
  });

  it("stretches the glide over a slow step's real gap and freezes it while paused", () => {
    const person = { id: 1, seed: 0, staff: false, state: "toDest", x: 10, fy: 5, wait: 0 };
    const e = eng({ sim: { ...eng().sim, crowd: { people: [person] } } });
    // Two steps 2 s apart, as the bottom speed runs in the lunch slowdown.
    frame(e, 16);
    frame(e, 1984);
    person.x = 16;
    e.sim.clock = { ...e.sim.clock, minutes: 1 };
    frame(e, 16);
    const rec = e.crowdActors.get(1);
    // Half a second into a 2 s step (its own frame counts): a quarter of the
    // way, still walking.
    for (let i = 0; i < 4; i++) frame(e, 100);
    frame(e, 84);
    expect(rec.actor.pos.x).toBeCloseTo(11.5 * TILE, 6);
    expect(figureOf(rec.key).pose).toBe("walk");
    // Paused, the figure holds where it is.
    e.paused = true;
    for (let i = 0; i < 20; i++) frame(e, 100);
    expect(rec.actor.pos.x).toBeCloseTo(11.5 * TILE, 6);
    // Unpaused, it carries on and lands on the engine's position.
    e.paused = false;
    for (let i = 0; i < 15; i++) frame(e, 100);
    expect(rec.actor.pos.x).toBeCloseTo(16 * TILE, 6);
  });

  it("walks behind the shafts and cabs, and waits, climbs and rides in front of them", () => {
    const person = { id: 1, seed: 0, staff: true, state: "toDest", x: 10, fy: 5, wait: 0 };
    const e = eng({ sim: { ...eng().sim, crowd: { people: [person] } } });
    frame(e, 16);
    const rec = e.crowdActors.get(1);
    expect(rec.actor.z).toBe(Z.walking);
    expect(Z.walking).toBeLessThan(Z.transport);
    for (const state of ["waiting", "climbing", "riding"]) {
      person.state = state;
      frame(e, 16);
      expect(rec.actor.z, state).toBe(Z.crowd);
    }
    person.state = "toShaft";
    frame(e, 16);
    expect(rec.actor.z).toBe(Z.walking);
  });

  it("keeps an even leg cadence at a fast speed instead of strobing", () => {
    const g = newGlide(0, 5, false);
    // A fast step: 30 tiles in two drawn frames.
    advanceGlide(g, 30, 5, true, 0.5, true);
    advanceGlide(g, 30, 5, false, 1, true);
    expect(g.x).toBe(30);
    expect(g.walked).toBeCloseTo(2 * MAX_STRIDE_TILES, 9);
    // A slow walk counts every pixel, so the feet land with the ground.
    const slow = newGlide(0, 5, false);
    advanceGlide(slow, 0.1, 5, true, 1, true);
    expect(slow.walked).toBeCloseTo(0.1, 9);
  });

  it("jumps at once across a floor change, a hop no walk could make", () => {
    const person = { id: 1, seed: 0, staff: false, state: "toDest", x: 10, fy: 5, wait: 0 };
    const e = eng({ sim: { ...eng().sim, crowd: { people: [person] } } });
    frame(e, 16);
    Object.assign(person, { x: 30, fy: 9 });
    e.sim.clock = { ...e.sim.clock, minutes: 1 };
    frame(e, 16);
    const rec = e.crowdActors.get(1);
    expect(rec.actor.pos.x).toBeCloseTo(30 * TILE, 6);
    expect(rec.actor.pos.y).toBeCloseTo(-9 * FLOOR + FLOOR - 3, 6);
  });

  it("vacuums while a housekeeper dwells at a room, and climbs on the stairs", () => {
    const e = eng({ sim: { ...eng().sim, crowd: { people: [
      { id: 1, seed: 0, staff: true, state: "dwelling", x: 10, fy: 5, wait: 0 },
      { id: 2, seed: 3, staff: false, state: "climbing", x: 14, fy: 5.5, wait: 0 },
    ] } } });
    frame(e);
    expect(figureOf(e.crowdActors.get(1).key)).toMatchObject({ look: LOOK.housekeeperCleaning, pose: "push" });
    expect(figureOf(e.crowdActors.get(2).key)).toMatchObject({ look: castIndex(3), pose: "climb" });
  });
});

describe("clear paths kill every actor they own", () => {
  it("clearCrowd kills the crowd actors and empties the map", () => {
    const e = eng();
    const a = actor();
    const killSpy = vi.spyOn(a, "kill");
    e.crowdActors.set(1, { actor: a, glide: {}, key: 0 });
    clearCrowd(e);
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(e.crowdActors.size).toBe(0);
  });

  it("clearMotion kills cars/train/truck/garage/walkers and resets the arrays", () => {
    const e = eng();
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    const mk = () => {
      const a = actor();
      spies.push(vi.spyOn(a, "kill"));
      return a;
    };
    e.carActors = [{ actor: mk() }];
    e.trainActors = [{ actor: mk() }];
    e.tunnelActors = [mk()];
    e.truckActors = [{ actor: mk() }];
    e.garageCars = [{ actor: mk() }];
    e.walkers = [{ actor: mk() }];
    clearMotion(e);
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    expect(e.carActors).toEqual([]);
    expect(e.walkers).toEqual([]);
  });
});

describe("zoom cull skips the per-frame loops (CAP-1's cost mechanism)", () => {
  // The visibility flip alone is not the fix: the point of the cull is that
  // updateMotion/reconcileCrowd do NO per-actor work while culled. These pin
  // the early returns so a regression that kept the hiding but dropped the
  // skip would fail here, not just on a phone.
  it("updateMotion under the cull threshold flips the latch, hides the car, and never repositions it", () => {
    const car = {
      actor: actor(),
      t: { x: 12, kind: "elevatorStandard", carPositions: [8], carLoad: [0], carDir: [0] },
      i: 0, seed: 0, w: 4 * TILE, kind: "elevatorStandard",
      gfx: new Map<string, ex.Graphic>(), shown: "0:x:e",
    };
    const e = eng({ carActors: [car], cam: { zoom: 0.06 } });
    updateMotion(e);
    expect(e.crowdCulled).toBe(true);
    expect(car.actor.graphics.isVisible).toBe(false);
    expect(car.actor.pos.x).toBeCloseTo(0, 6); // untouched: the loop never ran
    expect(car.actor.pos.y).toBeCloseTo(0, 6);
  });

  it("reconcileCrowd under the cull threshold adds no actor for a live person", () => {
    const e = eng({
      cam: { zoom: 0.06 },
      sim: { ...eng().sim, crowd: { people: [{ id: 1, seed: 0, staff: false, state: "walking", x: 10, fy: 5, wait: 0 }] } },
    });
    frame(e);
    expect(e.crowdCulled).toBe(true);
    expect(e.crowdActors.size).toBe(0);
    expect(e.engine.add).not.toHaveBeenCalled();
  });

  it("on un-cull, a person who departed while culled is reaped hidden while a live one re-shows", () => {
    const live = { id: 1, seed: 0, staff: false, state: "walking", x: 10, fy: 5, wait: 0 };
    const gone = { id: 2, seed: 1, staff: false, state: "walking", x: 12, fy: 5, wait: 0 };
    const e = eng({ sim: { ...eng().sim, crowd: { people: [live, gone] } } });
    frame(e); // both drawn at a legible zoom
    const goneActor = e.crowdActors.get(2).actor;

    e.cam.zoom = 0.06;
    frame(e); // cull: both hidden, reaping suspended
    e.sim.crowd.people = [live]; // person 2 departs while culled
    expect(goneActor.graphics.isVisible).toBe(false);

    e.cam.zoom = 1;
    frame(e); // un-cull: the flip leaves people hidden for this pass
    // The stale actor was reaped without ever being made visible again, and
    // the live person came back through positionPerson in the same pass.
    expect(e.crowdActors.has(2)).toBe(false);
    expect(goneActor.graphics.isVisible).toBe(false);
    expect(e.crowdActors.get(1).actor.graphics.isVisible).toBe(true);
  });
});

describe("updateMotion repositions the moving actors", () => {
  it("moves each elevator car to its live shaft position and repaints on a state change", () => {
    const cap = kindFacts("elevatorStandard").carCapacity ?? 0;
    expect(cap, "a standard elevator car carries passengers").toBeGreaterThan(0);
    const changedInd = carIndicator(1, cap, cap, cabFit(4 * TILE), 0); // ascending & full: differs from idle
    const changedKey = carKey(changedInd);
    const car = {
      actor: actor(),
      t: { x: 12, kind: "elevatorStandard", carPositions: [8], carLoad: [cap], carDir: [1] },
      i: 0,
      seed: 0,
      w: 4 * TILE,
      kind: "elevatorStandard",
      // Pre-seed the cached graphic for the new state so carGfx never bakes a Canvas.
      gfx: new Map<string, ex.Graphic>([[changedKey, gfx()]]),
      shown: "0:x:e", // idle: forces the "state changed" repaint branch
    };
    const e = eng({ carActors: [car] });
    updateMotion(e, 1);
    // The riders change once the drawn car gets there, with the people
    // getting in and out (the step's glide ends, or the next step comes).
    expect(car.shown).toBe("0:x:e");
    updateMotion(e, MAX_STEP_MS);
    expect(car.actor.pos.x).toBeCloseTo(12 * TILE, 6);
    expect(car.actor.pos.y).toBeCloseTo(-8 * FLOOR, 6);
    expect(car.shown).toBe(changedKey); // adopted the new indicator state
  });

  it("runs the metro train on game time: in from the left, held, then off the right", () => {
    const xs: number[] = [];
    const train = { actor: actor(), u: { x: 20, floor: 3 }, w: 40, line: [0], stop: 0, shift: (offset: number) => xs.push(offset) };
    const clockAt = (minute: number, night = false) => ({ hour: Math.floor(minute / 60), minuteOfDay: minute, isMorning: () => false, isEvening: () => false, isNight: () => night });
    const e = eng({ trainActors: [train] });
    for (const minute of [12 * 60 + 3, 12 * 60 + 10, 12 * 60 + 23]) {
      e.sim = { ...e.sim, clock: clockAt(minute) };
      updateMotion(e);
    }
    // The three legs (arrive / hold / depart) put the train at distinct
    // offsets inside the station-wide canvas: off the left, in place, off the right.
    expect(xs[0]).toBeLessThan(0);
    expect(xs[1]).toBe(0);
    expect(xs[2]).toBeGreaterThan(0);
    // Overnight it stays inside the tunnel however the animation clock runs.
    e.sim = { ...e.sim, clock: clockAt(2 * 60 + 10, true) };
    e.d.anim = 7;
    updateMotion(e);
    expect(xs[3]).toBe(-(train.w + 12));
  });

  it("shows one train per line: only the station it is calling at has it", () => {
    const shifts: number[][] = [[], []];
    const station = (x: number, stop: number) => ({
      actor: actor(),
      u: { x, floor: -9 },
      w: 40,
      line: [100, 500],
      stop,
      shift: (offset: number) => shifts[stop].push(offset),
    });
    const e = eng({ trainActors: [station(100, 0), station(500, 1)] });
    const clockAt = (minute: number) => ({ hour: 12, minuteOfDay: 12 * 60 + minute, isMorning: () => false, isEvening: () => false, isNight: () => false });
    for (const minute of [10, 30]) {
      e.sim = { ...e.sim, clock: clockAt(minute) };
      updateMotion(e);
    }
    // At 12:10 the train stands in the west station, out of sight of the east
    // one; by 12:30 it has run on and stands in the east station.
    expect(shifts[0][0]).toBe(0);
    expect(Math.abs(shifts[1][0])).toBeGreaterThanOrEqual(52);
    expect(shifts[1][1]).toBe(0);
    expect(Math.abs(shifts[0][1])).toBeGreaterThanOrEqual(52);
  });

  it("shows the garbage truck only during the collection hour at a running plant", () => {
    const truck = { actor: actor(), u: { x: 30, floor: 1, width: 4, state: "occupied" }, w: 44 };
    const e = eng({ truckActors: [truck], sim: { ...eng().sim, clock: { hour: 5, minuteOfDay: 5 * 60 + 20, isMorning: () => false, isEvening: () => false, isNight: () => false } } });
    updateMotion(e);
    expect(truck.actor.graphics.isVisible).toBe(true);

    // Off-hour: hidden.
    const off = { actor: actor(), u: { x: 30, floor: 1, width: 4, state: "occupied" }, w: 44 };
    updateMotion(eng({ truckActors: [off] }));
    expect(off.actor.graphics.isVisible).toBe(false);

    // Collection hour but a gutted plant processes nothing: hidden.
    const dead = { actor: actor(), u: { x: 30, floor: 1, width: 4, state: "gutted" }, w: 44 };
    updateMotion(eng({ truckActors: [dead], sim: { ...eng().sim, clock: { hour: 5, minuteOfDay: 5 * 60 + 20, isMorning: () => false, isEvening: () => false, isNight: () => false } } }));
    expect(dead.actor.graphics.isVisible).toBe(false);
  });

  it("cruises garage cars only during a rush with cars parked", () => {
    const car = { actor: actor(), floor: -1, x0w: 100, x1w: 300, seed: 3 };
    const rush = eng({ garageCars: [car], displayParkingUse: 0.5, d: { anim: 2, stress: 0 }, sim: { ...eng().sim, clock: { hour: 8, minuteOfDay: 480, isMorning: () => true, isEvening: () => false, isNight: () => false } } });
    updateMotion(rush);
    expect(car.actor.graphics.isVisible).toBe(true);
    expect(car.actor.pos.x).toBeGreaterThanOrEqual(100);
    expect(car.actor.pos.x).toBeLessThanOrEqual(300);

    // No rush -> hidden.
    const idleCar = { actor: actor(), floor: -1, x0w: 100, x1w: 300, seed: 3 };
    updateMotion(eng({ garageCars: [idleCar], displayParkingUse: 0.5 }));
    expect(idleCar.actor.graphics.isVisible).toBe(false);
  });
});
