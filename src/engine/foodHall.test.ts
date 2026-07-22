import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { GRID, FACILITIES } from "./facilities";
import { FOODHALL_SUBTYPES, subtypeListFor } from "./retailSubtypes";
import { isCommercialKind } from "./facilityPredicates";
import { MEAL_WINDOWS } from "./crowd/meals";
import { ECON } from "./econConfig";

/**
 * Food Hall: the first Modern-only "container" facility (gdd-modern-expansion).
 * A hall of food stalls that earns from foot traffic like the canon food
 * venues, with a Modern-only stall roster. Modern-gated: a Classic tower never
 * has one, so Classic stays pixel-faithful.
 */

const C = Math.floor(GRID.width / 2);

/** Lay a ground lobby wide enough for a 24-tile Food Hall on the story above. */
function foundedWithLobby(mode: "classic" | "modern"): Simulation {
  const sim = Simulation.newGame(7, mode);
  sim.star = 5; // clear the 3-star gate
  sim.money = 1_000_000_000;
  for (let i = 0; i < 26; i++) expect(sim.build("lobby", 1, C + i).ok).toBe(true);
  return sim;
}

describe("Food Hall", () => {
  it("is cataloged as a Modern-only food venue", () => {
    expect(FACILITIES.foodHall.modernOnly).toBe(true);
    expect(FACILITIES.foodHall.category).toBe("food");
    // A shopper-drawing food venue: it feels the noise + lobby-proximity rules.
    expect(isCommercialKind("foodHall")).toBe(true);
  });

  it("unlocks in Modern at its star, never in Classic", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.foodHall.minStar;
    expect(modern.isUnlocked("foodHall")).toBe(true);
    const classic = Simulation.newGame(1, "classic");
    classic.star = 5; // even a maxed Classic tower can't unlock Modern content
    expect(classic.isUnlocked("foodHall")).toBe(false);
  });

  it("refuses to build in a Classic tower", () => {
    const classic = foundedWithLobby("classic");
    const r = classic.build("foodHall", 2, C);
    expect(r.ok).toBe(false);
  });

  it("builds in Modern and draws a stall subtype from its roster", () => {
    const sim = foundedWithLobby("modern");
    const built = sim.build("foodHall", 2, C);
    expect(built.ok, built.reason).toBe(true);
    const u = sim.tower.units.find((x) => x.kind === "foodHall");
    expect(u).toBeDefined();
    // One kind, many faces: the reskin variety the container pattern is built on.
    expect(subtypeListFor("foodHall")).toBe(FOODHALL_SUBTYPES);
    expect([...FOODHALL_SUBTYPES]).toContain(u!.subtype);
  });

  it("is a lunch and dinner meal destination (its open windows)", () => {
    // A food court that couldn't receive diners would contradict "satisfies
    // many cravings"; it belongs in the meal-cadence windows it is open for.
    expect(MEAL_WINDOWS.lunch.venues).toContain("foodHall");
    expect(MEAL_WINDOWS.dinner.venues).toContain("foodHall");
    // Closed at breakfast (6-9) and effectively at late night (open 10-22).
    expect(MEAL_WINDOWS.breakfast.venues).not.toContain("foodHall");
  });

  it("is a demand-pool venue in Modern, absent from Classic's income table", () => {
    const modern = Simulation.newGame(1, "modern");
    expect(modern.rules.commercialDailyIncome("foodHall")).toBeGreaterThan(0);
    expect(ECON.retailSpendPerCustomer.foodHall).toBeGreaterThan(0);
    // Modern-only: it has no Classic 1994 income figure at all.
    expect(ECON.classicDailyTrafficIncome.foodHall).toBeUndefined();
  });
});
