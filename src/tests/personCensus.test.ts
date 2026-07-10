import { describe, it, expect } from "vitest";
import { Simulation, SAVE_VERSION } from "../engine/Simulation";
import { Clock } from "../engine/Clock";

/**
 * Venue-population census regression suite (PR B: population-census parity).
 * Guards the census seam and its fold into the displayed and rating population:
 *   - Tower.associatedPopulation / Crowd.mealAssociatedPopulation read the
 *     transient `outForMeal` overlay (the derived projection), counting each
 *     meal round-tripper exactly once with no double count.
 *   - population = totalPopulation + venue-associated meal customers.
 *   - ratingPopulation folds the census in, with the canon hotel exclusion
 *     applied to the customer's ORIGIN unit at 3★+ (a guest out for a meal is
 *     still a hotel person and drops out of the rating census at 3★).
 *   - Ghost guard: an origin bulldozed mid-meal does not corrupt the census.
 *   - SAVE_VERSION is 4 and a v3 save migrates cleanly.
 */

/** A fixture with one served office (6 workers) + a fastFood venue. Star gate
 *  fires so meal round-trippers can spawn during the integration test. */
function officeAndFastFood(): Simulation {
  const sim = new Simulation(2024, "modern", "realWorld");
  sim.money = 1_000_000;
  sim.star = 1;
  for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= 5; f++) for (let x = 0; x < 40; x++) sim.tower.place("floor", f, x);
  sim.tower.placeTransport("elevatorStandard", 4, 1, 5);
  const office = sim.tower.place("office", 2, 10);
  const ff = sim.tower.place("fastFood", 5, 0);
  for (const r of [office, ff]) {
    const u = sim.tower.units.find((x) => x.id === r.unitId);
    if (u) {
      u.state = "occupied";
      u.occupants = 6;
    }
  }
  return sim;
}

/** Add an occupied hotel room on floor 4 so hotel-origin exclusion can be
 *  tested. Returns the placed unit. */
function addOccupiedHotel(sim: Simulation) {
  const r = sim.tower.place("hotelSingle", 4, 0);
  const u = sim.tower.units.find((x) => x.id === r.unitId)!;
  u.state = "asleep"; // a present hotel state
  u.occupants = 1;
  return u;
}

function setHour(sim: Simulation, hour: number): void {
  sim.clock = new Clock(hour * 60, sim.clock.calendar);
}

describe("Tower.associatedPopulation reads the outForMeal overlay", () => {
  it("is zero with no meal customers out", () => {
    const sim = officeAndFastFood();
    expect(sim.tower.associatedPopulation()).toBe(0);
  });

  it("sums the transient outForMeal overlay across units", () => {
    const sim = officeAndFastFood();
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.outForMeal = 2;
    expect(sim.tower.associatedPopulation()).toBe(2);
    // A second origin's customers add on top (no double count: each overlay is a
    // distinct set of round-trippers).
    const hotel = addOccupiedHotel(sim);
    hotel.outForMeal = 3;
    expect(sim.tower.associatedPopulation()).toBe(5);
  });

  it("ignores overlay on a non-present unit (mirrors totalPopulation gating)", () => {
    const sim = officeAndFastFood();
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.outForMeal = 4;
    office.state = "construction"; // not present
    expect(sim.tower.associatedPopulation()).toBe(0);
  });
});

describe("excludeHotelOrigin drops hotel-origin meal customers", () => {
  it("keeps non-hotel customers, drops hotel-origin ones", () => {
    const sim = officeAndFastFood();
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    const hotel = addOccupiedHotel(sim);
    office.outForMeal = 2;
    hotel.outForMeal = 3;
    expect(sim.tower.associatedPopulation()).toBe(5); // all origins
    expect(sim.tower.associatedPopulation({ excludeHotelOrigin: true })).toBe(2); // hotel dropped
  });
});

describe("Crowd.mealAssociatedPopulation delegates to Tower.associatedPopulation", () => {
  it("returns the same count for both the all-origins and hotel-excluded reads", () => {
    const sim = officeAndFastFood();
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    const hotel = addOccupiedHotel(sim);
    office.outForMeal = 2;
    hotel.outForMeal = 3;
    expect(sim.crowd.mealAssociatedPopulation(sim.tower)).toBe(sim.tower.associatedPopulation());
    expect(sim.crowd.mealAssociatedPopulation(sim.tower, { excludeHotelOrigin: true })).toBe(
      sim.tower.associatedPopulation({ excludeHotelOrigin: true }),
    );
  });
});

