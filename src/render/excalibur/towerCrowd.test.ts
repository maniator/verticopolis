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
// Match the walker bake footprint (9x25) the production actors adopt from their
// canvas, so fixtures never encode the legacy 8x14 size.
const actor = () => new ex.Actor({ pos: ex.vec(0, 0), width: 9, height: 25 });
const carKey = (ind: CarIndicator) => `${ind.riders}:${ind.arrow ?? "x"}:${ind.full ? "f" : "e"}`;

/** A fake engine carrying the fields the motion/crowd functions read, plus the
 *  two pure world-coordinate helpers the class exposes. */

/** The fake `sim` the render helpers read, with `over` merged on top. Tests that
 *  need their own units or clock go through this instead of writing a whole `sim`
 *  literal, so a new engine call read by the render layer (`positionReachable`, say)
 *  only has to be defaulted in one place. */
function simFixture(over: Record<string, any> = {}): any {
  return {
    population: 400,
    crowd: { people: [] },
    clock: { hour: 12, minuteOfDay: 12 * 60, isMorning: () => false, isEvening: () => false, isNight: () => false },
    tower: { revision: 1, units: [] },
    // Everything is reachable unless a test says otherwise, so the cases that
    // are not about reachability keep asserting exactly what they always did.
    positionReachable: () => true,
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
    expect(car.actor.graphics.visible).toBe(false);
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
    expect(goneActor.graphics.visible).toBe(false);

    e.cam.zoom = 1;
    reconcileCrowd(e); // un-cull: the flip leaves people hidden for this pass
    // The stale actor was reaped without ever being made visible again, and
    // the live person came back through positionPerson in the same pass.
    expect(e.crowdActors.has(2)).toBe(false);
    expect(goneActor.graphics.visible).toBe(false);
    expect(e.crowdActors.get(1).actor.graphics.visible).toBe(true);
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
    const mkWalker = (over: Record<string, unknown>) => {
      // `...over` lands last, so a hardcoded altFloor here would survive a
      // `floor` override and quietly probe the wrong storey. Follow the primary
      // spot unless a case says otherwise, the same way production builds every
      // figure that is not a climber.
      const w: Record<string, unknown> = {
        actor: actor(), gfx: gfx(), x0w: 100, x1w: 200, y0w: -100, y1w: -100,
        speed: 8, dir: 1, phase: 0.2, impatient: true, red: false, rank: 0.1,
        floor: 4, tileX: 0, perFloor: false, ...over,
      };
      w.altFloor ??= w.floor;
      w.altTileX ??= w.tileX;
      return w as any;
    };
    const lobbyWalker = mkWalker({});
    const hiddenWalker = mkWalker({ rank: 5 }); // rank above any threshold -> hidden
    const floorWalker = mkWalker({ perFloor: true, floor: 7, rank: 0.5 });
    const e = eng({
      walkers: [lobbyWalker, hiddenWalker, floorWalker],
      d: { anim: 3, stress: 1 }, // high stress reddens impatient figures
      sim: simFixture({
        tower: { revision: 1, units: [{ floor: 7, occupants: 16 }] }, // fills floorLive for floor 7
      }),
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

describe("ambient walkers are gated on reachability (#639)", () => {
  // The bug: a sky lobby nobody can get to still filled with ambient walkers,
  // because lobby and stair figures gate only on tower-wide busyness. These run
  // at population 400, so `crowd` saturates at 1 and busyness alone would show
  // every one of them; reachability is the only thing that can hide them.
  /** A walker whose second endpoint defaults to its first, the way production
   *  builds every non-climber. A climber test sets `altFloor`/`altTileX`
   *  explicitly; leaving them to follow `floor`/`tileX` here is what keeps the
   *  single-spot cases honest (a stale default of floor 1 would make every
   *  walker reachable through the always-reachable ground floor). */
  const mkWalker = (over: Record<string, unknown> = {}) => {
    const w: Record<string, unknown> = {
      actor: actor(), gfx: gfx(), x0w: 100, x1w: 200, y0w: -100, y1w: -100,
      speed: 8, dir: 1, phase: 0.2, impatient: false, red: false, rank: 0.1,
      floor: 1, tileX: 0, perFloor: false, ...over,
    };
    w.altFloor ??= w.floor;
    w.altTileX ??= w.tileX;
    return w as any;
  };

  it("hides an unreachable sky lobby's walkers and its stair climbers, keeping floor 1", () => {
    const mainLobby = mkWalker({ floor: 1 });
    const skyLobby = mkWalker({ floor: 15 });
    const climber = mkWalker({ floor: 16, altFloor: 17, rank: 0.04 }); // a real 16-to-17 flight
    const e = eng({
      walkers: [mainLobby, skyLobby, climber],
      sim: simFixture({ positionReachable: (f: number) => f === 1 }),
    });
    updateMotion(e);
    expect(mainLobby.actor.graphics.visible).toBe(true);
    expect(skyLobby.actor.graphics.visible).toBe(false);
    // Climbers carry perFloor: false too, so they are the same bug class: a
    // stair to nowhere must not show anyone walking up it.
    expect(climber.actor.graphics.visible).toBe(false);
  });

  it("shows the sky lobby once it becomes reachable, per floor not globally", () => {
    // The acceptance from the issue: "add an elevator to it and walkers appear."
    const skyLobby = mkWalker({ floor: 15 });
    const climber = mkWalker({ floor: 16, altFloor: 17, rank: 0.04 });
    const e = eng({
      walkers: [skyLobby, climber],
      sim: simFixture({ positionReachable: (f: number) => f === 1 || f === 15 }),
    });
    updateMotion(e);
    expect(skyLobby.actor.graphics.visible).toBe(true);
    // Floor 16 is still cut off, so the gate is per floor and not a global flag.
    expect(climber.actor.graphics.visible).toBe(false);
  });

  it("hides only the stranded run of a gap-split floor (#647 segments)", () => {
    // The case a floor-level probe gets wrong. After #647 the routing node is a
    // contiguous SEGMENT, so a Modern floor built with a gap can have one wing
    // routing to the lobby and the other stranded. Ambient figures are spawned
    // per run, so the two wings must gate independently even though they share
    // a floor number.
    const westWing = mkWalker({ floor: 15, tileX: 2 });
    const strandedEast = mkWalker({ floor: 15, tileX: 40 });
    const e = eng({
      walkers: [westWing, strandedEast],
      sim: simFixture({ positionReachable: (f: number, x: number) => f === 1 || (f === 15 && x < 10) }),
    });
    updateMotion(e);
    expect(westWing.actor.graphics.visible).toBe(true);
    expect(strandedEast.actor.graphics.visible).toBe(false);
  });

  it("hides a climber whose flight is cut off at the top (#665)", () => {
    // The gate used to ask only about a flight's bottom landing, so a stair from
    // a reachable floor to one nobody can get to still showed figures trudging
    // up toward it. Classic's walk budget is what makes the two ends disagree:
    // the probe routes THROUGH stairs, so a reachable bottom otherwise implies a
    // reachable top.
    const cutOffAbove = mkWalker({ floor: 5, tileX: 3, altFloor: 6, altTileX: 3, rank: 0.04 });
    const usable = mkWalker({ floor: 4, tileX: 3, altFloor: 5, altTileX: 3, rank: 0.04 });
    const e = eng({
      walkers: [cutOffAbove, usable],
      sim: simFixture({ positionReachable: (f: number) => f <= 5 }),
    });
    updateMotion(e);
    expect(cutOffAbove.actor.graphics.visible).toBe(false);
    // A flight with both landings reachable still carries its climbers.
    expect(usable.actor.graphics.visible).toBe(true);
  });

  it("hides a climber whose flight is cut off at the bottom", () => {
    // The mirror case. This one does NOT pin AND against the old bottom-only
    // gate (that gate hid this too, for its own reason); what it pins is AND
    // against an either-endpoint OR, which would call this flight reachable
    // through its top and put the climbers back. That is worth a test because
    // OR is the plausible misreading: the deferral that raised #665 described
    // the fix that way before the direction was worked through.
    const cutOffBelow = mkWalker({ floor: 5, tileX: 3, altFloor: 6, altTileX: 3, rank: 0.04 });
    const e = eng({
      walkers: [cutOffBelow],
      sim: simFixture({ positionReachable: (f: number) => f >= 6 }),
    });
    updateMotion(e);
    expect(cutOffBelow.actor.graphics.visible).toBe(false);
  });

  it("asks the engine once per position per revision, and re-asks after a layout change", () => {
    // `positionReachable` runs a fresh passenger BFS per call once a floor is
    // split, so the per-frame loop must not call it per walker per frame.
    const calls: Array<[number, number]> = [];
    const probe = (f: number, x: number) => (calls.push([f, x]), f !== 15);
    const e = eng({
      // Two walkers share a position; a third sits elsewhere on the same floor.
      walkers: [mkWalker({ floor: 15, tileX: 2 }), mkWalker({ floor: 15, tileX: 2 }), mkWalker({ floor: 15, tileX: 40 })],
      sim: simFixture({ positionReachable: probe }),
    });
    updateMotion(e);
    updateMotion(e);
    expect(calls).toEqual([[15, 2], [15, 40]]); // deduped, and not re-asked next frame

    // A transport add/remove bumps the revision, which is exactly when
    // reachability can change, so the verdicts must be re-asked.
    calls.length = 0;
    e.sim.tower.revision = 2;
    updateMotion(e);
    expect(calls).toEqual([[15, 2], [15, 40]]);
  });

  it("leaves corridor loiterers on their existing occupancy gate", () => {
    // perFloor walkers already gate on floorLive, and a floor with live
    // occupants is reachable by definition, so they must not pay a second gate.
    const loiterer = mkWalker({ perFloor: true, floor: 7, rank: 0.5 });
    const e = eng({
      walkers: [loiterer],
      sim: simFixture({
        positionReachable: () => false, // would hide it if the gate applied
        tower: { revision: 1, units: [{ floor: 7, occupants: 16 }] },
      }),
    });
    updateMotion(e);
    expect(loiterer.actor.graphics.visible).toBe(true);
  });

  it("still hides a reachable walker whose rank is above the busyness threshold", () => {
    // Reachability is an AND with busyness, never a bypass of it.
    const rankedOut = mkWalker({ floor: 15, rank: 5 });
    const e = eng({ walkers: [rankedOut], sim: simFixture() });
    updateMotion(e);
    expect(rankedOut.actor.graphics.visible).toBe(false);
  });
});
