import { describe, it, expect } from "vitest";
import { Simulation } from "./Simulation";
import { GRID, FACILITIES } from "./facilities";
import { CLINIC_SUBTYPES, subtypeListFor } from "./retailSubtypes";
import { isCommercialKind } from "./facilityPredicates";
import { ECON } from "./econConfig";
import { ledgerCatFor } from "./Ledger";
import type { GameMode } from "./types";

/**
 * Clinic: the Track-1 lease amenity that finishes the Modern Expansion's
 * container set. Like the Fitness Club it earns a fixed occupancy-based lease
 * (not footfall), but it is a quiet tenant with no amenity halo. Modern-gated:
 * a Classic tower never has one, so Classic stays pixel-faithful and its golden
 * hash is untouched (the feature flows only through the new kind).
 */

const C = Math.floor(GRID.width / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < GRID.width; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

function servedTower(mode: GameMode = "modern"): Simulation {
  const sim = new Simulation(5, mode);
  sim.money = 1_000_000_000;
  sim.star = 5;
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  sim.buildTransport("elevatorStandard", C, 1, 2);
  return sim;
}

describe("Clinic", () => {
  it("is a Modern-only lease amenity, not a footfall venue", () => {
    expect(FACILITIES.clinic.modernOnly).toBe(true);
    // It earns a lease, not a demand-pool footfall take, so it is NOT commercial
    // and has a rent band but no traffic-income entry.
    expect(isCommercialKind("clinic")).toBe(false);
    expect(ECON.rent.clinic).toBeDefined();
    expect(ECON.dailyTrafficIncome.clinic).toBeUndefined();
  });

  it("gates behind its star: locked below minStar, never in Classic", () => {
    const modern = Simulation.newGame(1, "modern");
    modern.star = FACILITIES.clinic.minStar - 1;
    expect(modern.isUnlocked("clinic")).toBe(false);
    modern.star = FACILITIES.clinic.minStar;
    expect(modern.isUnlocked("clinic")).toBe(true);
    const classic = Simulation.newGame(1, "classic");
    classic.star = 5;
    expect(classic.isUnlocked("clinic")).toBe(false);
  });

  it("refuses to build in a Classic tower", () => {
    const classic = servedTower("classic");
    expect(classic.build("clinic", 2, C).ok).toBe(false);
  });

  it("builds in Modern and draws a practice subtype from its roster", () => {
    const sim = servedTower();
    const built = sim.build("clinic", 2, C);
    expect(built.ok, built.reason).toBe(true);
    const u = sim.tower.units.find((x) => x.kind === "clinic");
    expect(u).toBeDefined();
    expect(subtypeListFor("clinic")).toBe(CLINIC_SUBTYPES);
    expect([...CLINIC_SUBTYPES]).toContain(u!.subtype);
  });

  it("collects a lease from a leased clinic, netting on the retail line", () => {
    const sim = servedTower();
    expect(sim.build("clinic", 2, C).ok).toBe(true);
    const u = sim.tower.units.find((x) => x.kind === "clinic")!;
    u.state = "occupied";
    const before = sim.money;
    sim.economy.collectRent();
    expect(sim.money - before).toBeGreaterThan(0);
    // Income and overhead must book to the same ledger line so the P&L reads net.
    expect(ledgerCatFor("clinic")).toBe("retail");
    expect(ECON.classicDailyTrafficIncome.clinic).toBeUndefined();
  });

  it("an empty clinic earns nothing until it is leased", () => {
    const sim = servedTower();
    expect(sim.build("clinic", 2, C).ok).toBe(true);
    const before = sim.money;
    sim.economy.collectRent();
    expect(sim.money).toBe(before);
  });

  it("names 'rent' when gouged on its lease, not a misleading access cause", () => {
    const sim = servedTower();
    expect(sim.build("clinic", 2, C).ok).toBe(true);
    const club = sim.tower.units.find((x) => x.kind === "clinic")!;
    club.state = "occupied";
    club.rent = ECON.rent.clinic.max; // gouged
    expect(sim.dominantGripe(club)).toBe("rent");
    club.rent = ECON.rent.clinic.default; // at the going rate: no self-inflicted gripe
    expect(sim.dominantGripe(club)).toBeNull();
  });
});
