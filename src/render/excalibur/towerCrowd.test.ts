import { describe, it, expect, vi } from "vitest";
import * as ex from "excalibur";
import { FLOOR, TILE } from "../scale";
import { carIndicator, type CarIndicator } from "../carIndicator";
import { transportCarCapacity } from "../../engine/facilities";
import { reap, reconcileCrowd, clearCrowd, clearMotion, updateMotion } from "./towerCrowd";

/**
 * Engine-driven crowd and motion for the tower renderer. The parts that BAKE
 * cab/train/walker graphics (syncMotion, buildWalkers) allocate `ex.Canvas`,
 * which needs a real 2D context and can't run under happy-dom; those stay on
 * the Playwright tier. Everything that repositions or reconciles pre-built
 * actors IS unit-testable with real (drawing-free) `ex.Actor`s and fake
 * graphics: this drives the crowd reconciler, the clear paths, the pure `reap`
 * tail, and updateMotion across cars, the metro train, the garbage truck,
 * garage cars and the ambient walkers, asserting positions/visibility, not just
 * no-throw.
 */

const gfx = () => ({ width: 9, height: 25 }) as ex.Graphic;
const actor = () => new ex.Actor({ pos: ex.vec(0, 0), width: 8, height: 14 });
const carKey = (ind: CarIndicator) => `${ind.riders}:${ind.arrow ?? "x"}:${ind.full ? "f" : "e"}`;

/** A fake engine carrying the fields the motion/crowd functions read, plus the
 *  two pure world-coordinate helpers the class exposes. */

function eng(over: Record<string, any> = {}): any {

  const e: any = {
    engine: { add: vi.fn() },
    d: { anim: 0, stress: 0 },
    crowdActors: new Map(),
    carActors: [],
    trainActors: [],
    truckActors: [],
    garageCars: [],
    walkers: [],
    floorLive: new Map(),
    floorLiveHour: -1,
    floorLiveRev: -1,
    displayParkingUse: 0,
    personGfx: [gfx(), gfx(), gfx()],
    personGfxStaff: gfx(),
    personGfxRed: gfx(),
    worldX: (tile: number) => tile * TILE,
    worldYTop: (floor: number, h = 1) => -(floor + h - 1) * FLOOR,
    sim: {
      population: 400,
      crowd: { people: [] },
      clock: { hour: 12, minuteOfDay: 12 * 60, isMorning: () => false, isEvening: () => false, isNight: () => false },
      tower: { revision: 1, units: [] },
    },
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
    const e = eng({ sim: { ...eng().sim, crowd: { people: [{ id: 1, seed: 0, staff: false, state: "walking", x: 10, fy: 5, wait: 0 }] } } });
    reconcileCrowd(e);
    expect(e.crowdActors.size).toBe(1);
    expect(e.engine.add).toHaveBeenCalledTimes(1);
    const rec = e.crowdActors.get(1);
    expect(rec.actor.pos.x).toBeCloseTo(10 * TILE, 6);
    // Regression guard on the figure footprint: the crowd actor adopts the
    // baked canvas dimensions (9x25 for the finalized walker), so it can never
    // drift back to the legacy 8x14 miniature or desync from the sprite.
    expect(rec.actor.width).toBeCloseTo(rec.gfx.width, 6);
    expect(rec.actor.height).toBeCloseTo(rec.gfx.height, 6);
    expect(rec.gfx.width).toBeCloseTo(9, 6);
    expect(rec.gfx.height).toBeCloseTo(25, 6);

    // Next pass: the person is gone, so its actor is reaped.
    e.sim.crowd.people = [];
    reconcileCrowd(e);
    expect(e.crowdActors.size).toBe(0);
  });

  it("hides a riding tenant but keeps riding staff visible", () => {
    const e = eng({
      sim: { ...eng().sim, crowd: { people: [
        { id: 1, seed: 0, staff: false, state: "riding", x: 10, fy: 5, wait: 0 },
        { id: 2, seed: 1, staff: true, state: "riding", x: 12, fy: 6, wait: 0 },
      ] } },
    });
    reconcileCrowd(e);
    expect(e.crowdActors.get(1).actor.graphics.visible).toBe(false);
    expect(e.crowdActors.get(2).actor.graphics.visible).toBe(true);
  });

  it("reddens a long-waiting tenant", () => {
    const e = eng({ sim: { ...eng().sim, crowd: { people: [{ id: 1, seed: 0, staff: false, state: "walking", x: 10, fy: 5, wait: 30 }] } } });
    reconcileCrowd(e);
    expect(e.crowdActors.get(1).red).toBe(true);
  });
});

describe("clear paths kill every actor they own", () => {
  it("clearCrowd kills the crowd actors and empties the map", () => {
    const e = eng();
    const a = actor();
    const killSpy = vi.spyOn(a, "kill");
    e.crowdActors.set(1, { actor: a, gfx: gfx(), red: false });
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
    e.truckActors = [{ actor: mk() }];
    e.garageCars = [{ actor: mk() }];
    e.walkers = [{ actor: mk() }];
    clearMotion(e);
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    expect(e.carActors).toEqual([]);
    expect(e.walkers).toEqual([]);
  });
});

