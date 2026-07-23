import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { GRID, FACILITIES } from "./facilities";
import { isCommercialKind, isOpenAt } from "./facilityPredicates";
import { ECON } from "./econConfig";
import { CLASSIC_RULES, MODERN_RULES } from "./gameRules";
import { DAYCARE_HALO_MAX, DAYCARE_HALO_FLOORS } from "./sim/constants";
import { updateSatisfaction } from "./sim/satisfaction";
import type { Unit } from "./types";

/**
 * Daycare: a Track-2 showpiece from the Modern Expansion GDD. A singular footfall
 * venue (parents dropping off and collecting kids) whose distinctive mechanic is a
 * positive condo halo SCALED BY FAMILY SIZE: a bigger household, which leans on
 * childcare more, is lifted more. It is also the one footfall venue that is BUSIER
 * ON WEEKDAYS (working parents), not weekends. Modern-gated: Classic never has one,
 * so Classic stays pixel-faithful and its golden hash is untouched (the halo seam
 * returns 0 there and the fixture builds no daycare).
 */

const C = Math.floor(GRID.width / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < GRID.width; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

function servedTower(topFloor = 2): Simulation {
  const sim = new Simulation(7, "modern");
  sim.money = 1_000_000_000;
  sim.star = 5;
  lay(sim, "lobby", 1);
  for (let f = 2; f <= topFloor; f++) lay(sim, "floor", f);
  sim.buildTransport("elevatorStandard", C, 1, topFloor);
  return sim;
}

describe("Daycare", () => {
  it("is a Modern-only footfall venue, busiest on weekdays", () => {
    expect(FACILITIES.daycare.modernOnly).toBe(true);
    expect(isCommercialKind("daycare")).toBe(true);
    expect(ECON.dailyTrafficIncome.daycare).toBeGreaterThan(0);
    expect(ECON.classicDailyTrafficIncome.daycare).toBeUndefined();
    // Unlike the leisure venues, a daycare QUIETS on the weekend (parents are home).
    expect(ECON.weekendTrafficMultiplier.daycare).toBeLessThan(1);
  });

  it("gates behind its star: locked below minStar, never in Classic", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.daycare.minStar - 1;
    expect(modern.isUnlocked("daycare")).toBe(false);
    modern.star = FACILITIES.daycare.minStar;
    expect(modern.isUnlocked("daycare")).toBe(true);
    const classic = Simulation.newGame(1, "classic");
    classic.star = 5;
    expect(classic.isUnlocked("daycare")).toBe(false);
  });

  it("keeps working-day childcare hours (open 7am to 7pm)", () => {
    expect(isOpenAt("daycare", 6)).toBe(false); // before opening
    expect(isOpenAt("daycare", 7)).toBe(true); // opens 7am
    expect(isOpenAt("daycare", 15)).toBe(true); // afternoon: open
    expect(isOpenAt("daycare", 19)).toBe(false); // closes at 7pm
  });
});

describe("Daycare family halo", () => {
  it("scales with family size: a lone occupant gets nothing, a big family gets the most", () => {
    expect(MODERN_RULES.daycareFamilyBonus(0, 1)).toBe(0); // a family of one leans on no childcare
    const small = MODERN_RULES.daycareFamilyBonus(0, 2);
    const big = MODERN_RULES.daycareFamilyBonus(0, 5);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small); // a bigger family benefits more
    expect(big).toBeCloseTo(DAYCARE_HALO_MAX, 6); // the biggest family on the daycare's floor reaches the cap
  });

  it("fades with distance and is zero past its range", () => {
    expect(MODERN_RULES.daycareFamilyBonus(2, 5)).toBeGreaterThan(0);
    expect(MODERN_RULES.daycareFamilyBonus(2, 5)).toBeLessThan(MODERN_RULES.daycareFamilyBonus(1, 5));
    expect(MODERN_RULES.daycareFamilyBonus(DAYCARE_HALO_FLOORS, 5)).toBe(0);
  });

  it("does not exist in Classic (the seam returns 0, keeping Classic byte-identical)", () => {
    expect(CLASSIC_RULES.daycareFamilyBonus(0, 5)).toBe(0);
    expect(CLASSIC_RULES.daycareFamilyBonus(1, 2)).toBe(0);
  });

  it("lifts a nearby big-family condo more than a small-family one (vs a no-daycare control)", () => {
    // Same-floor condo one story above a daycare, at family sizes 2 and 5, each
    // compared against the identical tower with no daycare. Bigger family, bigger lift.
    const daycareFloor = 2;
    const condoFloor = daycareFloor + 1; // inside the halo range
    const lift = (familySize: number): number => {
      const build = (withDaycare: boolean): Unit => {
        const sim = servedTower(condoFloor);
        if (withDaycare) {
          expect(sim.build("daycare", daycareFloor, C).ok).toBe(true);
          sim.tower.units.find((x) => x.kind === "daycare")!.state = "occupied";
        }
        expect(sim.build("condo", condoFloor, C).ok).toBe(true);
        const u = sim.tower.units.find((x) => x.kind === "condo")!;
        u.state = "occupied";
        u.occupants = familySize;
        u.residents = familySize;
        u.satisfaction = 0.5; // headroom for the positive bonus to show
        updateSatisfaction(sim);
        return u;
      };
      return build(true).satisfaction - build(false).satisfaction;
    };
    const smallLift = lift(2);
    const bigLift = lift(5);
    expect(smallLift).toBeGreaterThan(0);
    expect(bigLift).toBeGreaterThan(smallLift);
  });

  it("leaves hotels untouched (the family halo is condos-only)", () => {
    const daycareFloor = 2;
    const roomFloor = daycareFloor + 1;
    const build = (withDaycare: boolean): Unit => {
      const sim = servedTower(roomFloor);
      if (withDaycare) {
        expect(sim.build("daycare", daycareFloor, C).ok).toBe(true);
        sim.tower.units.find((x) => x.kind === "daycare")!.state = "occupied";
      }
      expect(sim.build("hotelSingle", roomFloor, C).ok).toBe(true);
      const u = sim.tower.units.find((x) => x.kind === "hotelSingle")!;
      u.state = "occupied";
      u.occupants = FACILITIES.hotelSingle.population;
      u.satisfaction = 0.5;
      updateSatisfaction(sim);
      return u;
    };
    expect(build(true).satisfaction).toBeCloseTo(build(false).satisfaction, 6);
  });
});
