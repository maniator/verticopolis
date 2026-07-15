import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { Clock } from "../../engine/Clock";
import { visibleOccupants, CROWD_SECONDS_PER_MINUTE, EAT_SECONDS_MIN, EAT_SECONDS_MAX } from "../../engine/Crowd";
import { FACILITIES } from "../../engine/facilities";

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

/** A fixture with one served office (6 workers) + a fastFood venue. */
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
      u.occupants = 6; // full office headcount (FACILITIES.office population) so meal round-trippers can spawn immediately
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
    expect(sim.tower.mealOverlayRevision).toBeGreaterThan(0);
  });
});

describe("same-floor meal round-trip (walk-only route)", () => {
  /** Office and fastFood venue on the SAME floor, so origin -> venue routes
   *  with zero rides. The trip must still spawn a real round-tripper (guards
   *  the reviewer thread: `add` must reject only null routes, not empty-shaft
   *  same-floor ones, which `makePerson` already walks). */
  function officeAndFastFoodSameFloor(): Simulation {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 1_000_000;
    sim.star = 1;
    for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 3; f++) for (let x = 0; x < 40; x++) sim.tower.place("floor", f, x);
    sim.tower.placeTransport("elevatorStandard", 4, 1, 3);
    const office = sim.tower.place("office", 2, 30);
    const ff = sim.tower.place("fastFood", 2, 0); // same floor as the office
    for (const r of [office, ff]) {
      const u = sim.tower.units.find((x) => x.id === r.unitId);
      if (u) {
        u.state = "occupied";
        u.occupants = 6;
      }
    }
    return sim;
  }

  it("a same-floor lunch trip still dips visible occupancy", () => {
    const sim = officeAndFastFoodSameFloor();
    setHour(sim, 12);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    const startingVisible = visibleOccupants(office);
    expect(startingVisible).toBeGreaterThan(0);
    let seenAtLeastOneOut = false;
    for (let m = 0; m < 30; m++) {
      sim.tick(1);
      if (visibleOccupants(office) < startingVisible) {
        seenAtLeastOneOut = true;
        break;
      }
    }
    expect(seenAtLeastOneOut).toBe(true);
    expect(office.outForMeal ?? 0).toBeGreaterThan(0);
    expect(office.occupants).toBe(6);
  });

  it("outForMeal drains fully after a same-floor round-trip completes", () => {
    const sim = officeAndFastFoodSameFloor();
    setHour(sim, 11);
    for (let m = 0; m < 240; m++) sim.tick(1);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(office.outForMeal ?? 0).toBe(0);
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

// Economy byte-identical is asserted by `mealCadence.test.ts`'s
// `collectTrafficIncome is byte-identical after adding meal cadence` block
// via the sanctioned SimContext harness (`s.economy` is private). PR A did not
// touch trafficAppeal or dailyTrafficIncome, so that block covers this PR too.

describe("outbound arrival transitions to eating with in-range timer (arch §8 test 2)", () => {
  it("a person spawned outbound reaches state `eating` with EAT_SECONDS_LEFT in [60, 120] crowd-seconds", () => {
    // 60..120 crowd-seconds = EAT_MINUTES_MIN..MAX * CROWD_SECONDS_PER_MINUTE
    // = 30..60 in-game minutes.
    const sim = officeAndFastFood();
    setHour(sim, 12);
    // Pump long enough for a spawn to complete outbound + reach the venue.
    // ~15 min is generous for a 3-floor trip.
    let seenEating: { dwellSecondsLeft?: number } | null = null;
    for (let m = 0; m < 30 && !seenEating; m++) {
      sim.tick(1);
      seenEating = sim.crowd.people.find((p) => p.state === "dwelling") ?? null;
    }
    expect(seenEating).not.toBeNull();
    const eat = seenEating?.dwellSecondsLeft ?? -1;
    // The person may have already decremented dwellSecondsLeft by up to one crowd
    // step (sim.tick(1) advances the crowd by CROWD_SECONDS_PER_MINUTE = 2
    // crowd-seconds) by the time we sample, so allow a 2-second slack under the
    // 60-second minimum. This still fails a bug that sets the timer far below
    // the intended floor (e.g. a 5-10 second eat).
    expect(eat).toBeGreaterThanOrEqual(EAT_SECONDS_MIN - CROWD_SECONDS_PER_MINUTE);
    expect(eat).toBeLessThanOrEqual(EAT_SECONDS_MAX);
  });
});

describe("return trip fires after eating expires (arch §8 test 3)", () => {
  it("an eating person's route mutates to venue -> origin when dwellSecondsLeft hits zero", () => {
    const sim = officeAndFastFood();
    setHour(sim, 12);
    // Find a person in `eating` state and remember their originUnitId.
    let originId = -1;
    for (let m = 0; m < 30; m++) {
      sim.tick(1);
      const eater = sim.crowd.people.find((p) => p.state === "dwelling");
      if (eater) {
        originId = eater.originUnitId!;
        break;
      }
    }
    expect(originId).toBeGreaterThan(0);
    const office = sim.tower.units.find((u) => u.id === originId)!;
    // Advance long enough for dwellSecondsLeft to drain (max 120 crowd-seconds =
    // ~60 in-game minutes, generously covered by 90 minutes).
    for (let m = 0; m < 90; m++) sim.tick(1);
    // The specific person is either mid-return-trip (state in toShaft/waiting/
    // riding/climbing/toDest with returning=true) or already back (state=done).
    // Either way, no one still `eating` who originated at that office is left
    // behind, and if a return-trip person is in-flight their route starts at
    // the venue floor (5) and ends at the origin floor (2).
    const stillEatingHere = sim.crowd.people.filter(
      (p) => p.state === "dwelling" && p.originUnitId === originId,
    );
    expect(stillEatingHere.length).toBe(0);
    const inFlightReturn = sim.crowd.people.find(
      (p) => p.originUnitId === originId && p.returning === true && p.state !== "done",
    );
    if (inFlightReturn) {
      expect(inFlightReturn.floors[0]).toBe(5);
      expect(inFlightReturn.floors[inFlightReturn.floors.length - 1]).toBe(office.floor);
    }
  });
});

describe("bulldoze AFTER return-route computed (arch §8 test 6)", () => {
  it("removes origin during the return trip; no crash, no unit gets a ghost decrement", () => {
    const sim = officeAndFastFood();
    setHour(sim, 12);
    // Wait for a return-trip person to be in flight (returning=true, state != done).
    let originId = -1;
    for (let m = 0; m < 90 && originId < 0; m++) {
      sim.tick(1);
      const returner = sim.crowd.people.find(
        (p) => p.returning === true && p.state !== "done" && p.originUnitId !== undefined,
      );
      if (returner) originId = returner.originUnitId!;
    }
    expect(originId).toBeGreaterThan(0);
    // Bulldoze the origin while the return-trip is in transit. The person's
    // final finish() will find no unit and skip the decrement; the guard must
    // not throw.
    sim.tower.removeUnit(originId);
    for (let m = 0; m < 30; m++) sim.tick(1);
    // No exception thrown; every person for that origin has despawned.
    const still = sim.crowd.people.filter(
      (p) => p.originUnitId === originId && p.state !== "done",
    );
    expect(still.length).toBe(0);
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

describe("eating customers attach to the venue they were sent to (census attribution)", () => {
  it("counts every eater at the fastFood unit even when the venue floor also holds another room", () => {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 1_000_000;
    sim.star = 1;
    for (let x = 0; x < 40; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 5; f++) for (let x = 0; x < 40; x++) sim.tower.place("floor", f, x);
    sim.tower.placeTransport("elevatorStandard", 4, 1, 5);
    const office = sim.tower.place("office", 2, 10);
    const ff = sim.tower.place("fastFood", 5, 0);
    // A second room on the venue floor so most corridor tiles do NOT sit inside
    // the fastFood footprint. Attribution must come from the spawn-time venue
    // stamp (mealVenueId), never from whatever room the arrival tile lands on.
    const decoy = sim.tower.place("office", 5, 24);
    for (const r of [office, ff, decoy]) {
      const u = sim.tower.units.find((x) => x.id === r.unitId);
      if (u) {
        u.state = "occupied";
        u.occupants = 6;
      }
    }
    const ffUnit = sim.tower.units.find((u) => u.id === ff.unitId)!;
    const decoyUnit = sim.tower.units.find((u) => u.id === decoy.unitId)!;
    setHour(sim, 12);
    let sawCountedEater = false;
    for (let m = 0; m < 60; m++) {
      sim.tick(1);
      const eaters = sim.crowd.people.filter((p) => p.state === "dwelling");
      for (const p of eaters) {
        // The only census-counted venue in this tower is the fastFood, so every
        // eater must be counted there; a missed count (venueUnitId undefined)
        // is the regression this test guards against.
        expect(p.venueUnitId).toBe(ffUnit.id);
      }
      // Exact accounting every tick: customersIn equals the people currently
      // counted at the venue (venueUnitId set; finish() clears it). That
      // includes return-leg riders, who stay counted until they despawn; an
      // inexact bound would let a slow increment leak pass forever.
      const counted = sim.crowd.people.filter((p) => p.venueUnitId === ffUnit.id).length;
      expect(ffUnit.customersIn ?? 0).toBe(counted);
      if (eaters.length > 0) {
        sawCountedEater = true;
        expect(decoyUnit.customersIn ?? 0).toBe(0);
      }
    }
    expect(sawCountedEater).toBe(true);
  });
});

describe("venue customer capacity: customersIn never exceeds the catalog population", () => {
  it("a heavy lunch crowd against one fastFood caps at FACILITIES.fastFood.population", () => {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 5_000_000;
    sim.star = 1;
    for (let x = 0; x < 60; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 6; f++) for (let x = 0; x < 60; x++) sim.tower.place("floor", f, x);
    sim.tower.placeTransport("elevatorStandard", 55, 1, 6);
    // Six full offices (36 potential eaters), far past the single venue's
    // catalog capacity.
    const offices: number[] = [];
    for (const [floor, x] of [[2, 0], [2, 20], [3, 0], [4, 0], [5, 0], [6, 0]] as const) {
      const r = sim.tower.place("office", floor, x);
      offices.push(r.unitId!);
    }
    const ff = sim.tower.place("fastFood", 6, 30);
    for (const id of [...offices, ff.unitId!]) {
      const u = sim.tower.units.find((x) => x.id === id)!;
      u.state = "occupied";
      u.occupants = 6;
    }
    const ffUnit = sim.tower.units.find((u) => u.id === ff.unitId)!;
    ffUnit.occupants = 0;
    const cap = FACILITIES.fastFood.population;
    sim.clock = new Clock(12 * 60, sim.clock.calendar);
    let peak = 0;
    // A full lunch window plus wind-down; the cap must hold on every tick,
    // since en-route eaters arrive continuously.
    for (let m = 0; m < 180; m++) {
      sim.tick(1);
      peak = Math.max(peak, ffUnit.customersIn ?? 0);
      expect(ffUnit.customersIn ?? 0).toBeLessThanOrEqual(cap);
    }
    // The crowd genuinely used the venue. Spawn pacing keeps the peak a bit
    // under the cap in this fixture; the two surgical tests below exercise
    // the cap mechanics directly.
    expect(peak).toBeGreaterThan(0);
  });

  it("an en-route eater arriving at a just-filled venue eats uncounted (arrival clamp)", () => {
    const sim = officeAndFastFood();
    setHour(sim, 12);
    const ff = sim.tower.units.find((u) => u.kind === "fastFood")!;
    const cap = FACILITIES.fastFood.population;
    // Wait for one meal round-tripper to be en route to the venue.
    let traveler;
    for (let m = 0; m < 30 && !traveler; m++) {
      sim.tick(1);
      traveler = sim.crowd.people.find((p) => p.mealVenueId === ff.id && p.state !== "dwelling");
    }
    expect(traveler).toBeDefined();
    // The venue fills while they travel (stamp the count at capacity, standing
    // in for other arrivals), so their arrival must NOT push past the cap.
    ff.customersIn = cap;
    for (let m = 0; m < 90; m++) {
      sim.tick(1);
      expect(ff.customersIn).toBe(cap);
      if (traveler!.state === "dwelling") break;
    }
    // Whether they made it to the table or gave up en route, they were never
    // counted: venueUnitId unset means finish() will not decrement either, so
    // the balanced-accounting contract holds around the clamp.
    expect(traveler!.venueUnitId).toBeUndefined();
  });

  it("a full venue attracts no new meal trips (spawn-side filter)", () => {
    const sim = officeAndFastFood();
    const ff = sim.tower.units.find((u) => u.kind === "fastFood")!;
    ff.customersIn = FACILITIES.fastFood.population; // full before lunch begins
    setHour(sim, 12);
    for (let m = 0; m < 60; m++) {
      sim.tick(1);
      expect(sim.crowd.people.some((p) => p.mealVenueId === ff.id)).toBe(false);
    }
  });
});
