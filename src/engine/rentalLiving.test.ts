import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { GRID, FACILITIES } from "./facilities";
import { collectMonthlyRent } from "./economy/rentalIncome";
import { spawnFloors } from "./crowd/spawn";
import { isRentalKind as isRental } from "./residentialRentals";
import { updateSatisfaction } from "./sim/satisfaction";
import { attemptMoveIns } from "./sim/churn";
import { VACATE_REASON_TEXT } from "./types";
import type { GameMode, Unit } from "./types";
import type { CalendarKind } from "./calendar";

/**
 * Modern rental living (Studio + Apartment), the GDD
 * `gdd-verticopolis-2026-07-23-modern-rental-living`. Two Modern-only residential
 * rentals: recurring MONTHLY rent (player-set) plus the shipped tenant-churn loop,
 * the cashflow counterpart to the condo's one-time sale. Classic stays condo-only.
 *
 * Epic 1 (catalog & placement): the two kinds exist, are Modern-only, and gate on
 * the hotel-style star climb (Studio at 2, Apartment at 3, mirroring single/double).
 */

const C = Math.floor(GRID.width / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < GRID.width; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** A Modern tower with a lobby, floor 2, and a standard elevator serving it.
 *  Asserts the topology every claim in this file rests on, per the house rule that
 *  a fixture must check its own construction: a silently degraded tower would test
 *  something other than the one described (an access failure reading as a drain). */
function servedTower(mode: GameMode = "modern", calendar?: CalendarKind): Simulation {
  const sim = new Simulation(4, mode, calendar);
  sim.money = 1_000_000_000;
  sim.star = 5;
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  expect(sim.tower.units.filter((u) => u.kind === "lobby" && u.floor === 1).length).toBe(GRID.width);
  expect(sim.tower.units.filter((u) => u.kind === "floor" && u.floor === 2).length).toBe(GRID.width);
  expect(sim.buildTransport("elevatorStandard", C, 1, 2).ok).toBe(true);
  expect(sim.tower.isFloorServed(2)).toBe(true);
  expect(sim.floorReachable(2)).toBe(true);
  return sim;
}

describe("Modern rental living: catalog and placement (Epic 1)", () => {
  it("are Modern-only residential kinds, staggered like the hotel single/double climb", () => {
    expect(FACILITIES.rentalStudio.modernOnly).toBe(true);
    expect(FACILITIES.rentalApartment.modernOnly).toBe(true);
    expect(FACILITIES.rentalStudio.category).toBe("residential");
    expect(FACILITIES.rentalApartment.category).toBe("residential");
    // Studio unlocks with the single (2), Apartment with the double (3).
    expect(FACILITIES.rentalStudio.minStar).toBe(FACILITIES.hotelSingle.minStar);
    expect(FACILITIES.rentalApartment.minStar).toBe(FACILITIES.hotelDouble.minStar);
    // The Apartment is the larger, pricier tier, like double over single.
    expect(FACILITIES.rentalApartment.width).toBeGreaterThan(FACILITIES.rentalStudio.width);
    expect(FACILITIES.rentalApartment.cost).toBeGreaterThan(FACILITIES.rentalStudio.cost);
  });

  it("gate behind their star: locked below minStar, unlocked at it, never in Classic", () => {
    for (const kind of ["rentalStudio", "rentalApartment"] as const) {
      const modern = Simulation.newGame(1, "modern");
      modern.star = FACILITIES[kind].minStar - 1;
      expect(modern.isUnlocked(kind), `${kind} locked below star`).toBe(false);
      modern.star = FACILITIES[kind].minStar;
      expect(modern.isUnlocked(kind), `${kind} unlocked at star`).toBe(true);
      const classic = Simulation.newGame(1, "classic");
      classic.star = 5;
      expect(classic.isUnlocked(kind), `${kind} never in Classic`).toBe(false);
    }
  });

  it("refuse to build in a Classic tower", () => {
    const classic = servedTower("classic");
    expect(classic.build("rentalStudio", 2, C).ok).toBe(false);
    expect(classic.build("rentalApartment", 2, C).ok).toBe(false);
  });

  it("build in a Modern tower at or above their star", () => {
    const sim = servedTower();
    const studio = sim.build("rentalStudio", 2, C);
    expect(studio.ok, studio.reason).toBe(true);
    const apt = sim.build("rentalApartment", 2, C - 20);
    expect(apt.ok, apt.reason).toBe(true);
    expect(sim.tower.units.some((u) => u.kind === "rentalStudio")).toBe(true);
    expect(sim.tower.units.some((u) => u.kind === "rentalApartment")).toBe(true);
  });
});

describe("Modern rental living: monthly rent (Epic 2)", () => {
  it("an occupied, served rental pays its set rent monthly; a vacant one pays nothing", () => {
    const sim = servedTower();
    sim.build("rentalStudio", 2, C);
    const u = sim.tower.units.find((x) => x.kind === "rentalStudio")!;

    // Vacant (on-market): collects nothing.
    u.state = "empty";
    const before = sim.money;
    collectMonthlyRent(sim);
    expect(sim.money).toBe(before);

    // Occupied at the default studio rent: one month collects that rent.
    u.state = "occupied";
    u.rent = undefined; // default
    const at = sim.money;
    collectMonthlyRent(sim);
    expect(sim.money - at).toBe(2_000); // ECON.rent.rentalStudio.default
  });

  it("the player-set rent drives the income (office-style price band)", () => {
    const sim = servedTower();
    sim.build("rentalApartment", 2, C);
    const u = sim.tower.units.find((x) => x.kind === "rentalApartment")!;
    u.state = "occupied";
    u.rent = 8_000; // top of the apartment band
    const at = sim.money;
    collectMonthlyRent(sim);
    expect(sim.money - at).toBe(8_000);
  });

  it("scales with the calendar, so the pace toggle never changes income per in-game day", () => {
    // The invariance payMaintenance and the office collectRent already hold. The
    // canon calendar's maintenance period is 3 days against real-world's 30, so it
    // collects ten times as often and must bank a tenth each time. Without the
    // scale a canon-calendar Modern tower earns rental income at 10x.
    const realWorld = servedTower("modern", "realWorld");
    realWorld.build("rentalStudio", 2, C);
    realWorld.tower.units.find((x) => x.kind === "rentalStudio")!.state = "occupied";
    const rwAt = realWorld.money;
    collectMonthlyRent(realWorld);
    const rwGain = realWorld.money - rwAt;

    const canon = servedTower("modern", "canon");
    canon.build("rentalStudio", 2, C);
    canon.tower.units.find((x) => x.kind === "rentalStudio")!.state = "occupied";
    const cAt = canon.money;
    collectMonthlyRent(canon);
    const cGain = canon.money - cAt;

    expect(rwGain).toBe(2_000); // the full band default over a 30-day period
    const ratio = canon.clock.calendar.maintPeriodDays / realWorld.clock.calendar.maintPeriodDays;
    expect(cGain).toBe(Math.round(rwGain * ratio)); // same income per in-game day
    expect(cGain).toBeLessThan(rwGain); // and the collection really is the smaller one
  });

  it("rent is monthly, not quarterly: collectRent (quarterly) never touches a rental", () => {
    const sim = servedTower();
    sim.build("rentalStudio", 2, C);
    const u = sim.tower.units.find((x) => x.kind === "rentalStudio")!;
    u.state = "occupied";
    const at = sim.money;
    sim.economy.collectRent(); // the office quarterly path
    expect(sim.money).toBe(at); // rentals are not a quarterly lease kind
  });
});

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
    // condos', which is a regression to shipped condo behavior, not just a gap in the
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

describe("Modern rental living: churn and re-lease (Epic 3)", () => {
  it("a rental leases (no sale): occupied, everOccupied, counted; the Apartment gets a household", () => {
    const sim = servedTower();
    sim.build("rentalStudio", 2, C);
    sim.build("rentalApartment", 2, C - 20);
    const studio = sim.tower.units.find((x) => x.kind === "rentalStudio")!;
    const apt = sim.tower.units.find((x) => x.kind === "rentalApartment")!;
    const money = sim.money;

    sim.moveIn(studio);
    sim.moveIn(apt);
    expect(studio.state).toBe("occupied");
    expect(studio.everOccupied).toBe(true);
    expect(studio.residents).toBeUndefined(); // fixed single occupant, no household
    expect(apt.residents).toBeGreaterThanOrEqual(2); // a varied household, condo-style
    expect(apt.residents).toBeLessThanOrEqual(5);
    expect(sim.moveInsToday.rentals).toBe(2);
    expect(sim.money).toBe(money); // a rental leases, it does NOT pay a sale windfall
  });

  it("a vacant, served, reachable rental re-leases over time (mirrors the office)", () => {
    const sim = servedTower();
    sim.build("rentalStudio", 2, C);
    const u = sim.tower.units.find((x) => x.kind === "rentalStudio")!;
    u.state = "empty"; // construction complete, on-market
    let filled = false;
    for (let i = 0; i < 500 && !filled; i++) {
      attemptMoveIns(sim);
      filled = (u.state as string) === "occupied";
    }
    expect(filled).toBe(true);
  });

  it("the Apartment is more demanding than the Studio: same noise, the Apartment erodes faster", () => {
    // An office next door is a noise source for a home (nearestKindWithin: office
    // or commercial). Both rentals sit within the noise band on the served floor,
    // spaced so none overlaps the 9-wide office.
    const sim = servedTower();
    sim.build("office", 2, C);
    sim.build("rentalStudio", 2, C + 12);
    sim.build("rentalApartment", 2, C - 14);
    const studio = sim.tower.units.find((x) => x.kind === "rentalStudio")!;
    const apt = sim.tower.units.find((x) => x.kind === "rentalApartment")!;
    sim.moveIn(studio);
    sim.moveIn(apt);
    // Both are freshly satisfied; erode them under the same noise for a while. In
    // this bare tower (no retail, near the lobby, near the center shaft) the
    // Apartment's OTHER drains (unmet demand, lobby distance, far walk) are all
    // neutral, so the ONLY difference driving the gap is the noise-erosion rate:
    // the Studio's gentle CONDO_NOISE_EROSION vs the Apartment's steep NOISE_EROSION.
    for (let i = 0; i < 40; i++) updateSatisfaction(sim);
    // The forgiving Studio barely erodes while the demanding Apartment craters: a
    // wide gap, not just apt < studio, so the assertion actually guards the split.
    expect(studio.satisfaction).toBeGreaterThan(0.3);
    expect(apt.satisfaction).toBeLessThan(studio.satisfaction - 0.2);
  });

  it("the forgiving Studio only SOURS on an over-market rent, it never leaves (unlike the Apartment)", () => {
    // A lone, well-served Studio at the top of its band. Its narrow default:max
    // ratio means the rent erosion never out-paces the served recovery, so it
    // trends up, not down: satisfaction dips below full (soured) but it never
    // crosses the vacate threshold. This pins the GDD's forgiving-Studio contract,
    // the counterpart to the Apartment's rent-driven eviction above.
    const sim = servedTower();
    sim.build("rentalStudio", 2, C);
    const u = sim.tower.units.find((x) => x.kind === "rentalStudio")!;
    sim.moveIn(u);
    u.rent = 3_000; // top of the studio band
    for (let i = 0; i < 300; i++) updateSatisfaction(sim);
    expect(u.state).toBe("occupied"); // never gives notice for rent
    expect(u.satisfaction).toBeLessThan(1); // but it is soured (the rent is felt)
    expect(u.satisfaction).toBeGreaterThan(0.8); // gently, the forgiving read
  });

  it("the reversible loop: over-market rent drives notice ('rent'), a rent cut rescinds it", () => {
    // A lone Apartment (served, near the lobby, no noise) so its ONLY affliction is
    // the rent it is priced at, isolating the GDD's "rent too high" cause.
    const sim = servedTower();
    sim.build("rentalApartment", 2, C);
    const u = sim.tower.units.find((x) => x.kind === "rentalApartment")!;
    sim.moveIn(u);

    // Gouge to the top of the band: erosion out-paces the served recovery, so it
    // trends down and eventually gives notice, attributed to rent.
    u.rent = 8_000;
    for (let i = 0; i < 200 && u.state !== "vacating"; i++) updateSatisfaction(sim);
    expect(u.state).toBe("vacating");
    expect(u.vacateReason).toBe("rent");

    // Cut the rent back to the default: no over-market erosion, so recovery lifts
    // it back above the rescind bar and the tenant quietly stays.
    u.rent = 4_000;
    for (let i = 0; i < 60 && u.state !== "occupied"; i++) updateSatisfaction(sim);
    expect(u.state).toBe("occupied");
    expect(u.vacateReason).toBeUndefined();
  });

  it("#502: a far-from-transport Apartment churns ('transportFar'); the Studio is exempt", () => {
    // The tower's only shaft is at the center; place both rentals at the far edge,
    // beyond the walking tolerance from it, on the served floor.
    const sim = servedTower();
    sim.build("rentalApartment", 2, 2);
    sim.build("rentalStudio", 2, 14);
    const apt = sim.tower.units.find((x) => x.kind === "rentalApartment")!;
    const studio = sim.tower.units.find((x) => x.kind === "rentalStudio")!;
    sim.moveIn(apt);
    sim.moveIn(studio);
    for (let i = 0; i < 200 && apt.state !== "vacating"; i++) updateSatisfaction(sim);
    // The demanding Apartment feels the far-walk transport erosion and gives notice;
    // the forgiving Studio, exempt from #502, stays put in the identical spot.
    expect(apt.state).toBe("vacating");
    expect(apt.vacateReason).toBe("transportFar");
    expect(studio.state).toBe("occupied");
  });

  it("a departed rental goes dark (no sale windfall/clawback) and can re-lease", () => {
    const sim = servedTower();
    sim.build("rentalStudio", 2, C);
    const u = sim.tower.units.find((x) => x.kind === "rentalStudio")! as Unit;
    sim.moveIn(u);
    const money = sim.money;
    sim.vacate(u, "noise");
    expect(u.state).toBe("empty"); // dark, on-market again
    expect(sim.money).toBe(money); // rentals never buy back (unlike the condo)
    // ...and it can fill again.
    let filled = false;
    for (let i = 0; i < 500 && !filled; i++) {
      attemptMoveIns(sim);
      filled = u.state === "occupied";
    }
    expect(filled).toBe(true);
  });
});

describe("Modern rental living: legibility, population and save (Epics 6-8)", () => {
  it("Epic 6: a rental departure names a legible cause (mapped to player copy)", () => {
    const sim = servedTower();
    sim.build("rentalApartment", 2, C);
    const u = sim.tower.units.find((x) => x.kind === "rentalApartment")!;
    sim.moveIn(u);
    u.rent = 8_000; // over-market -> notice, reason "rent"
    for (let i = 0; i < 200 && u.state !== "vacating"; i++) updateSatisfaction(sim);
    expect(u.state).toBe("vacating");
    // The reason resolves to non-empty player copy (no mystery drain).
    expect(u.vacateReason).toBeDefined();
    expect(VACATE_REASON_TEXT[u.vacateReason!].length).toBeGreaterThan(0);
  });

  it("Epic 7: an occupied rental adds population; the Apartment counts its whole household", () => {
    const sim = servedTower();
    sim.build("rentalApartment", 2, C);
    const u = sim.tower.units.find((x) => x.kind === "rentalApartment")!;
    const before = sim.tower.totalPopulation();
    sim.moveIn(u); // leases and rolls a household
    const added = sim.tower.totalPopulation() - before;
    expect(added).toBe(u.residents); // the whole household, not the flat catalog count
    expect(added).toBeGreaterThanOrEqual(2);
  });

  it("Epic 8: a save round-trips occupancy, per-unit rent, the household, and a pending notice", () => {
    const sim = servedTower();
    sim.build("rentalStudio", 2, C);
    sim.build("rentalApartment", 2, C - 20);
    const studio = sim.tower.units.find((x) => x.kind === "rentalStudio")!;
    const apt = sim.tower.units.find((x) => x.kind === "rentalApartment")!;
    sim.moveIn(studio);
    studio.rent = 2_500;
    sim.moveIn(apt);
    apt.rent = 6_000;
    const aptResidents = apt.residents;
    // Put the Apartment on notice so the vacancy bookkeeping is exercised.
    apt.state = "vacating";
    apt.vacateReason = "noise";
    apt.vacateAt = 12_345;

    const loaded = Simulation.deserialize(sim.serialize());
    const ls = loaded.tower.units.find((u) => u.kind === "rentalStudio")!;
    const la = loaded.tower.units.find((u) => u.kind === "rentalApartment")!;
    expect(ls.state).toBe("occupied");
    expect(ls.rent).toBe(2_500);
    expect(ls.residents).toBeUndefined(); // Studio never stores a household
    expect(la.state).toBe("vacating");
    expect(la.rent).toBe(6_000);
    expect(la.vacateReason).toBe("noise");
    // Epic 8 names the notice TIMER alongside the reason: it is the rescind window
    // the player is racing, so losing it across a save would silently reset or
    // expire the grace period a tenant was mid-way through.
    expect(la.vacateAt).toBe(12_345);
    expect(la.residents).toBe(aptResidents);
  });
});
