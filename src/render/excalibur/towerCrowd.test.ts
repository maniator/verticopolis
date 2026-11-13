import { describe, it, expect, vi } from "vitest";
import { kindFacts } from "../../tests/catalogKinds";
import * as ex from "excalibur";
import { FLOOR, TILE } from "../scale";
import { carIndicator, type CarIndicator } from "../carIndicator";
import { reap, reconcileCrowd, clearCrowd, clearMotion, updateMotion } from "./towerCrowd";

/**
 * Engine-driven crowd and motion for the tower renderer. The parts that BAKE
 * cab/train/walker graphics (syncMotion, buildWalkers) allocate `ex.Canvas`,
 * which needs a real 2D context and can't run under happy-dom; those stay on
 * the Playwright tier. Everything that repositions or reconciles pre-built
 * actors IS unit-testable with real (drawing-free) `ex.Actor`s and fake
 * graphics: this drives the crowd reconciler, the clear paths, the pure `reap`
 * tail, and updateMotion across cars, the metro train, the garbage truck,
 * garage cars and the decorative passers-by, asserting positions/visibility, not just
 * no-throw.
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
    population: 400,
    crowd: { people: [] },
    clock: { hour: 12, minuteOfDay: 12 * 60, isMorning: () => false, isEvening: () => false, isNight: () => false },
    tower: { revision: 1, units: [] },
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
    personGfx: [gfx(), gfx(), gfx()],
    personGfxStaff: gfx(),
    personGfxRed: gfx(),
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
    expect(e.crowdActors.get(1).actor.graphics.isVisible).toBe(false);
    expect(e.crowdActors.get(2).actor.graphics.isVisible).toBe(true);
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
    reconcileCrowd(e);
    expect(e.crowdCulled).toBe(true);
    expect(e.crowdActors.size).toBe(0);
    expect(e.engine.add).not.toHaveBeenCalled();
  });

  it("on un-cull, a person who departed while culled is reaped hidden while a live one re-shows", () => {
    const live = { id: 1, seed: 0, staff: false, state: "walking", x: 10, fy: 5, wait: 0 };
    const gone = { id: 2, seed: 1, staff: false, state: "walking", x: 12, fy: 5, wait: 0 };
    const e = eng({ sim: { ...eng().sim, crowd: { people: [live, gone] } } });
    reconcileCrowd(e); // both drawn at a legible zoom
    const goneActor = e.crowdActors.get(2).actor;

    e.cam.zoom = 0.06;
    reconcileCrowd(e); // cull: both hidden, reaping suspended
    e.sim.crowd.people = [live]; // person 2 departs while culled
    expect(goneActor.graphics.isVisible).toBe(false);

    e.cam.zoom = 1;
    reconcileCrowd(e); // un-cull: the flip leaves people hidden for this pass
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

  it("runs the metro train on game time: in from the left, held, then off the right", () => {
    const xs: number[] = [];
    const train = { actor: actor(), u: { x: 20, floor: 3 }, w: 40, shift: (offset: number) => xs.push(offset) };
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

describe("decorative passers-by (#2091)", () => {
  const mkWalker = (over: Record<string, unknown> = {}) =>
    ({
      actor: actor(), gfx: gfx(), x0w: 100, x1w: 200, yw: -100,
      speed: 8, dir: 1, phase: 0.2, rank: 0.5,
      floor: 7, ...over,
    }) as any;
  /** Floor 7 holds 16 occupants (fully lively); floor 9 holds 4 (a quarter). */
  const lively = () => simFixture({ tower: { revision: 1, units: [{ floor: 7, occupants: 16 }, { floor: 9, occupants: 4 }] } });

  it("shows a figure only while its own floor has enough live occupants", () => {
    const busy = mkWalker();
    const quiet = mkWalker({ floor: 9 }); // rank 0.5 above floor 9's 0.25
    const firstOnQuiet = mkWalker({ floor: 9, rank: 0.2 });
    const empty = mkWalker({ floor: 12, rank: 0.01 });
    const e = eng({ walkers: [busy, quiet, firstOnQuiet, empty], d: { anim: 3, stress: 0 }, sim: lively() });
    updateMotion(e);
    expect([busy, quiet, firstOnQuiet, empty].map((w) => w.actor.graphics.isVisible)).toEqual([true, false, true, false]);
    expect(e.floorLive.get(7)).toBeCloseTo(1, 6);
    expect(e.floorLive.get(9)).toBeCloseTo(0.25, 6);
  });

  it("paces back and forth inside its span, on its own floor line", () => {
    const w = mkWalker();
    const e = eng({ walkers: [w], sim: lively() });
    const xs: number[] = [];
    for (let i = 0; i < 40; i++) {
      e.d.anim = i * 0.37;
      updateMotion(e);
      xs.push(w.actor.pos.x);
      expect(w.actor.pos.y).toBe(-100);
    }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...xs)).toBeLessThanOrEqual(200);
    expect(new Set(xs.map((x) => Math.round(x))).size).toBeGreaterThan(5);
  });

  it("hides every figure when the Settings switch is off", () => {
    const w = mkWalker();
    const e = eng({ walkers: [w], passersBy: false, sim: lively() });
    updateMotion(e);
    expect(w.actor.graphics.isVisible).toBe(false);
    e.passersBy = true;
    updateMotion(e);
    expect(w.actor.graphics.isVisible).toBe(true);
  });

  it("hides every figure under reduced motion", () => {
    const w = mkWalker();
    const e = eng({ walkers: [w], reducedMotion: true, sim: lively() });
    updateMotion(e);
    expect(w.actor.graphics.isVisible).toBe(false);
  });

  it("never turns a passer-by red, however stressed the tower is", () => {
    // A mood color tells the player a real person has waited too long; a
    // passer-by has no wait, so it keeps its own figure.
    const w = mkWalker();
    const used = vi.spyOn(w.actor.graphics, "use");
    const e = eng({ walkers: [w], d: { anim: 1, stress: 1 }, sim: lively() });
    updateMotion(e);
    expect(w.actor.graphics.isVisible).toBe(true);
    expect(used).not.toHaveBeenCalled();
  });
});
