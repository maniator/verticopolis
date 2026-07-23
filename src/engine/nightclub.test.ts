import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { GRID, FACILITIES } from "./facilities";
import { isCommercialKind, isOpenAt } from "./facilityPredicates";
import { ECON } from "./econConfig";
import { CLASSIC_RULES, MODERN_RULES } from "./gameRules";
import { NIGHTCLUB_NOISE_MAX, NIGHTCLUB_NOISE_FLOORS } from "./sim/constants";
import { updateSatisfaction } from "./sim/satisfaction";
import type { Unit } from "./types";

/**
 * Nightclub: a Track-2 showpiece from the Modern Expansion GDD. A singular venue
 * (no subtypes) with three mechanics: it earns from foot traffic NIGHT-only, pays
 * a monthly DJ booking, and imposes a NEGATIVE halo (a satisfaction penalty) on
 * nearby sleeping tenants, the placement tension. Modern-gated: Classic never has
 * one, so Classic stays pixel-faithful and its golden hash is untouched (the
 * penalty seam returns 0 there and the fixture builds no club).
 */

const C = Math.floor(GRID.width / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < GRID.width; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

function servedTower(mode: "classic" | "modern" = "modern", topFloor = 2): Simulation {
  const sim = new Simulation(7, mode);
  sim.money = 1_000_000_000;
  sim.star = 5;
  lay(sim, "lobby", 1);
  for (let f = 2; f <= topFloor; f++) lay(sim, "floor", f);
  sim.buildTransport("elevatorStandard", C, 1, topFloor);
  return sim;
}

describe("Nightclub", () => {
  it("is a Modern-only night footfall venue", () => {
    expect(FACILITIES.nightclub.modernOnly).toBe(true);
    expect(FACILITIES.nightclub.category).toBe("entertainment");
    expect(isCommercialKind("nightclub")).toBe(true);
    expect(ECON.dailyTrafficIncome.nightclub).toBeGreaterThan(0);
    expect(ECON.classicDailyTrafficIncome.nightclub).toBeUndefined();
  });

  it("gates behind its star: locked below minStar, never in Classic", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.nightclub.minStar - 1;
    expect(modern.isUnlocked("nightclub")).toBe(false);
    modern.star = FACILITIES.nightclub.minStar;
    expect(modern.isUnlocked("nightclub")).toBe(true);
    const classic = Simulation.newGame(1, "classic");
    classic.star = 5;
    expect(classic.isUnlocked("nightclub")).toBe(false);
  });

  it("is open at night and closed by day", () => {
    expect(isOpenAt("nightclub", 12)).toBe(false); // midday: dark
    expect(isOpenAt("nightclub", 21)).toBe(true); // night: open
    expect(isOpenAt("nightclub", 1)).toBe(true); // small hours: still open
    expect(isOpenAt("nightclub", 8)).toBe(false); // morning: closed
  });

  it("pays a monthly DJ booking when operational", () => {
    const sim = servedTower();
    expect(sim.build("nightclub", 2, C).ok).toBe(true);
    const u = sim.tower.units.find((x) => x.kind === "nightclub")!;
    u.state = "occupied"; // operational
    const before = sim.money;
    sim.economy.payMaintenance();
    // The DJ booking is charged (overhead may add more on top).
    expect(before - sim.money).toBeGreaterThanOrEqual(ECON.nightclubDjMonthly);
  });
});

describe("Nightclub negative halo (placement tension)", () => {
  it("is a capped penalty that fades with distance and is zero past its range", () => {
    expect(MODERN_RULES.nightclubNoisePenalty(0)).toBeCloseTo(NIGHTCLUB_NOISE_MAX, 6);
    expect(MODERN_RULES.nightclubNoisePenalty(2)).toBeGreaterThan(0);
    expect(MODERN_RULES.nightclubNoisePenalty(2)).toBeLessThan(MODERN_RULES.nightclubNoisePenalty(1));
    expect(MODERN_RULES.nightclubNoisePenalty(NIGHTCLUB_NOISE_FLOORS)).toBe(0);
    // Its worst case exceeds the served recovery, so a home right by a club
    // net-declines: the placement tension is real.
    expect(NIGHTCLUB_NOISE_MAX).toBeGreaterThan(0.05);
  });

  it("does not exist in Classic (the seam returns 0, keeping Classic byte-identical)", () => {
    expect(CLASSIC_RULES.nightclubNoisePenalty(0)).toBe(0);
    expect(CLASSIC_RULES.nightclubNoisePenalty(1)).toBe(0);
  });

  it("drops a nearby condo's satisfaction, only in Modern (vs an identical control)", () => {
    // Two identical Modern towers: a condo one floor above a nightclub, and the
    // same condo with no club. Same floor, so lobby distance and every other
    // drain match; only the nightclub differs. The club condo ends strictly lower.
    const clubFloor = 2;
    const condoFloor = clubFloor + 1; // inside the noise range
    const build = (withClub: boolean): Unit => {
      const sim = servedTower("modern", condoFloor);
      if (withClub) {
        expect(sim.build("nightclub", clubFloor, C).ok).toBe(true);
        sim.tower.units.find((x) => x.kind === "nightclub")!.state = "occupied";
      }
      expect(sim.build("condo", condoFloor, C).ok).toBe(true);
      const u = sim.tower.units.find((x) => x.kind === "condo")!;
      u.state = "occupied";
      u.satisfaction = 1;
      updateSatisfaction(sim);
      return u;
    };
    expect(build(true).satisfaction).toBeLessThan(build(false).satisfaction);
  });

  it("names 'noise' as the departure cause for a home next to a nightclub", () => {
    const sim = servedTower("modern", 3);
    expect(sim.build("nightclub", 2, C).ok).toBe(true);
    const club = sim.tower.units.find((x) => x.kind === "nightclub")!;
    club.state = "occupied";
    expect(sim.build("condo", 3, C).ok).toBe(true); // one floor up, inside the range
    const condo = sim.tower.units.find((x) => x.kind === "condo")!;
    condo.state = "occupied";
    expect(sim.dominantGripe(condo)).toBe("noise");
  });
});
