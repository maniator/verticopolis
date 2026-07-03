import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { FACILITIES, GARBAGE_COLLECT_HOUR, GRID, PARKING_WORKERS_PER_SPACE, RECYCLING_POP_PER_CENTER } from "../engine/facilities";
import type { FacilityKind, Unit, UnitState } from "../engine/types";

/** Canon waste & parking demand mechanics: the recycling centers FILL with the
 * tower's daily garbage (emptied by the morning truck), demand scales with
 * population and gates 4★, and parking serves offices (1/~12 workers) plus one
 * space per hotel suite. */

const W = GRID.width;
const C = Math.floor(W / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** Place a unit at a fixed spot that MUST succeed, assert it did, put it in
 *  `state`, and return it — so a future placement-rule change fails loudly here
 *  instead of at a later null deref. (Loops that fill a floor until it runs out
 *  of width keep their own `if (r.ok)` guard — failure is expected there.) */
function occupy(sim: Simulation, kind: FacilityKind, floor: number, x: number, state: UnitState): Unit {
  const r = sim.tower.place(kind, floor, x);
  expect(r.ok).toBe(true);
  const u = sim.tower.units.find((uu) => uu.id === r.unitId);
  expect(u).toBeDefined();
  u!.state = state;
  return u!;
}

/** Place a unit at a fixed spot the test's assertions depend on and assert it
 *  succeeded — so a future placement-rule change fails at the placement site,
 *  not in a later capacity/demand expectation. */
function mustPlace(sim: Simulation, kind: FacilityKind, floor: number, x: number): void {
  expect(sim.tower.place(kind, floor, x).ok).toBe(true);
}

/** A tower with `offices` occupied offices and a recycling basement row. */
function officeTower(offices: number, centers: number): Simulation {
  const sim = Simulation.newGame(11);
  sim.money = 1e12;
  lay(sim, "lobby", 1);
  let placed = 0;
  for (let f = 2; placed < offices; f++) {
    lay(sim, "floor", f);
    for (let x = 0; x + 9 <= W && placed < offices; x += 9) {
      const r = sim.tower.place("office", f, x);
      if (r.ok) {
        sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
        placed++;
      }
    }
  }
  lay(sim, "floor", 0);
  lay(sim, "floor", -1);
  for (let i = 0; i < centers; i++) mustPlace(sim, "recycling", -1, i * 20);
  return sim;
}

describe("Recycling fills with population and gates 4★ by DEMAND", () => {
  it("capacity scales per center; demand met flips exactly at the threshold", () => {
    // 500 offices × 6 = 3,000 population: one center (2,500) is not enough,
    // two (5,000) are.
    const sim = officeTower(500, 1);
    expect(sim.tower.totalPopulation()).toBe(3000);
    expect(sim.recyclingCapacity()).toBe(RECYCLING_POP_PER_CENTER);
    expect(sim.recyclingDemandMet()).toBe(false);
    mustPlace(sim, "recycling", -1, 40);
    expect(sim.recyclingCapacity()).toBe(2 * RECYCLING_POP_PER_CENTER);
    expect(sim.recyclingDemandMet()).toBe(true);
  });

  it("fill is empty right after the truck, grows through the day, and caps at 100% when over capacity", () => {
    const sim = officeTower(500, 1); // 3,000 pop vs 2,500 capacity → overflows
    // Park the clock exactly at collection time.
    sim.clock.minutes = 10 * 1440 + GARBAGE_COLLECT_HOUR * 60;
    expect(sim.recyclingFill()).toBe(0);
    sim.clock.advance(6 * 60); // six hours of garbage
    const noon = sim.recyclingFill();
    expect(noon).toBeGreaterThan(0.2);
    expect(noon).toBeLessThan(0.5);
    sim.clock.advance(17 * 60); // just before the next collection — over capacity → pegged full
    expect(sim.recyclingFill()).toBe(1);
  });

  it("an under-capacity tower never fills its centers", () => {
    const sim = officeTower(100, 1); // 600 pop vs 2,500 capacity
    sim.clock.minutes = 10 * 1440 + GARBAGE_COLLECT_HOUR * 60 - 1; // worst minute of the day
    expect(sim.recyclingFill()).toBeLessThan(0.3);
  });

  it("a center under construction or on fire processes nothing", () => {
    const sim = officeTower(100, 1);
    const rec = sim.tower.units.find((u) => u.kind === "recycling")!;
    rec.state = "fire";
    expect(sim.recyclingCapacity()).toBe(0);
    expect(sim.recyclingDemandMet()).toBe(false);
  });
});

describe("Parking demand: offices (1/~12 workers) + one space per suite", () => {
  it("parkingDemand sums both, and suites reserve their spaces first", () => {
    const sim = Simulation.newGame(12);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    // 24 occupied office workers → 2 spaces; 3 suites → 3 more.
    for (let i = 0; i < 4; i++) occupy(sim, "office", 2, i * 9, "occupied");
    for (let i = 0; i < 3; i++) mustPlace(sim, "hotelSuite", 2, 40 + i * 12);
    const d = sim.parkingDemand();
    expect(d.officePop).toBe(4 * FACILITIES.office.population);
    expect(d.offices).toBe(Math.ceil(d.officePop / PARKING_WORKERS_PER_SPACE));
    expect(d.suites).toBe(3);
    expect(d.total).toBe(d.offices + d.suites);
    // Three working spaces: exactly enough for the suites, nothing for offices.
    lay(sim, "floor", 0);
    mustPlace(sim, "parkingRamp", 0, C);
    for (let i = 1; i <= 3; i++) mustPlace(sim, "parking", 0, C + i * 6);
    expect(sim.suiteParkingShort()).toBe(false);
  });

  it("suiteParkingShort only when working spaces < suites", () => {
    const sim = Simulation.newGame(13);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    mustPlace(sim, "hotelSuite", 2, 0);
    expect(sim.suiteParkingShort()).toBe(true); // 1 suite, 0 spaces
    lay(sim, "floor", 0);
    mustPlace(sim, "parkingRamp", 0, C);
    mustPlace(sim, "parking", 0, C + 6);
    expect(sim.suiteParkingShort()).toBe(false); // 1 suite, 1 chained space
  });

  it("parkingUsage: office cars by weekday day, suite cars overnight, none on a dead lot", () => {
    const sim = Simulation.newGame(14);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    for (let i = 0; i < 4; i++) occupy(sim, "office", 2, i * 9, "occupied");
    const suite = occupy(sim, "hotelSuite", 2, 40, "empty");
    lay(sim, "floor", 0);
    mustPlace(sim, "parkingRamp", 0, C);
    for (let i = 1; i <= 4; i++) mustPlace(sim, "parking", 0, C + i * 6);
    // Monday noon: office cars parked, no suite car.
    sim.clock.minutes = 12 * 60; // day 0 = Monday
    const daytime = sim.parkingUsage();
    expect(daytime).toBeGreaterThan(0);
    // Monday 23:00 with a sleeping suite guest: the suite's car stands, offices' gone.
    suite.state = "asleep";
    sim.clock.minutes = 23 * 60;
    expect(sim.parkingUsage()).toBeGreaterThan(0);
    // Saturday noon, guest checked out: the lot is empty.
    suite.state = "empty";
    sim.clock.minutes = 5 * 1440 + 12 * 60; // Saturday
    expect(sim.parkingUsage()).toBe(0);
  });
});

describe("Over-capacity recycling stops flattering commerce", () => {
  it("commercial income sags once population outgrows the centers (same layout, more pop)", () => {
    function shopIncome(centers: number): number {
      const sim = Simulation.newGame(15);
      sim.money = 1e12;
      sim.star = 3;
      lay(sim, "lobby", 1);
      for (let f = 2; f <= 17; f++) lay(sim, "floor", f);
      sim.buildTransport("elevatorStandard", C, 1, 17);
      // A big occupied office block: >3,000 population (over one center's 2,500).
      let placed = 0;
      for (let f = 2; f <= 16; f++)
        for (let x = 0; x + 9 <= W && placed < 550; x += 9) {
          const r = sim.tower.place("office", f, x);
          if (r.ok) {
            sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
            placed++;
          }
        }
      occupy(sim, "shop", 17, 0, "occupied");
      lay(sim, "floor", 0);
      lay(sim, "floor", -1);
      for (let i = 0; i < centers; i++) mustPlace(sim, "recycling", -1, i * 20);
      sim.clock.minutes = 10 * 60; // shops open at 10:00
      const before = sim.money;
      for (let i = 0; i < 8; i++) sim.tick(60); // a shopping day
      return sim.money - before;
    }
    expect(shopIncome(2)).toBeGreaterThan(shopIncome(1)); // demand met out-earns overflowing
  });
});
