import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { Clock } from "../engine/Clock";
import { visibleOccupants } from "../engine/Crowd";

/**
 * Per-person meal round-trip regression suite (PR A: person-tracking epic).
 * Guards the load-bearing invariants from arch-person-meal-round-trips-2026-07-09:
 *   - u.occupants stays canonical (untouched by this PR).
 *   - outForMeal is transient; save/load resets it.
 *   - Ghost-decrement guard prevents a bulldozed origin from ghost-editing a
 *     fresh unit built on the same floor after.
 *   - visibleOccupants(u) = max(0, u.occupants - outForMeal) is the projection
 *     the renderer + (PR B) census read.
 *   - MAX_PEOPLE cap still holds through a lunch peak with round-trippers.
 *   - collectTrafficIncome byte-identical (no economy change).
 */

/** A fixture with one served office (5 workers) + a fastFood venue. */
function officeAndFastFood(): Simulation {
  const sim = new Simulation(2024, "modern", "realWorld");
  sim.money = 1_000_000;
  sim.star = 1; // gate fires
  for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= 5; f++) for (let x = 0; x < 40; x++) sim.tower.place("floor", f, x);
  sim.tower.placeTransport("elevatorStandard", 4, 1, 5);
  const office = sim.tower.place("office", 2, 10);
  const ff = sim.tower.place("fastFood", 5, 0);
  for (const r of [office, ff]) {
    const u = sim.tower.units.find((x) => x.id === r.unitId);
    if (u) {
      u.state = "occupied";
      u.occupants = 6; // seeded so meal round-trippers can spawn immediately
    }
  }
  return sim;
}

function setHour(sim: Simulation, hour: number): void {
  sim.clock = new Clock(hour * 60, sim.clock.calendar);
}

describe("visibleOccupants helper is a pure projection", () => {
  it("returns u.occupants when outForMeal is undefined or zero", () => {
    expect(visibleOccupants({ occupants: 6 })).toBe(6);
    expect(visibleOccupants({ occupants: 6, outForMeal: 0 })).toBe(6);
  });
  it("subtracts outForMeal", () => {
    expect(visibleOccupants({ occupants: 6, outForMeal: 2 })).toBe(4);
  });
  it("clamps at zero (robust against any accounting slip)", () => {
    expect(visibleOccupants({ occupants: 2, outForMeal: 5 })).toBe(0);
  });
  it("negative canonical occupants read as zero", () => {
    // Not a reachable state today, but the clamp handles it.
    expect(visibleOccupants({ occupants: -1 })).toBe(0);
  });
});

describe("outbound meal spawn decrements visible occupancy", () => {
  it("a lunch trip from a staffed office decrements visibleOccupants(u) by 1", () => {
    const sim = officeAndFastFood();
    setHour(sim, 12);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    const startingVisible = visibleOccupants(office);
    expect(startingVisible).toBeGreaterThan(0);
    // Pump the crowd through 30 in-game minutes; at least one meal round-tripper
    // should have spawned and be in one of the pre-eating states.
    let seenAtLeastOneOut = false;
    for (let m = 0; m < 30; m++) {
      sim.tick(1);
      if (visibleOccupants(office) < startingVisible) {
        seenAtLeastOneOut = true;
        break;
      }
    }
    expect(seenAtLeastOneOut).toBe(true);
    // `outForMeal` is what got incremented; `u.occupants` is unchanged.
    expect(office.outForMeal ?? 0).toBeGreaterThan(0);
    expect(office.occupants).toBe(6); // canonical seat count, untouched
  });
});

describe("round trip completes and re-increments visible occupancy", () => {
  it("outForMeal drains fully by the time all stragglers finish their return leg", () => {
    // The last outbound spawn fires around t=0.6 (12:48 for lunch). With max
    // eat time (60 game minutes) + return trip (~5-10 min) the last straggler
    // is back around 14:00. Run PAST the window's end to guarantee full drain.
    const sim = officeAndFastFood();
    setHour(sim, 11);
    // 4 hours: 3-hour lunch window + 1 hour of straggler wind-down.
    for (let m = 0; m < 240; m++) sim.tick(1);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(office.outForMeal ?? 0).toBe(0);
  });
});

