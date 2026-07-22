import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { GRID, FACILITIES } from "./facilities";
import { AMUSEMENTS_SUBTYPES, subtypeListFor } from "./retailSubtypes";
import { isCommercialKind, isOpenAt } from "./facilityPredicates";
import { ECON } from "./econConfig";
import { spawnFloors } from "./crowd/spawn";
import { Clock } from "./Clock";
import { ledgerCatFor } from "./Ledger";

/**
 * Amusements: a Modern-only "container" facility (gdd-modern-expansion), an
 * arcade / games hall that earns from foot traffic like the other footfall
 * venues, with a Modern-only attraction roster (classic arcade, VR, claw,
 * mini-golf). Modern-gated: a Classic tower never has one, so Classic stays
 * pixel-faithful.
 */

const C = Math.floor(GRID.width / 2);

/** Lay a ground lobby wide enough for a 12-tile Amusements on the story above. */
function foundedWithLobby(mode: "classic" | "modern"): Simulation {
  const sim = Simulation.newGame(7, mode);
  sim.star = 5; // clear the 3-star gate
  sim.money = 1_000_000_000;
  for (let i = 0; i < 14; i++) expect(sim.build("lobby", 1, C + i).ok).toBe(true);
  return sim;
}

describe("Amusements", () => {
  it("is cataloged as a Modern-only entertainment venue", () => {
    expect(FACILITIES.amusements.modernOnly).toBe(true);
    expect(FACILITIES.amusements.category).toBe("entertainment");
    // A footfall venue: it feels the noise + lobby-proximity rules.
    expect(isCommercialKind("amusements")).toBe(true);
  });

  it("unlocks in Modern at its star, never in Classic", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.amusements.minStar;
    expect(modern.isUnlocked("amusements")).toBe(true);
    const classic = Simulation.newGame(1, "classic");
    classic.star = 5; // even a maxed Classic tower can't unlock Modern content
    expect(classic.isUnlocked("amusements")).toBe(false);
  });

  it("gates behind its star: locked below minStar, unlocked at it", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.amusements.minStar - 1;
    expect(modern.isUnlocked("amusements")).toBe(false);
    modern.star = FACILITIES.amusements.minStar;
    expect(modern.isUnlocked("amusements")).toBe(true);
  });

  it("refuses to build in a Classic tower", () => {
    const classic = foundedWithLobby("classic");
    const r = classic.build("amusements", 2, C);
    expect(r.ok).toBe(false);
  });

  it("builds in Modern and draws an attraction subtype from its roster", () => {
    const sim = foundedWithLobby("modern");
    const built = sim.build("amusements", 2, C);
    expect(built.ok, built.reason).toBe(true);
    const u = sim.tower.units.find((x) => x.kind === "amusements");
    expect(u).toBeDefined();
    // One kind, many faces: the reskin variety the container pattern is built on.
    expect(subtypeListFor("amusements")).toBe(AMUSEMENTS_SUBTYPES);
    expect([...AMUSEMENTS_SUBTYPES]).toContain(u!.subtype);
  });

  it("keeps arcade hours (open late morning to midnight)", () => {
    expect(isOpenAt("amusements", 9)).toBe(false);
    expect(isOpenAt("amusements", 10)).toBe(true);
    expect(isOpenAt("amusements", 20)).toBe(true);
    expect(isOpenAt("amusements", 23)).toBe(true);
  });

  it("joins the strolling-visitor pool while open, so visitors route to it", () => {
    // The gap this guards: a footfall venue absent from every crowd-spawn path
    // is a destination nobody travels to (no foot traffic, no transport demand),
    // even though its art draws a full room. It must be a live destination while
    // open, exactly like a shop (both use this one-way ambient pool).
    const sim = foundedWithLobby("modern");
    const built = sim.build("amusements", 2, C);
    expect(built.ok, built.reason).toBe(true);
    const u = sim.tower.units.find((x) => x.kind === "amusements")!;
    u.state = "occupied";
    // Open (15:00): the venue's floor is in the ambient pool.
    sim.clock = new Clock(15 * 60, sim.clock.calendar);
    expect(spawnFloors(sim.tower, sim.clock).openVenues).toContain(u.floor);
    // Closed (03:00): it drops out, like every other venue after hours.
    sim.clock = new Clock(3 * 60, sim.clock.calendar);
    expect(spawnFloors(sim.tower, sim.clock).openVenues).not.toContain(u.floor);
  });

  it("its income lands in the Statistics entertainment breakdown", () => {
    // Registered income that maps to no ledger category would silently vanish
    // from the per-category readout even as it raised cash.
    expect(ledgerCatFor("amusements")).toBe("entertainment");
  });

  it("is a demand-pool venue in Modern, absent from Classic's income table", () => {
    const modern = Simulation.newGame(1, "modern");
    expect(modern.rules.commercialDailyIncome("amusements")).toBeGreaterThan(0);
    expect(ECON.retailSpendPerCustomer.amusements).toBeGreaterThan(0);
    // Leisure crowd: busier on weekends than weekdays.
    expect(ECON.weekendTrafficMultiplier.amusements).toBeGreaterThan(1);
    // Modern-only: it has no Classic 1994 income figure at all.
    expect(ECON.classicDailyTrafficIncome.amusements).toBeUndefined();
  });
});