describe("updateMotion repositions the moving actors", () => {
  it("moves each elevator car to its live shaft position and repaints on a state change", () => {
    const cap = transportCarCapacity("elevatorStandard");
    const changedInd = carIndicator(1, cap, cap); // ascending & full: differs from idle
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
    updateMotion(e);
    expect(car.actor.pos.x).toBeCloseTo(12 * TILE, 6);
    expect(car.actor.pos.y).toBeCloseTo(-8 * FLOOR, 6);
    expect(car.shown).toBe(changedKey); // adopted the new indicator state
  });

  it("cycles the metro train in from the left, holds, then off the right", () => {
    const train = { actor: actor(), u: { x: 20, floor: 3 }, w: 40 };
    const e = eng({ trainActors: [train] });
    const xs: number[] = [];
    for (const anim of [0, 6, 11]) {
      e.d.anim = anim;
      updateMotion(e);
      xs.push(train.actor.pos.x);
    }
    // The three legs (arrive / hold / depart) put the train at distinct x's.
    expect(new Set(xs).size).toBe(3);
  });

  it("shows the garbage truck only during the collection hour at a running plant", () => {
    const truck = { actor: actor(), u: { x: 30, floor: 1, width: 4, state: "occupied" }, w: 44 };
    const e = eng({ truckActors: [truck], sim: { ...eng().sim, clock: { hour: 5, minuteOfDay: 5 * 60 + 20, isMorning: () => false, isEvening: () => false, isNight: () => false } } });
    updateMotion(e);
    expect(truck.actor.graphics.visible).toBe(true);

    // Off-hour: hidden.
    const off = { actor: actor(), u: { x: 30, floor: 1, width: 4, state: "occupied" }, w: 44 };
    updateMotion(eng({ truckActors: [off] }));
    expect(off.actor.graphics.visible).toBe(false);

    // Collection hour but a gutted plant processes nothing: hidden.
    const dead = { actor: actor(), u: { x: 30, floor: 1, width: 4, state: "gutted" }, w: 44 };
    updateMotion(eng({ truckActors: [dead], sim: { ...eng().sim, clock: { hour: 5, minuteOfDay: 5 * 60 + 20, isMorning: () => false, isEvening: () => false, isNight: () => false } } }));
    expect(dead.actor.graphics.visible).toBe(false);
  });

  it("cruises garage cars only during a rush with cars parked", () => {
    const car = { actor: actor(), floor: -1, x0w: 100, x1w: 300, seed: 3 };
    const rush = eng({ garageCars: [car], displayParkingUse: 0.5, d: { anim: 2, stress: 0 }, sim: { ...eng().sim, clock: { hour: 8, minuteOfDay: 480, isMorning: () => true, isEvening: () => false, isNight: () => false } } });
    updateMotion(rush);
    expect(car.actor.graphics.visible).toBe(true);
    expect(car.actor.pos.x).toBeGreaterThanOrEqual(100);
    expect(car.actor.pos.x).toBeLessThanOrEqual(300);

    // No rush -> hidden.
    const idleCar = { actor: actor(), floor: -1, x0w: 100, x1w: 300, seed: 3 };
    updateMotion(eng({ garageCars: [idleCar], displayParkingUse: 0.5 }));
    expect(idleCar.actor.graphics.visible).toBe(false);
  });

  it("gates ambient walkers on busyness and reddens impatient ones under stress", () => {
    const mkWalker = (over: Record<string, unknown>) => ({
      actor: actor(), gfx: gfx(), x0w: 100, x1w: 200, y0w: -100, y1w: -100,
      speed: 8, dir: 1, phase: 0.2, impatient: true, red: false, rank: 0.1, floor: 4, perFloor: false, ...over,
    });
    const lobbyWalker = mkWalker({});
    const hiddenWalker = mkWalker({ rank: 5 }); // rank above any threshold -> hidden
    const floorWalker = mkWalker({ perFloor: true, floor: 7, rank: 0.5 });
    const e = eng({
      walkers: [lobbyWalker, hiddenWalker, floorWalker],
      d: { anim: 3, stress: 1 }, // high stress reddens impatient figures
      sim: {
        population: 400,
        crowd: { people: [] },
        clock: { hour: 12, minuteOfDay: 720, isMorning: () => false, isEvening: () => false, isNight: () => false },
        tower: { revision: 1, units: [{ floor: 7, occupants: 16 }] }, // fills floorLive for floor 7
      },
    });
    updateMotion(e);
    expect(lobbyWalker.actor.graphics.visible).toBe(true);
    expect(lobbyWalker.red).toBe(true);
    expect(hiddenWalker.actor.graphics.visible).toBe(false);
    expect(floorWalker.actor.graphics.visible).toBe(true); // its floor is lively
    // The per-floor occupancy cache was populated for the busy floor.
    expect(e.floorLive.get(7)).toBeCloseTo(1, 6);
  });
});
