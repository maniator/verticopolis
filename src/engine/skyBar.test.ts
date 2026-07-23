import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { Clock } from "./Clock";
import { GRID, FACILITIES } from "./facilities";
import { isCommercialKind, isOpenAt } from "./facilityPredicates";
import { ECON } from "./econConfig";
import { CLASSIC_RULES, MODERN_RULES } from "./gameRules";

/**
 * Sky Bar: a Track-2 showpiece from the Modern Expansion GDD. A singular venue (no
 * subtypes) whose mechanic is a "view premium": it earns from evening foot traffic
 * like the other footfall venues, but the higher you place it the more it pours,
 * because the skyline view is the draw. Modern-gated: Classic never has one, so
 * Classic stays pixel-faithful and its golden hash is untouched (the premium seam
 * returns 1 there and the fixture builds no bar).
 */

const C = Math.floor(GRID.width / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < GRID.width; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

describe("Sky Bar", () => {
  it("is a Modern-only evening footfall venue", () => {
    expect(FACILITIES.skyBar.modernOnly).toBe(true);
    expect(FACILITIES.skyBar.category).toBe("entertainment");
    expect(isCommercialKind("skyBar")).toBe(true);
    expect(ECON.dailyTrafficIncome.skyBar).toBeGreaterThan(0);
    expect(ECON.classicDailyTrafficIncome.skyBar).toBeUndefined();
  });

  it("gates behind its star: locked below minStar, never in Classic", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.skyBar.minStar - 1;
    expect(modern.isUnlocked("skyBar")).toBe(false);
    modern.star = FACILITIES.skyBar.minStar;
    expect(modern.isUnlocked("skyBar")).toBe(true);
    const classic = Simulation.newGame(1, "classic");
    classic.star = 5;
    expect(classic.isUnlocked("skyBar")).toBe(false);
  });

  it("keeps evening hours (open late afternoon to midnight)", () => {
    expect(isOpenAt("skyBar", 12)).toBe(false); // midday: closed
    expect(isOpenAt("skyBar", 16)).toBe(true); // opens late afternoon
    expect(isOpenAt("skyBar", 23)).toBe(true); // late evening: open
    expect(isOpenAt("skyBar", 2)).toBe(false); // small hours: closed
  });
});

describe("Sky Bar view premium", () => {
  it("is 1 at or below the base floor, climbs with height, and is capped", () => {
    const base = ECON.skyBarViewBaseFloor;
    expect(MODERN_RULES.viewPremium(1)).toBe(1); // ground: no view premium
    expect(MODERN_RULES.viewPremium(base)).toBe(1); // at the base floor: still par
    expect(MODERN_RULES.viewPremium(base + 5)).toBeGreaterThan(1); // above it: a premium
    expect(MODERN_RULES.viewPremium(base + 20)).toBeGreaterThan(MODERN_RULES.viewPremium(base + 5)); // higher earns more
    // Capped: far above the base it tops out at 1 + skyBarViewMax and climbs no further.
    const capped = 1 + ECON.skyBarViewMax;
    expect(MODERN_RULES.viewPremium(base + 1000)).toBeCloseTo(capped, 6);
    expect(MODERN_RULES.viewPremium(base + 2000)).toBeCloseTo(capped, 6);
  });

  it("does not exist in Classic (the seam returns 1, keeping Classic byte-identical)", () => {
    expect(CLASSIC_RULES.viewPremium(1)).toBe(1);
    expect(CLASSIC_RULES.viewPremium(50)).toBe(1);
  });

  it("earns strictly more the higher it is placed (vs an identical low-floor control)", () => {
    // Two identical Modern towers built to the same height with the same elevator
    // and the same office demand origin, differing ONLY in the bar's floor. Same
    // seed and identical build order, so the single venue draws the same seeded
    // traffic factor in both. The Sky Bar is exempt from the lobby-distance penalty,
    // so that multiplier is 1 for both regardless of floor. The only remaining
    // difference is the view premium, so the higher bar must earn strictly more.
    const TOP = 31; // within a standard elevator's 30-floor span from floor 1
    const money = (barFloor: number): number => {
      const sim = new Simulation(7, "modern");
      sim.money = 1_000_000_000; // fund construction; income is measured as a delta below
      sim.star = 5;
      lay(sim, "lobby", 1);
      for (let f = 2; f <= TOP; f++) lay(sim, "floor", f);
      sim.buildTransport("elevatorStandard", 0, 1, TOP); // shaft at column 0, so rooms at C sit clear of it
      expect(sim.build("office", 2, C).ok).toBe(true); // a demand origin so the pool is non-empty
      sim.tower.units.find((u) => u.kind === "office")!.state = "occupied";
      expect(sim.build("skyBar", barFloor, C).ok).toBe(true);
      sim.tower.units.find((u) => u.kind === "skyBar")!.state = "occupied";
      sim.clock = new Clock(20 * 60, sim.clock.calendar); // 8pm: the bar is open
      const before = sim.money;
      for (let i = 0; i < 12; i++) sim.economy.collectTrafficIncome(); // amplify past integer flooring
      return sim.money - before;
    };
    const low = money(12); // just above the view base floor: a modest premium
    const high = money(TOP); // far higher: a larger climbing premium
    expect(high).toBeGreaterThan(low);
  });
});
