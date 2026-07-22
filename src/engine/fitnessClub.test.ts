import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { GRID, FACILITIES } from "./facilities";
import { FITNESS_SUBTYPES, subtypeListFor } from "./retailSubtypes";
import { isCommercialKind } from "./facilityPredicates";
import { ECON } from "./econConfig";
import { CLASSIC_RULES, MODERN_RULES } from "./gameRules";
import { FITNESS_HALO_MAX, FITNESS_HALO_FLOORS } from "./sim/constants";
import { updateSatisfaction } from "./sim/satisfaction";
import { ledgerCatFor } from "./Ledger";
import type { GameMode, Unit } from "./types";

/**
 * Fitness Club: a Modern-only amenity from the Modern Expansion GDD. Unlike the
 * footfall containers, it earns a fixed occupancy-based MEMBERSHIP LEASE (like an
 * office pays rent, not a demand-pool footfall take), and it grants a capped,
 * distance-decayed satisfaction HALO to nearby condos. Modern-gated: a Classic
 * tower never has one, so Classic stays pixel-faithful (and its golden hash is
 * untouched, the halo seam returning 0 there).
 */

const C = Math.floor(GRID.width / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < GRID.width; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** A Modern tower with a lobby, floor 2, and a standard elevator serving it. */
function servedTower(mode: GameMode = "modern"): Simulation {
  const sim = new Simulation(4, mode);
  sim.money = 1_000_000_000;
  sim.star = 5;
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  sim.buildTransport("elevatorStandard", C, 1, 2);
  return sim;
}

describe("Fitness Club", () => {
  it("is a Modern-only lease amenity, not a footfall venue", () => {
    expect(FACILITIES.fitnessClub.modernOnly).toBe(true);
    expect(FACILITIES.fitnessClub.category).toBe("entertainment");
    // It earns a lease, not a demand-pool footfall take, so it is NOT commercial
    // (no W2 noise / W3 lobby-proximity income machinery), and it has a rent band.
    expect(isCommercialKind("fitnessClub")).toBe(false);
    expect(ECON.rent.fitnessClub).toBeDefined();
    expect(ECON.dailyTrafficIncome.fitnessClub).toBeUndefined();
  });

  it("gates behind its star: locked below minStar, never in Classic", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.fitnessClub.minStar - 1;
    expect(modern.isUnlocked("fitnessClub")).toBe(false);
    modern.star = FACILITIES.fitnessClub.minStar;
    expect(modern.isUnlocked("fitnessClub")).toBe(true);
    const classic = Simulation.newGame(1, "classic");
    classic.star = 5;
    expect(classic.isUnlocked("fitnessClub")).toBe(false);
  });

  it("refuses to build in a Classic tower", () => {
    const classic = servedTower("classic");
    expect(classic.build("fitnessClub", 2, C).ok).toBe(false);
  });

  it("builds in Modern and draws a format subtype from its roster", () => {
    const sim = servedTower();
    const built = sim.build("fitnessClub", 2, C);
    expect(built.ok, built.reason).toBe(true);
    const u = sim.tower.units.find((x) => x.kind === "fitnessClub");
    expect(u).toBeDefined();
    expect(subtypeListFor("fitnessClub")).toBe(FITNESS_SUBTYPES);
    expect([...FITNESS_SUBTYPES]).toContain(u!.subtype);
  });

  it("collects membership dues from a leased club (a lease, not footfall)", () => {
    const sim = servedTower();
    expect(sim.build("fitnessClub", 2, C).ok).toBe(true);
    const u = sim.tower.units.find((x) => x.kind === "fitnessClub")!;
    u.state = "occupied"; // leased
    const before = sim.money;
    sim.economy.collectRent();
    // Modern's quarterly scale is structurally 1 for the real-world calendar, so
    // the leased club pays its full dues.
    expect(sim.money - before).toBeGreaterThan(0);
    // A Classic tower has no such income line at all.
    expect(ECON.classicDailyTrafficIncome.fitnessClub).toBeUndefined();
  });

  it("an empty club earns nothing until it is leased", () => {
    const sim = servedTower();
    expect(sim.build("fitnessClub", 2, C).ok).toBe(true);
    const before = sim.money;
    sim.economy.collectRent(); // still "empty" (not tenanted)
    expect(sim.money).toBe(before);
  });

  it("its lease income and overhead both book to the entertainment line", () => {
    // Income banks to entertainment in collectRent; the ledger category must
    // agree so its overhead nets against it (not misfiled under upkeep).
    expect(ledgerCatFor("fitnessClub")).toBe("entertainment");
  });

  it("names 'rent' when gouged on its dues, not a misleading access cause", () => {
    // The advertised discipline: gouge the dues and the club sours. The gripe
    // attribution must name the real cause so the inspector/notice tells the
    // player to lower the price, not to fix routing.
    const sim = servedTower();
    expect(sim.build("fitnessClub", 2, C).ok).toBe(true);
    const club = sim.tower.units.find((x) => x.kind === "fitnessClub")!;
    club.state = "occupied";
    club.rent = ECON.rent.fitnessClub.max; // gouged
    expect(sim.dominantGripe(club)).toBe("rent");
    club.rent = ECON.rent.fitnessClub.default; // at the going rate: no self-inflicted gripe
    expect(sim.dominantGripe(club)).toBeNull();
  });
});

