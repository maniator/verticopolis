import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { GRID, FACILITIES } from "./facilities";
import { isCommercialKind, isOpenAt } from "./facilityPredicates";
import { ECON } from "./econConfig";
import { CLASSIC_RULES, MODERN_RULES } from "./gameRules";
import { SPA_SERENITY_MAX, SPA_SERENITY_FLOORS } from "./sim/constants";
import { updateSatisfaction } from "./sim/satisfaction";
import type { Unit } from "./types";

/**
 * Spa: a Track-2 showpiece from the Modern Expansion GDD. A singular venue (no
 * subtypes) with two mechanics: it earns from daytime foot traffic (busier on
 * weekends), and it imposes a POSITIVE halo (a serenity bonus) on nearby HOTEL
 * rooms, the mirror of the Fitness Club's condo halo. Modern-gated: Classic never
 * has one, so Classic stays pixel-faithful and its golden hash is untouched (the
 * bonus seam returns 0 there and the fixture builds no spa).
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

describe("Spa", () => {
  it("is a Modern-only daytime footfall venue", () => {
    expect(FACILITIES.spa.modernOnly).toBe(true);
    expect(FACILITIES.spa.category).toBe("entertainment");
    expect(isCommercialKind("spa")).toBe(true);
    expect(ECON.dailyTrafficIncome.spa).toBeGreaterThan(0);
    expect(ECON.classicDailyTrafficIncome.spa).toBeUndefined();
  });

  it("gates behind its star: locked below minStar, never in Classic", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.spa.minStar - 1;
    expect(modern.isUnlocked("spa")).toBe(false);
    modern.star = FACILITIES.spa.minStar;
    expect(modern.isUnlocked("spa")).toBe(true);
    const classic = Simulation.newGame(1, "classic");
    classic.star = 5;
    expect(classic.isUnlocked("spa")).toBe(false);
  });

  it("is open by day and closed overnight", () => {
    expect(isOpenAt("spa", 12)).toBe(true); // midday: open
    expect(isOpenAt("spa", 9)).toBe(true); // opening hour
    expect(isOpenAt("spa", 21)).toBe(false); // closes at 9pm
    expect(isOpenAt("spa", 3)).toBe(false); // small hours: closed
  });

  it("earns daytime foot-traffic income in Modern and nothing in Classic", () => {
    expect(MODERN_RULES.commercialDailyIncome("spa")).toBe(ECON.dailyTrafficIncome.spa);
    expect(CLASSIC_RULES.commercialDailyIncome("spa")).toBeUndefined();
  });
});

describe("Spa serenity halo (hotel amenity)", () => {
  it("is a capped bonus that fades with distance and is zero past its range", () => {
    expect(MODERN_RULES.spaSerenityBonus(0)).toBeCloseTo(SPA_SERENITY_MAX, 6);
    expect(MODERN_RULES.spaSerenityBonus(2)).toBeGreaterThan(0);
    expect(MODERN_RULES.spaSerenityBonus(2)).toBeLessThan(MODERN_RULES.spaSerenityBonus(1));
    expect(MODERN_RULES.spaSerenityBonus(SPA_SERENITY_FLOORS)).toBe(0);
    // A garnish on recovery, never a substitute for it: below served recovery so
    // a spa can lift a happy guest but not rescue an unserved one.
    expect(SPA_SERENITY_MAX).toBeLessThan(0.05);
  });

  it("does not exist in Classic (the seam returns 0, keeping Classic byte-identical)", () => {
    expect(CLASSIC_RULES.spaSerenityBonus(0)).toBe(0);
    expect(CLASSIC_RULES.spaSerenityBonus(1)).toBe(0);
  });

  it("lifts a nearby hotel room's satisfaction, only in Modern (vs an identical control)", () => {
    // Two identical Modern towers: a hotel room one floor above a spa, and the
    // same room with no spa. Same floor, so lobby distance and every other input
    // match; only the spa differs. The spa room ends strictly higher. The room
    // starts below 1 so the positive bonus has headroom to show (a room already
    // at full satisfaction would clamp to 1 in both).
    const spaFloor = 2;
    const roomFloor = spaFloor + 1; // inside the serenity range
    const build = (withSpa: boolean): Unit => {
      const sim = servedTower("modern", roomFloor);
      if (withSpa) {
        expect(sim.build("spa", spaFloor, C).ok).toBe(true);
        sim.tower.units.find((x) => x.kind === "spa")!.state = "occupied";
      }
      expect(sim.build("hotelSingle", roomFloor, C).ok).toBe(true);
      const u = sim.tower.units.find((x) => x.kind === "hotelSingle")!;
      u.state = "occupied";
      u.satisfaction = 0.5;
      updateSatisfaction(sim);
      return u;
    };
    expect(build(true).satisfaction).toBeGreaterThan(build(false).satisfaction);
  });

  it("leaves condos untouched (the serenity halo is hotels-only)", () => {
    // The mirror of the fitness halo, which is condos-only: a condo next to a spa
    // gets no spa bonus (a spa with no club present must not lift a condo).
    const spaFloor = 2;
    const condoFloor = spaFloor + 1;
    const build = (withSpa: boolean): Unit => {
      const sim = servedTower("modern", condoFloor);
      if (withSpa) {
        expect(sim.build("spa", spaFloor, C).ok).toBe(true);
        sim.tower.units.find((x) => x.kind === "spa")!.state = "occupied";
      }
      expect(sim.build("condo", condoFloor, C).ok).toBe(true);
      const u = sim.tower.units.find((x) => x.kind === "condo")!;
      u.state = "occupied";
      u.satisfaction = 0.5;
      updateSatisfaction(sim);
      return u;
    };
    expect(build(true).satisfaction).toBeCloseTo(build(false).satisfaction, 6);
  });
});
