import { describe, it, expect } from "vitest";
import { Tower } from "../../engine/Tower";
import { Crowd } from "../../engine/Crowd";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { finish } from "../../engine/crowd/motion";
import { updateSatisfaction } from "../../engine/sim/satisfaction";
import type { Person } from "../../engine/crowd/person";

/**
 * Per-origin commute-stress accumulator (#514): a READ-ONLY measurement of each
 * tenant trip's whole-journey landing wait, rolled up by origin floor. It feeds
 * no behavior (that is the owner-gated #502 track) and is not persisted. These
 * tests pin the fold math, the staff exclusion, determinism, the read-only seam
 * into satisfaction, and the not-persisted guarantee.
 */
describe("commute-stress accumulator (#514)", () => {
  /** A minimal finished tenant trip: origin floor = floors[0]. */
  function trip(overrides: Partial<Person>): Person {
    return {
      id: 1,
      seed: 1,
      state: "toDest",
      floor: 7,
      fy: 7,
      x: 10,
      floors: [3, 7],
      originFloor: 3,
      shafts: [],
      leg: 0,
      shaftId: null,
      carIndex: null,
      destX: 10,
      wait: 0,
      tripWait: 0,
      age: 0,
      linger: 0,
      ...overrides,
    };
  }

  it("reports 0 for a floor with no finished trips, and reads back a recorded value", () => {
    const crowd = new Crowd(1);
    expect(crowd.commuteStressAt(4)).toBe(0);
    crowd.recordCommute(4, 40);
    // The first sample seeds the EMA to the actual value (not a lerp from 0).
    expect(crowd.commuteStressAt(4)).toBe(40);
  });

  it("folds a finished tenant trip's whole-journey wait onto the origin floor", () => {
    const crowd = new Crowd(1);
    const tower = new Tower();
    // tripWait carries the sum of every leg's wait (banked at each boarding).
    finish(crowd, trip({ originFloor: 3, floors: [3, 7], tripWait: 65, wait: 0 }), tower);
    expect(crowd.commuteStressAt(3)).toBe(65);
    // Nothing leaks onto the destination floor.
    expect(crowd.commuteStressAt(7)).toBe(0);
  });

  it("keys on the immutable origin floor, not the rewritten return-leg floors[0]", () => {
    // A meal round-tripper on the return leg: transitionToReturn has rewritten
    // floors[0] to the venue (3), but the tenant's home is 50. The fold must
    // land on the home origin, not the venue the return leg starts from.
    const crowd = new Crowd(1);
    const tower = new Tower();
    finish(crowd, trip({ originFloor: 50, floors: [3, 50], tripWait: 80, wait: 0 }), tower);
    expect(crowd.commuteStressAt(50)).toBe(80); // tenant's true origin
    expect(crowd.commuteStressAt(3)).toBe(0); // venue floor untouched
  });

  it("counts a give-up-while-queued residual (tripWait + trailing wait)", () => {
    const crowd = new Crowd(1);
    const tower = new Tower();
    finish(crowd, trip({ originFloor: 2, floors: [2, 9], tripWait: 10, wait: 50 }), tower);
    expect(crowd.commuteStressAt(2)).toBe(60);
  });

  it("excludes staff (they never count toward tenant stress)", () => {
    const crowd = new Crowd(1);
    const tower = new Tower();
    finish(crowd, trip({ originFloor: 5, floors: [5, 1], tripWait: 99, wait: 0, staff: true }), tower);
    expect(crowd.commuteStressAt(5)).toBe(0);
    expect([...crowd.commuteStressByFloor.keys()]).toHaveLength(0);
  });

  it("exposes the accumulator on the engine-owned crowd", () => {
    const sim = Simulation.newGame(1);
    sim.crowd.recordCommute(6, 33);
    expect(sim.crowd.commuteStressAt(6)).toBe(33);
  });

  /** A small tower that spawns real morning commuters through one elevator.
   *  The lobby/floor fill deliberately overlaps the pre-seeded center lobby so
   *  the strip connects, so those placements legitimately report `.ok === false`
   *  on the already-occupied tiles and are not asserted. The load-bearing
   *  placements whose silent failure WOULD degrade the scenario (the occupied
   *  office and the elevator that carries the commuters) are asserted `.ok`
   *  (AGENTS.md fixture rule); their success also confirms the structure fill
   *  connected, since neither can place without it. */
  function commuterTower(seed: number): Simulation {
    const sim = Simulation.newGame(seed);
    sim.money = 1_000_000_000;
    const c = Math.floor(GRID.width / 2) - 15;
    for (let x = c; x < c + 30; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 6; f++) for (let x = c; x < c + 30; x++) sim.tower.place("floor", f, x);
    const r = sim.tower.place("office", 5, c);
    expect(r.ok).toBe(true);
    const u = sim.tower.units.find((uu) => uu.id === r.unitId)!;
    u.state = "occupied";
    u.everOccupied = true;
    expect(sim.tower.placeTransport("elevatorStandard", c + 20, 1, 6).ok).toBe(true);
    return sim;
  }

  it("is deterministic: same seed produces an identical per-floor snapshot", () => {
    const snap = (sim: Simulation) =>
      [...sim.crowd.commuteStressByFloor.entries()].sort((a, b) => a[0] - b[0]);
    const a = commuterTower(1);
    const b = commuterTower(1);
    for (let i = 0; i < 200; i++) {
      a.tick(1);
      b.tick(1);
    }
    // A run that spawns commuters populates the accumulator...
    expect(snap(a).length).toBeGreaterThan(0);
    // ...and two runs from the same seed agree exactly (no rng, no wall clock).
    expect(snap(a)).toEqual(snap(b));
  });

  it("is read-only: seeding commute stress does not change satisfaction (congestion drives it)", () => {
    // Two identical towers; in one, inflate every occupied unit's origin-floor
    // commute stress to a huge value before running the satisfaction pass. If
    // the accumulator fed satisfaction, the seeded run would erode differently.
    const control = commuterTower(2);
    const seeded = commuterTower(2);
    for (const u of seeded.tower.units) {
      if (u.state === "occupied") seeded.crowd.recordCommute(u.floor, 10_000);
    }
    updateSatisfaction(control);
    updateSatisfaction(seeded);
    const sat = (sim: Simulation) =>
      sim.tower.units
        .filter((u) => u.state === "occupied")
        .map((u) => [u.id, u.satisfaction] as const)
        .sort((a, b) => a[0] - b[0]);
    expect(sat(seeded)).toEqual(sat(control));
  });

  it("is not persisted: a save round-trip drops the accumulator (it rebuilds live)", () => {
    const sim = commuterTower(3);
    for (let i = 0; i < 200; i++) sim.tick(1);
    expect(sim.crowd.commuteStressByFloor.size).toBeGreaterThan(0);
    const reloaded = Simulation.deserialize(sim.serialize());
    // Not in the save format: the reloaded crowd starts empty and rebuilds as
    // it runs, exactly like crowd.frustration.
    expect(reloaded.crowd.commuteStressByFloor.size).toBe(0);
  });
});
