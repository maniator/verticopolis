import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";
import { ECON, rentConfig } from "../engine/econConfig";
import type { GameMode } from "../engine/types";

/**
 * In-game minutes spanning one 30-day month, matching the sim's own month
 * definition (`Math.floor(clock.day / 30)` in Simulation.onDay). In the v1
 * model a single `sim.tick(MONTH)` advances the clock in one jump and fires
 * `onDay` (hence `payMaintenance`) exactly once.
 */
const MONTH = 60 * 24 * 30;

/**
 * The three non-canon economy mechanics (operating overhead, condo hold-tax,
 * office-noise erosion) are the Modern "deeper economy" layer. Classic is
 * pixel-faithful: none of them apply. These behavioral tests prove the gating
 * end-to-end through the sim, not just the GameRules unit values.
 */

const W = GRID.width;
const C = Math.floor(W / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** A served floor 2 with a standard elevator, in the given mode. */
function servedTower(mode: GameMode): Simulation {
  const sim = new Simulation(4, mode);
  sim.money = 1_000_000;
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  sim.buildTransport("elevatorStandard", C, 1, 2);
  return sim;
}

describe("office-noise erosion is Modern-only (canon: Classic caps but never evicts)", () => {
  /** Place an office with a hotel neighbor inside its noise band; run a long
   *  stretch of exposure and report the neighbor's floored satisfaction. */
  function noiseFloor(mode: GameMode): number {
    const sim = servedTower(mode);
    sim.star = 1; // suppress random fire/bomb events so noise is isolated
    sim.tower.place("office", 2, C);
    const r = sim.tower.place("hotelDouble", 2, C + 9); // flush right, inside the band
    const hotel = sim.tower.units.find((u) => u.id === r.unitId)!;
    hotel.state = "asleep";
    hotel.satisfaction = 1;
    // A full week of unbroken exposure, far past any eviction fuse.
    for (let i = 0; i < 24 * 7; i++) sim.tick(60);
    return hotel.satisfaction;
  }

  it("Classic: noise caps satisfaction at the ceiling (0.6) and never erodes below it", () => {
    const s = noiseFloor("classic");
    // Capped, not eroded: it sits AT the 0.6 ceiling, never sinking toward eviction.
    expect(s).toBeGreaterThanOrEqual(0.55);
    expect(s).toBeLessThanOrEqual(0.6 + 1e-9);
  });

  it("Modern: noise erodes well below the cap (the path to eviction)", () => {
    const s = noiseFloor("modern");
    expect(s).toBeLessThan(0.4); // eroded far past the 0.6 cap
  });

  it("Classic sits strictly higher than Modern after identical exposure", () => {
    expect(noiseFloor("classic")).toBeGreaterThan(noiseFloor("modern"));
  });
});

describe("operating overhead + condo hold-tax are Modern-only", () => {
  /** Money spent over one month by a tower holding one vacant office and one
   *  unsold condo on an UNSERVED floor (no elevator), so nobody moves in and the
   *  condo can't sell: the ONLY money movement is the overhead + hold-tax sinks. */
  function monthlyDrain(mode: GameMode): number {
    const sim = new Simulation(4, mode);
    sim.simModel = "v1"; // one step per tick → exactly one maintenance run over MONTH
    sim.money = 1_000_000;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2); // deliberately NO elevator to floor 2 → unserved
    sim.tower.place("office", 2, C); // held, vacant → overhead candidate, earns nothing
    sim.tower.place("condo", 2, C + 10); // unsold, unreachable → hold-tax candidate, never sells
    const before = sim.money;
    sim.tick(MONTH); // crosses exactly one month boundary → payMaintenance once
    return before - sim.money;
  }

  it("Classic charges no overhead and no condo hold-tax (only canon maintenance)", () => {
    // Classic still pays canon service maintenance if any, but there are no
    // service rooms here, so a held vacant office + unsold condo cost NOTHING.
    expect(monthlyDrain("classic")).toBe(0);
  });

  it("Modern charges the exact overhead + condo tax (a real carrying cost)", () => {
    // Two overhead-bearing units (vacant office + unsold condo) + the condo
    // hold-tax on its asking price. Asserting the EXACT figure (not just > 0)
    // catches a sign/tuning error in either sink.
    const overhead = 2 * ECON.overheadPerLeasableUnitMonthly;
    const condoTax = Math.ceil(rentConfig("condo")!.default * ECON.condoMonthlyTaxRate);
    expect(monthlyDrain("modern")).toBe(overhead + condoTax);
  });
});
