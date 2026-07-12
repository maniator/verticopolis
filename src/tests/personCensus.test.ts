import { describe, it, expect } from "vitest";
import { Simulation, SAVE_VERSION } from "../engine/Simulation";
import { Clock } from "../engine/Clock";

/**
 * Venue-population census regression suite.
 * Guards the census seam and the invariant that displayed/rating population stay
 * on canonical room occupancy while meal round-trippers are tracked separately:
 *   - Tower.associatedPopulation / Crowd.mealAssociatedPopulation read the
 *     transient `outForMeal` overlay (the derived projection), counting each
 *     meal round-tripper exactly once with no double count.
 *   - population and ratingPopulation keep reading the canonical room census;
 *     the venue overlay is never folded into either metric.
 *   - ratingPopulation keeps the canon hotel exclusion via the room-side hotel
 *     gate at 4★+.
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
      // Seed a full office headcount (matches FACILITIES.office population) so
      // the census has real occupants to draw meal round-trippers from.
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

describe("population stays on the canonical room census", () => {
  it("meal customers do not add on top of totalPopulation", () => {
    const sim = officeAndFastFood();
    const base = sim.tower.totalPopulation();
    expect(sim.population).toBe(base); // no one out yet
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.outForMeal = 2;
    expect(sim.population).toBe(base);
    // Canonical occupancy and resident count are untouched by the overlay, so the
    // derived meal census must stay separate from the HUD's population total.
    expect(office.occupants).toBe(6);
    expect(sim.tower.totalPopulation()).toBe(base);
  });
});

describe("ratingPopulation stays on the canonical room census", () => {
  it("below 4★ ratingPopulation equals population even with meal customers out", () => {
    const sim = officeAndFastFood();
    const hotel = addOccupiedHotel(sim);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.outForMeal = 2;
    hotel.outForMeal = 3;
    sim.star = 1;
    expect(sim.ratingPopulation()).toBe(sim.population);
  });

  it("at 4★ meal customers do not change the hotel-excluded rating census", () => {
    const sim = officeAndFastFood();
    const hotel = addOccupiedHotel(sim);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    sim.star = 4;
    // Baseline rating census (no one out) with hotels excluded from tenants.
    const ratingBase = sim.ratingPopulation();
    office.outForMeal = 2;
    hotel.outForMeal = 3;
    expect(sim.ratingPopulation()).toBe(ratingBase);
    // Displayed population still exceeds the rating census because hotel guests
    // count in the HUD below/above meals, but never in the 4★+ rating read.
    expect(sim.population).toBeGreaterThan(ratingBase);
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

describe("integration: meal census rises during lunch while HUD population rises too", () => {
  it("associatedPopulation rises at the lunch peak; population returns to base after", () => {
    const sim = officeAndFastFood();
    setHour(sim, 11);
    const base = sim.tower.totalPopulation(); // office workers only (no customers yet)
    let sawAssociatedRise = false;
    let sawPopulationRise = false;
    for (let m = 0; m < 180; m++) {
      sim.tick(1);
      if (sim.tower.associatedPopulation() > 0) sawAssociatedRise = true;
      // Population can only stay the same or rise during lunch (customers
      // arriving at the venue add to the live census).
      expect(sim.population).toBeGreaterThanOrEqual(base);
      if (sim.population > base) sawPopulationRise = true;
    }
    expect(sawAssociatedRise).toBe(true);
    expect(sawPopulationRise).toBe(true);
    // Run out the window + straggler wind-down: every customer is home, census returns.
    for (let m = 0; m < 120; m++) sim.tick(1);
    expect(sim.tower.associatedPopulation()).toBe(0);
    expect(sim.population).toBe(base);
  });
});

describe("commercial venues (fastFood/restaurant/shop) count toward totalPopulation and ratingPopulation", () => {
  it("a fastFood with no customers yet contributes 0 to totalPopulation", () => {
    const sim = officeAndFastFood();
    const ff = sim.tower.units.find((u) => u.kind === "fastFood")!;
    ff.customersIn = undefined; // ensure nothing eating
    expect(sim.tower.totalPopulation()).toBe(6); // office only (6), no fastFood customers
  });

  it("fastFood with customersIn = 5 adds exactly 5 to totalPopulation", () => {
    const sim = officeAndFastFood();
    const ff = sim.tower.units.find((u) => u.kind === "fastFood")!;
    ff.customersIn = 5;
    expect(sim.tower.totalPopulation()).toBe(11); // 6 office + 5 customers
  });

  it("occupied restaurant and shop each add their live customersIn to totalPopulation", () => {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 1_000_000;
    for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 3; f++) for (let x = 0; x < 40; x++) sim.tower.place("floor", f, x);
    const rest = sim.tower.place("restaurant", 2, 0);
    const sh = sim.tower.place("shop", 3, 0);
    const restUnit = sim.tower.units.find((u) => u.id === rest.unitId)!;
    const shUnit = sim.tower.units.find((u) => u.id === sh.unitId)!;
    restUnit.state = "occupied";
    restUnit.customersIn = 12;
    shUnit.state = "occupied";
    shUnit.customersIn = 8;
    expect(sim.tower.totalPopulation()).toBe(20);
  });

  it("commercial census flows into ratingPopulation at all star rungs", () => {
    const sim = officeAndFastFood();
    const ff = sim.tower.units.find((u) => u.kind === "fastFood")!;
    ff.customersIn = 10;
    for (const star of [1, 2, 3, 4, 5] as const) {
      sim.star = star;
      // Exactly office (6) + fastFood customers (10) at every rung: below 4 via
      // totalPopulation, at 4+ via occupantPopulation (no hotels here, and the
      // customers stay in). An inexact bound would let double counting slip by.
      expect(sim.ratingPopulation()).toBe(16);
    }
  });

  it("a VACANT commercial unit contributes nothing, even with a stale customersIn", () => {
    const sim = officeAndFastFood();
    const ff = sim.tower.units.find((u) => u.kind === "fastFood")!;
    ff.state = "empty"; // not isPresent: the census must skip it entirely
    ff.customersIn = 4; // stale count on a vacated unit must not leak in
    // only office occupants (6) count
    expect(sim.tower.totalPopulation()).toBe(6);
  });

  it("a forged save's customersIn/outForMeal are stripped on load (census stays clean)", () => {
    const sim = officeAndFastFood();
    const data = sim.serialize();
    // Hand-edit the save the way a hostile file would: stamp transient crowd
    // counters directly onto the serialized units.
    type Forgeable = { kind: string; customersIn?: number; outForMeal?: number };
    const ffSaved = (data.units as unknown as Forgeable[]).find((u) => u.kind === "fastFood")!;
    ffSaved.customersIn = 9999;
    const officeSaved = (data.units as unknown as Forgeable[]).find((u) => u.kind === "office")!;
    officeSaved.outForMeal = -50;
    const restored = Simulation.deserialize(data);
    const ffRestored = restored.tower.units.find((u) => u.kind === "fastFood")!;
    const officeRestored = restored.tower.units.find((u) => u.kind === "office")!;
    expect(ffRestored.customersIn).toBeUndefined();
    expect(officeRestored.outForMeal).toBeUndefined();
    // The forged 9999 must not reach the census or star gating.
    expect(restored.tower.totalPopulation()).toBe(6); // office workers only
  });

  it("commercial customersIn is not persisted across save/reload", () => {
    const sim = officeAndFastFood();
    const ff = sim.tower.units.find((u) => u.kind === "fastFood")!;
    ff.customersIn = 7;
    const data = sim.serialize();
    const restored = Simulation.deserialize(data);
    const ffRestored = restored.tower.units.find((u) => u.kind === "fastFood")!;
    expect(ffRestored.customersIn ?? 0).toBe(0);
    expect(restored.tower.totalPopulation()).toBe(restored.population);
  });

  it("commercial counts in both Classic and Modern modes", () => {
    for (const mode of ["classic", "modern"] as const) {
      const sim = new Simulation(2024, mode, "realWorld");
      sim.money = 1_000_000;
      for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
      for (let x = 0; x < 40; x++) sim.tower.place("floor", 2, x);
      const r = sim.tower.place("fastFood", 2, 0);
      const u = sim.tower.units.find((u) => u.id === r.unitId)!;
      u.state = "occupied";
      u.customersIn = 3;
      expect(sim.tower.totalPopulation()).toBe(3);
    }
  });
  it("cinema (lateNight venue, population=0) does not count toward totalPopulation even with customersIn set", () => {
    // Cinema is isCommercialKind but FACILITIES.cinema.population = 0, so it is
    // excluded from the census. This test guards against the bug where
    // isCommercialKind alone was used as the census gate: cinema is a valid
    // lateNight meal destination so its customersIn would have been incremented
    // by eating-state entry, and then incorrectly counted as census population.
    // The fix: all three census reads gate on FACILITIES[kind].population > 0.
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 1_000_000;
    for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 4; f++) for (let x = 0; x < 40; x++) sim.tower.place("floor", f, x);
    const r = sim.tower.place("cinema", 2, 0);
    const u = sim.tower.units.find((u) => u.id === r.unitId)!;
    u.state = "occupied";
    u.customersIn = 10; // simulate late-night cinema-goers
    expect(sim.tower.totalPopulation()).toBe(0); // cinema excluded from census
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

describe("hotel-origin venue customers stay out of the 4-star-plus census", () => {
  it("hotelCustomersIn is subtracted from ratingPopulation at 4-star and above", () => {
    const sim = officeAndFastFood();
    const ff = sim.tower.units.find((u) => u.kind === "fastFood")!;
    ff.customersIn = 10;
    ff.hotelCustomersIn = 4; // four of the ten eaters are hotel guests
    sim.star = 3;
    // Below 4-star: hotels still count, so all ten customers count.
    expect(sim.ratingPopulation()).toBe(16); // 6 office + 10 customers
    sim.star = 4;
    // At 4-star-plus: the four hotel-origin eaters drop with their guests.
    expect(sim.ratingPopulation()).toBe(12); // 6 office + 6 non-hotel customers
  });

  it("forged counters on a population-0 commercial kind (cinema) never subtract", () => {
    // censusCount skips cinema (population 0), so its customersIn is never
    // added to the census. The hotel-origin subtraction must mirror that gate:
    // forged or future counters on a cinema must not be subtracted from a
    // tally that never added them.
    const sim = officeAndFastFood();
    sim.star = 4;
    const cinema = sim.tower.place("cinema", 3, 0);
    expect(cinema.reason).toBeUndefined();
    expect(cinema.ok).toBe(true);
    const cinemaUnit = sim.tower.units.find((u) => u.id === cinema.unitId)!;
    cinemaUnit.state = "occupied";
    const base = sim.ratingPopulation();
    cinemaUnit.customersIn = 50;
    cinemaUnit.hotelCustomersIn = 50;
    expect(sim.ratingPopulation()).toBe(base);
  });

  it("a breakfast hotel guest is counted at the venue AND flagged as hotel-origin", () => {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 1_000_000;
    sim.star = 1;
    for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 3; f++) for (let x = 0; x < 40; x++) sim.tower.place("floor", f, x);
    sim.tower.placeTransport("elevatorStandard", 4, 1, 3);
    const hotel = sim.tower.place("hotelDouble", 2, 10);
    const ff = sim.tower.place("fastFood", 3, 0);
    const hotelUnit = sim.tower.units.find((u) => u.id === hotel.unitId)!;
    const ffUnit = sim.tower.units.find((u) => u.id === ff.unitId)!;
    hotelUnit.state = "asleep"; // guests in residence, the breakfast origin gate
    hotelUnit.occupants = 2;
    ffUnit.state = "occupied";
    setHour(sim, 7); // breakfast window, fastFood open
    let sawHotelEater = false;
    for (let m = 0; m < 120 && !sawHotelEater; m++) {
      sim.tick(1);
      if ((ffUnit.hotelCustomersIn ?? 0) > 0) {
        sawHotelEater = true;
        // The subset never exceeds the total, and the eater still counts in
        // the sub-4-star census via customersIn.
        expect(ffUnit.hotelCustomersIn ?? 0).toBeLessThanOrEqual(ffUnit.customersIn ?? 0);
      }
    }
    expect(sawHotelEater).toBe(true);
    // Run the morning out: every counter drains back to zero together.
    for (let m = 0; m < 240; m++) sim.tick(1);
    expect(ffUnit.customersIn ?? 0).toBe(0);
    expect(ffUnit.hotelCustomersIn ?? 0).toBe(0);
  });
});