describe("Fitness Club amenity halo", () => {
  it("is capped, fades with floor distance, and is zero past its range", () => {
    // On the club's own floor it is the max; it decays linearly to zero at the
    // edge of the range and stays zero beyond.
    expect(MODERN_RULES.fitnessHaloBonus(0)).toBeCloseTo(FITNESS_HALO_MAX, 6);
    expect(MODERN_RULES.fitnessHaloBonus(2)).toBeGreaterThan(0);
    expect(MODERN_RULES.fitnessHaloBonus(2)).toBeLessThan(MODERN_RULES.fitnessHaloBonus(1));
    expect(MODERN_RULES.fitnessHaloBonus(FITNESS_HALO_FLOORS)).toBe(0);
    expect(MODERN_RULES.fitnessHaloBonus(FITNESS_HALO_FLOORS + 3)).toBe(0);
  });

  it("does not exist in Classic (the seam returns 0, keeping Classic byte-identical)", () => {
    expect(CLASSIC_RULES.fitnessHaloBonus(0)).toBe(0);
    expect(CLASSIC_RULES.fitnessHaloBonus(1)).toBe(0);
  });

  it("lifts a nearby condo's satisfaction more than a far one, only in Modern", () => {
    // A tall served tower with two condos: one on the club's floor, one well
    // beyond the halo range. Both start unhappy; one tick of recovery lifts both,
    // but the near condo also gets the halo, so it ends strictly higher.
    const sim = new Simulation(9, "modern");
    sim.money = 1_000_000_000;
    sim.star = 5;
    lay(sim, "lobby", 1);
    const topFloor = 2 + FITNESS_HALO_FLOORS + 4;
    for (let f = 2; f <= topFloor; f++) lay(sim, "floor", f);
    // A standard elevator stops at every floor in its span, so all these floors
    // are served (an express would stop only at lobbies).
    sim.buildTransport("elevatorStandard", C, 1, topFloor);
    const clubFloor = 2;
    const nearFloor = clubFloor + 1; // one floor away: still well inside the range
    const farFloor = 2 + FITNESS_HALO_FLOORS + 3; // safely outside the range
    expect(sim.build("fitnessClub", clubFloor, C).ok).toBe(true);
    const club = sim.tower.units.find((x) => x.kind === "fitnessClub")!;
    club.state = "occupied"; // an operational club grants the halo
    expect(sim.build("condo", nearFloor, C).ok).toBe(true);
    expect(sim.build("condo", farFloor, C).ok).toBe(true);
    const condoOn = (s: Simulation, floor: number): Unit => {
      const u = s.tower.units.find((x) => x.kind === "condo" && x.floor === floor)!;
      u.state = "occupied";
      u.satisfaction = 0.5;
      return u;
    };
    const nearU = condoOn(sim, nearFloor);
    const farU = condoOn(sim, farFloor);
    updateSatisfaction(sim);
    expect(nearU.satisfaction).toBeGreaterThan(farU.satisfaction);

    // The same layout in Classic gives no halo (and could not hold a club anyway),
    // so the two condos recover identically. Prove the seam, not the tower: a
    // Modern condo with the club vs one without differ only by the halo term.
    const control = new Simulation(9, "modern");
    control.money = 1_000_000_000;
    control.star = 5;
    lay(control, "lobby", 1);
    lay(control, "floor", clubFloor);
    lay(control, "floor", nearFloor);
    control.buildTransport("elevatorStandard", C, 1, nearFloor);
    expect(control.build("condo", nearFloor, C).ok).toBe(true);
    const loneU = condoOn(control, nearFloor);
    updateSatisfaction(control);
    // The near condo (with a club on its floor) beat the identical lone condo.
    expect(nearU.satisfaction).toBeGreaterThan(loneU.satisfaction);
  });
});
