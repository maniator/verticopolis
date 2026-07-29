import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { GRID, FACILITIES } from "./facilities";
import { spawnFloors } from "./crowd/spawn";
import { visibleOccupants } from "./crowd/person";
import { isTenanted } from "./types";
import { isRentalKind as isRental } from "./residentialRentals";
import type { GameMode } from "./types";

/**
 * Modern rental living, the CROWD half: a leased rental has to put real travelers in
 * the tower, because the census already charges its floor for the congestion they
 * cause. Split out of `rentalLiving.test.ts` when that file hit the size ceiling.
 *
 * Everything here guards one failure shape (#683): a floor sits in an origin pool but
 * yields no candidate when picked, so the trip option is spent and nobody spawns. That
 * both starves the rental itself and steals trips from the condos sharing the pool.
 */

const C = Math.floor(GRID.width / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < GRID.width; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** A Modern tower with a lobby, floor 2, and a standard elevator serving it, with the
 *  topology asserted so a silently degraded fixture cannot pass for the one described. */
function servedTower(mode: GameMode = "modern"): Simulation {
  const sim = new Simulation(4, mode);
  sim.money = 1_000_000_000;
  sim.star = 5;
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  expect(sim.tower.units.filter((u) => u.kind === "lobby" && u.floor === 1).length).toBe(GRID.width);
  expect(sim.buildTransport("elevatorStandard", C, 1, 2).ok).toBe(true);
  expect(sim.tower.isFloorServed(2)).toBe(true);
  return sim;
}

describe("Modern rental living: residents are real tower traffic", () => {
  it("a leased rental puts people in the tower, like a condo does", () => {
    // The residents count for population and stars and the census charges their
    // floor for elevator congestion, so if they never spawn as travelers the
    // tower bills a crowd it never renders. Measured against the condo, which is
    // the cadence rentals share, so this pins parity rather than a magic number.
    const peakCrowd = (kind: "condo" | "rentalApartment"): number => {
      const sim = servedTower();
      let peak = 0;
      const stride = FACILITIES[kind].width + 1; // derived, so a catalog change cannot silently overlap
      for (let i = 0; i < 8; i++) {
        const r = sim.build(kind, 2, C - stride * 4 + i * stride);
        expect(r.ok, `${kind} #${i}: ${r.reason}`).toBe(true);
      }
      for (const u of sim.tower.units.filter((x) => x.kind === kind)) {
        u.state = "occupied";
        u.occupants = FACILITIES[kind].population;
        u.residents = 3;
      }
      for (let m = 0; m < 24 * 60; m++) {
        sim.tick(1);
        peak = Math.max(peak, sim.crowd.people.filter((p) => p.state !== "done").length);
      }
      return peak;
    };
    const condoPeak = peakCrowd("condo");
    const rentalPeak = peakCrowd("rentalApartment");
    expect(condoPeak).toBeGreaterThan(0); // the control: this tower does generate a crowd
    expect(rentalPeak).toBeGreaterThan(0); // and so must the rental
    // The actual parity claim. Both runs seat 8 homes of 3 residents on the same
    // served tower, so the rental's crowd must be the condo's in scale, not merely
    // non-zero: a rental that spawned one traveler a day would clear "> 0" while
    // still billing a crowd it never renders, which is the bug this pins. The band
    // is wide because the spawn schedule is stochastic, but it cannot span an order
    // of magnitude, which is the failure mode that matters.
    expect(rentalPeak).toBeGreaterThan(condoPeak * 0.5);
    expect(rentalPeak).toBeLessThan(condoPeak * 2);
  });

  it("rental floors do not cannibalize the condos' meal trips (#683)", () => {
    // Rentals bin into `condoFloors` so they share the condo meal cadence, but every
    // per-unit filter downstream used to match only `condo`. `spawnMealOutbound` picks
    // a floor UNIFORMLY from that pool and then filters the picked floor's units: land
    // on a rental floor, get zero candidates, return. The option is spent and nothing
    // spawns. So rentals both generated no meal trips of their own AND diluted the
    // condos', which is a regression to shipped condo behavior rather than a gap in the
    // new feature. Measured before the fix: 3 extra condo floors gave 68 meal trips,
    // 3 extra rental floors gave 17, against a 34-trip baseline with neither.
    const mealTrips = (extra: "none" | "condo" | "rentalApartment"): number => {
      const sim = servedTower();
      for (let f = 3; f <= 6; f++) lay(sim, "floor", f);
      expect(sim.buildTransport("elevatorStandard", C + 4, 1, 6).ok).toBe(true);
      // The eateries every meal trip targets, on their own floor.
      expect(sim.build("restaurant", 3, C - 40).ok).toBe(true);
      expect(sim.build("fastFood", 3, C + 20).ok).toBe(true);
      const seat = (kind: "condo" | "rentalApartment", floor: number): void => {
        const stride = FACILITIES[kind].width + 1;
        for (let i = 0; i < 6; i++) expect(sim.build(kind, floor, C - stride * 3 + i * stride).ok).toBe(true);
      };
      seat("condo", 2); // the constant population whose trips must not be stolen
      if (extra !== "none") for (const f of [4, 5, 6]) seat(extra, f);
      for (const u of sim.tower.units.filter((x) => x.kind === "condo" || x.kind === "rentalApartment")) {
        u.state = "occupied";
        u.occupants = FACILITIES[u.kind].population;
        u.residents = 3;
      }
      const seen = new Set<number>();
      for (let m = 0; m < 24 * 60; m++) {
        sim.tick(1);
        for (const p of sim.crowd.people) if (p.mealVenueId) seen.add(p.id);
      }
      return seen.size;
    };
    const baseline = mealTrips("none");
    const withCondos = mealTrips("condo");
    const withRentals = mealTrips("rentalApartment");
    expect(baseline).toBeGreaterThan(0); // the fixture really does generate meal traffic
    // Adding residents must ADD trips, whichever kind they are.
    expect(withCondos).toBeGreaterThan(baseline);
    expect(withRentals).toBeGreaterThan(baseline);
    // And rental floors must pull their weight like condo floors do. Before the fix
    // this was the failing assertion: rentals came in far BELOW the baseline, because
    // they consumed options without spawning.
    expect(withRentals).toBeGreaterThan(withCondos * 0.5);
  });

  it("a Studio-only floor never burns a meal option it cannot fill (#683 daytime half)", () => {
    // `updatePresence` zeroes a tenanted Studio's occupants on a weekday daytime, and it
    // is the ONLY residential kind that does. The meal and visit candidate filters both
    // require a visible occupant, so binning a Studio floor by tenancy alone left the
    // pool naming floors that yield nothing at breakfast (6-9) and lunch (11-14): the
    // option is picked, filtered to zero, and returns having spawned nobody. Measured
    // before this fix: three Studio floors cut condo-origin meal trips from 32 to 17.
    const sim = servedTower();
    lay(sim, "floor", 3);
    expect(sim.buildTransport("elevatorStandard", C + 4, 1, 3).ok).toBe(true);
    const stride = FACILITIES.rentalStudio.width + 1;
    for (let i = 0; i < 4; i++) expect(sim.build("rentalStudio", 3, C - stride * 2 + i * stride).ok).toBe(true);
    for (const u of sim.tower.units.filter((x) => x.kind === "rentalStudio")) {
      u.state = "occupied";
      u.occupants = FACILITIES.rentalStudio.population;
    }
    // Walk the clock to a weekday lunch hour and re-derive presence, the state the
    // live sim is in when the bug bites.
    let guard = 0;
    while ((sim.clock.hour !== 12 || sim.clock.isWeekend) && guard++ < 20000) sim.tick(30);
    expect(sim.clock.hour, "reached a weekday noon").toBe(12);
    expect(sim.clock.isWeekend).toBe(false);
    const studios = sim.tower.units.filter((x) => x.kind === "rentalStudio");
    expect(studios.every((u) => isTenanted(u)), "still tenanted at noon").toBe(true);
    const floors = spawnFloors(sim.tower, sim.clock);
    // The premise: presence really has zeroed them, so they cannot supply a candidate.
    expect(studios.every((u) => visibleOccupants(u) === 0), "presence zeroed at noon").toBe(true);
    // So the floor must be OUT of the meal pool rather than in it yielding nothing.
    expect(floors.condoFloors).not.toContain(3);
  });

  it("an Apartment-only tower actually runs the school run (#683 consumer half)", () => {
    // The bin is only half the fix: `spawnSchoolDeparture` filters the picked floor's
    // units too, and that filter used to match condos alone. With an Apartment-only
    // tower the floor is picked and the filter yields nothing, so the option is spent
    // and no child leaves. Asserting bin membership cannot see that; only driving the
    // routine can, so this runs the clock and counts real school-run travelers.
    const sim = servedTower();
    const stride = FACILITIES.rentalApartment.width + 1;
    for (let i = 0; i < 5; i++) expect(sim.build("rentalApartment", 2, C - stride * 2 + i * stride).ok).toBe(true);
    expect(sim.tower.units.some((u) => u.kind === "condo"), "no condo anywhere").toBe(false);
    for (const u of sim.tower.units.filter((x) => x.kind === "rentalApartment")) {
      u.state = "occupied";
      u.occupants = FACILITIES.rentalApartment.population;
      u.residents = 3;
    }
    // Count DEPARTURES only. `spawnSchoolReturn` spawns unconditionally with no
    // candidate filter, so counting every schoolRun traveler stays green even with
    // the departure filter broken. A departure is the one that carries an
    // `originUnitId`, because it thins the room it left.
    const departures = new Set<number>();
    for (let m = 0; m < 3 * 24 * 60; m++) {
      sim.tick(1);
      for (const p of sim.crowd.people) {
        if (p.routine === "schoolRun" && p.originUnitId !== undefined) departures.add(p.id);
      }
    }
    expect(departures.size, "Apartment households send children out").toBeGreaterThan(0);
  });

  it("the school run skips the Studio, which has no household to send (#683)", () => {
    // `householdFloors` exists because the school run needs a rolled household and the
    // single-occupant Studio never has one. Binning Studios into the school pool would
    // reintroduce the same wasted-option bug the meal path just fixed.
    const sim = servedTower();
    lay(sim, "floor", 3);
    expect(sim.buildTransport("elevatorStandard", C + 4, 1, 3).ok).toBe(true);
    expect(sim.build("rentalStudio", 2, C).ok).toBe(true);
    expect(sim.build("rentalApartment", 3, C).ok).toBe(true);
    for (const u of sim.tower.units.filter((x) => isRental(x.kind))) {
      u.state = "occupied";
      u.occupants = FACILITIES[u.kind].population;
      u.residents = 3;
    }
    const floors = spawnFloors(sim.tower, sim.clock);
    expect(floors.condoFloors).toContain(2); // the Studio still eats
    expect(floors.condoFloors).toContain(3);
    expect(floors.householdFloors).not.toContain(2); // but sends no child
    expect(floors.householdFloors).toContain(3); // the Apartment does
  });
});
