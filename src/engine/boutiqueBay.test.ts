import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { GRID, FACILITIES } from "./facilities";
import { BOUTIQUE_SUBTYPES, subtypeListFor } from "./retailSubtypes";
import { isCommercialKind, isOpenAt } from "./facilityPredicates";
import { ECON } from "./econConfig";
import { spawnFloors } from "./crowd/spawn";
import { Clock } from "./Clock";
import { ledgerCatFor } from "./Ledger";

/**
 * Boutique Bay: a Modern-only "container" facility (gdd-modern-expansion), a bay
 * of small independent trades that earns from foot traffic like the other
 * footfall venues, with a Modern-only trade roster (florist, barber, phone
 * repair, vintage, tattoo, records, gallery). Modern-gated: a Classic tower
 * never has one, so Classic stays pixel-faithful.
 */

const C = Math.floor(GRID.width / 2);

/** Lay a ground lobby wide enough for a 12-tile Boutique Bay on the story above. */
function foundedWithLobby(mode: "classic" | "modern"): Simulation {
  const sim = Simulation.newGame(7, mode);
  sim.star = 5; // clear the 3-star gate
  sim.money = 1_000_000_000;
  for (let i = 0; i < 14; i++) expect(sim.build("lobby", 1, C + i).ok).toBe(true);
  return sim;
}

describe("Boutique Bay", () => {
  it("is cataloged as a Modern-only retail venue", () => {
    expect(FACILITIES.boutiqueBay.modernOnly).toBe(true);
    expect(FACILITIES.boutiqueBay.category).toBe("retail");
    // A footfall venue: it feels the noise + lobby-proximity rules.
    expect(isCommercialKind("boutiqueBay")).toBe(true);
  });

  it("gates behind its star: locked below minStar, never in Classic", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.boutiqueBay.minStar - 1;
    expect(modern.isUnlocked("boutiqueBay")).toBe(false);
    modern.star = FACILITIES.boutiqueBay.minStar;
    expect(modern.isUnlocked("boutiqueBay")).toBe(true);
    const classic = Simulation.newGame(1, "classic");
    classic.star = 5; // even a maxed Classic tower can't unlock Modern content
    expect(classic.isUnlocked("boutiqueBay")).toBe(false);
  });

  it("refuses to build in a Classic tower", () => {
    const classic = foundedWithLobby("classic");
    expect(classic.build("boutiqueBay", 2, C).ok).toBe(false);
  });

  it("builds in Modern and draws a trade subtype from its roster", () => {
    const sim = foundedWithLobby("modern");
    const built = sim.build("boutiqueBay", 2, C);
    expect(built.ok, built.reason).toBe(true);
    const u = sim.tower.units.find((x) => x.kind === "boutiqueBay");
    expect(u).toBeDefined();
    expect(subtypeListFor("boutiqueBay")).toBe(BOUTIQUE_SUBTYPES);
    expect([...BOUTIQUE_SUBTYPES]).toContain(u!.subtype);
  });

  it("keeps ordinary retail hours (open 10:00 to 21:00)", () => {
    expect(isOpenAt("boutiqueBay", 9)).toBe(false);
    expect(isOpenAt("boutiqueBay", 10)).toBe(true);
    expect(isOpenAt("boutiqueBay", 20)).toBe(true);
    expect(isOpenAt("boutiqueBay", 21)).toBe(false);
  });

  it("joins the strolling-visitor pool while open, so visitors route to it", () => {
    // A footfall venue absent from every crowd-spawn path is a destination
    // nobody travels to; it must be a live destination while open, like a shop.
    const sim = foundedWithLobby("modern");
    expect(sim.build("boutiqueBay", 2, C).ok).toBe(true);
    const u = sim.tower.units.find((x) => x.kind === "boutiqueBay")!;
    u.state = "occupied";
    sim.clock = new Clock(15 * 60, sim.clock.calendar);
    expect(spawnFloors(sim.tower, sim.clock).openVenues).toContain(u.floor);
    sim.clock = new Clock(3 * 60, sim.clock.calendar);
    expect(spawnFloors(sim.tower, sim.clock).openVenues).not.toContain(u.floor);
  });

  it("its income lands in the Statistics retail breakdown", () => {
    expect(ledgerCatFor("boutiqueBay")).toBe("retail");
  });

  it("is a demand-pool venue in Modern, absent from Classic's income table", () => {
    const modern = Simulation.newGame(1, "modern");
    expect(modern.rules.commercialDailyIncome("boutiqueBay")).toBeGreaterThan(0);
    expect(ECON.retailSpendPerCustomer.boutiqueBay).toBeGreaterThan(0);
    expect(ECON.weekendTrafficMultiplier.boutiqueBay).toBeGreaterThan(1);
    expect(ECON.classicDailyTrafficIncome.boutiqueBay).toBeUndefined();
  });
});