describe("population folds in venue-associated meal customers", () => {
  it("population = totalPopulation + census", () => {
    const sim = officeAndFastFood();
    const base = sim.tower.totalPopulation();
    expect(sim.population).toBe(base); // no one out yet
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.outForMeal = 2;
    expect(sim.population).toBe(base + 2);
    // Canonical occupancy and resident count are untouched by the overlay.
    expect(office.occupants).toBe(6);
    expect(sim.tower.totalPopulation()).toBe(base);
  });
});

describe("ratingPopulation folds the census with the hotel-origin exclusion", () => {
  it("below 3★ ratingPopulation equals population (hotels + their customers count)", () => {
    const sim = officeAndFastFood();
    const hotel = addOccupiedHotel(sim);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.outForMeal = 2;
    hotel.outForMeal = 3;
    sim.star = 1;
    expect(sim.ratingPopulation()).toBe(sim.population);
  });

  it("at 3★ includes non-hotel meal customers but EXCLUDES hotel-origin ones", () => {
    const sim = officeAndFastFood();
    const hotel = addOccupiedHotel(sim);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    sim.star = 3;
    // Baseline rating census (no one out) with hotels excluded from tenants.
    const ratingBase = sim.ratingPopulation();
    office.outForMeal = 2; // non-hotel customers: DO count
    hotel.outForMeal = 3; // hotel-origin customers: do NOT count at 3★
    expect(sim.ratingPopulation()).toBe(ratingBase + 2);
    // The displayed population counts BOTH the office and hotel customers, so it
    // stays strictly above the rating census (the hotel side is excluded there).
    expect(sim.population).toBeGreaterThan(sim.ratingPopulation());
  });
});

describe("ghost guard: bulldozing the origin mid-meal does not corrupt the census", () => {
  it("census returns to zero and population settles back to totalPopulation", () => {
    const sim = officeAndFastFood();
    setHour(sim, 12);
    // Spawn at least one round-tripper carrying an originUnitId.
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
    // Bulldoze the origin office while its worker is out.
    sim.tower.removeUnit(originId);
    expect(sim.tower.units.find((u) => u.id === originId)).toBeUndefined();
    // Run past the eating pause + return leg. No crash, and the census cannot
    // count a unit that no longer exists (removed from tower.units).
    for (let m = 0; m < 180; m++) sim.tick(1);
    expect(sim.tower.associatedPopulation()).toBe(0);
    expect(sim.population).toBe(sim.tower.totalPopulation());
  });
});

describe("integration: displayed population rises during lunch then settles", () => {
  it("population exceeds totalPopulation at the lunch peak and returns after", () => {
    const sim = officeAndFastFood();
    setHour(sim, 11);
    const base = sim.tower.totalPopulation();
    let sawRise = false;
    for (let m = 0; m < 180; m++) {
      sim.tick(1);
      if (sim.population > base) sawRise = true;
      // The census can never make displayed pop drop below the static baseline.
      expect(sim.population).toBeGreaterThanOrEqual(base);
    }
    expect(sawRise).toBe(true);
    // Run out the window + straggler wind-down: every customer is home, census 0.
    for (let m = 0; m < 120; m++) sim.tick(1);
    expect(sim.tower.associatedPopulation()).toBe(0);
    expect(sim.population).toBe(base);
  });
});

describe("save version is 4 and a v3 save migrates cleanly", () => {
  it("SAVE_VERSION is 4 and serialize stamps it", () => {
    const sim = officeAndFastFood();
    expect(SAVE_VERSION).toBe(4);
    expect(sim.serialize().version).toBe(4);
  });

  it("a v3 save loads as v4 with the census resetting to zero", () => {
    const sim = officeAndFastFood();
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.outForMeal = 3; // transient, must not survive the round-trip
    const data = sim.serialize();
    (data as { version: number }).version = 3; // pretend it is a v3 save
    const restored = Simulation.deserialize(data);
    expect(restored.serialize().version).toBe(4);
    expect(restored.tower.associatedPopulation()).toBe(0);
    expect(restored.population).toBe(restored.tower.totalPopulation());
  });
});