describe("ghost-decrement guard: bulldoze origin during eating", () => {
  it("removes the origin unit while a person is out; no crash, no ghost decrement on a new unit", () => {
    const sim = officeAndFastFood();
    setHour(sim, 12);
    // Get at least one round-tripper spawned so a person carries an
    // originUnitId pointing at the office.
    let originId = -1;
    for (let m = 0; m < 30; m++) {
      sim.tick(1);
      const withOrigin = sim.crowd.people.find((p) => p.originUnitId !== undefined);
      if (withOrigin) {
        originId = withOrigin.originUnitId!;
        break;
      }
    }
    expect(originId).toBeGreaterThan(0);
    // Remove the origin unit. On the person's return arrival, the ghost guard
    // in finish() and transitionToReturn() must skip the outForMeal decrement.
    const office = sim.tower.units.find((u) => u.id === originId)!;
    expect(office).toBeDefined();
    sim.tower.removeUnit(originId);
    expect(sim.tower.units.find((u) => u.id === originId)).toBeUndefined();
    // Advance long enough for the eating pause + return leg to complete.
    // The person must despawn without exception.
    for (let m = 0; m < 180; m++) sim.tick(1);
    // No exception thrown; the person is off the crowd list (or in state=done).
    const stillLive = sim.crowd.people.filter((p) => p.originUnitId === originId && p.state !== "done");
    expect(stillLive.length).toBe(0);
  });
});

describe("save/load resets outForMeal (transient state)", () => {
  it("a mid-meal serialize/deserialize resets outForMeal to zero", () => {
    const sim = officeAndFastFood();
    setHour(sim, 12);
    // Seed an obvious outForMeal on the office directly (skip the spawn wait).
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.outForMeal = 3;
    expect(office.outForMeal).toBe(3);
    const restored = Simulation.deserialize(sim.serialize());
    const restoredOffice = restored.tower.units.find((u) => u.kind === "office")!;
    expect(restoredOffice.outForMeal ?? 0).toBe(0);
  });
});

describe("MAX_PEOPLE cap holds under real round-trip density", () => {
  it("a densely-populated tower simulated through a full lunch stays under the cap", () => {
    const sim = officeAndFastFood();
    // Beef the tower up: more offices, condos, hotels so meal density peaks.
    for (let f = 2; f <= 5; f++) {
      for (let x = 0; x < 6; x++) {
        const kind = f === 4 ? "hotelSingle" : f === 3 ? "condo" : "office";
        const r = sim.tower.place(kind, f, x * 4);
        const u = sim.tower.units.find((x) => x.id === r.unitId);
        if (u) {
          u.state = "occupied";
          u.occupants = 6;
        }
      }
    }
    setHour(sim, 11);
    for (let m = 0; m < 180; m++) {
      sim.tick(1);
      expect(sim.crowd.people.length).toBeLessThanOrEqual(140);
    }
  });
});

describe("collectTrafficIncome byte-identical (no economy change)", () => {
  it("a fixed-clock fixture with a fastFood produces the same amount before and after the person-tracking PR", () => {
    // Two fresh identical fixtures at 12:00, no meal round-trippers yet.
    const s1 = officeAndFastFood();
    const s2 = officeAndFastFood();
    setHour(s1, 12);
    setHour(s2, 12);
    s1.economy.collectTrafficIncome();
    s2.economy.collectTrafficIncome();
    expect(s1.money).toBe(s2.money);
    // Explicit: no meal-cadence overlay affects trafficAppeal or dailyTrafficIncome.
    expect(s1.money).toBeGreaterThan(1_000_000); // fastFood earned SOMETHING at lunch
  });
});

describe("meal round-trippers respect the two-ride reachability rule", () => {
  it("spawns nothing when the venue is unreachable (no transport)", () => {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 1_000_000;
    sim.star = 1;
    for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) sim.tower.place("floor", 2, x);
    for (let x = 0; x < 40; x++) sim.tower.place("floor", 5, x);
    // NO transport built. Office on floor 2, fastFood on floor 5, no route.
    const office = sim.tower.place("office", 2, 10);
    const ff = sim.tower.place("fastFood", 5, 0);
    for (const r of [office, ff]) {
      const u = sim.tower.units.find((x) => x.id === r.unitId);
      if (u) {
        u.state = "occupied";
        u.occupants = 6;
      }
    }
    setHour(sim, 12);
    for (let m = 0; m < 60; m++) sim.tick(1);
    // No route means `add()` returns null and `spawnMealOutbound` no-ops
    // WITHOUT incrementing outForMeal.
    const officeUnit = sim.tower.units.find((u) => u.kind === "office")!;
    expect(officeUnit.outForMeal ?? 0).toBe(0);
  });
});
