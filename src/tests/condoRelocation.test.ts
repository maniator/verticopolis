import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";
import { CLASSIC_RULES, MODERN_RULES } from "../engine/gameRules";
import { ECON } from "../engine/econConfig";
import type { GameMode } from "../engine/types";

/**
 * Household-aware condo departures (Modern only). A sold Modern condo's family
 * can relocate for life reasons even when perfectly served; Classic condos never
 * relocate (they stay 1994-sticky). The relocation rides the existing buy-back
 * path and enters a non-rescindable "relocation" notice.
 */

const W = GRID.width;
const C = Math.floor(W / 2);
/** One 30-day month, matching Simulation.onDay's `Math.floor(clock.day / 30)`. */
const MONTH = 60 * 24 * 30;

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

interface CondoUnit {
  id: number;
  kind: string;
  width: number;
  state: string;
  everOccupied: boolean;
  residents?: number;
  satisfaction: number;
  vacateReason?: string;
  vacateAt?: number;
}

/** A served floor-2 tower holding one already-sold condo, happy and full. */
function towerWithSoldCondo(mode: GameMode, residents: number): { sim: Simulation; condo: CondoUnit } {
  const sim = new Simulation(4, mode);
  sim.simModel = "v1"; // one monthly roll per tick(MONTH)
  sim.money = 10_000_000;
  sim.star = 1; // suppress random fire/bomb events
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  sim.buildTransport("elevatorStandard", C, 1, 2);
  const r = sim.tower.place("condo", 2, C + 2);
  const condo = sim.tower.units.find((u) => u.id === r.unitId)! as unknown as CondoUnit;
  condo.state = "occupied";
  condo.everOccupied = true;
  condo.residents = mode === "modern" ? residents : undefined;
  condo.satisfaction = 1;
  return { sim, condo };
}

describe("GameRules.condoRelocationChance", () => {
  it("Classic never relocates a condo (returns 0 for any household)", () => {
    for (const r of [undefined, 2, 3, 4, 5]) {
      expect(CLASSIC_RULES.condoRelocationChance(r)).toBe(0);
    }
  });

  it("Modern scales the chance UP with family size (bigger family, bigger flight risk)", () => {
    const base = ECON.condoRelocationChanceMonthly;
    expect(MODERN_RULES.condoRelocationChance(3)).toBeCloseTo(base, 10); // mean household is neutral
    expect(MODERN_RULES.condoRelocationChance(undefined)).toBeCloseTo(base, 10); // no household reads as 3
    expect(MODERN_RULES.condoRelocationChance(2)).toBeLessThan(MODERN_RULES.condoRelocationChance(3));
    expect(MODERN_RULES.condoRelocationChance(5)).toBeGreaterThan(MODERN_RULES.condoRelocationChance(3));
    expect(MODERN_RULES.condoRelocationChance(5)).toBeCloseTo((base * 5) / 3, 10);
  });
});

describe("condo relocation is Modern-only and rides the buy-back", () => {
  it("Modern: a happy sold condo eventually relocates (and the buy-back is charged)", () => {
    const { sim, condo } = towerWithSoldCondo("modern", 5); // max flight risk
    const before = sim.money;
    // Capture the notice log the first month it fires (the log is a bounded ring,
    // and re-sales over many months would otherwise shift the entry out).
    let relocationLog: { text: string; kind: string } | undefined;
    for (let m = 0; m < 360; m++) {
      sim.tick(MONTH);
      if (!relocationLog && condo.vacateReason === "relocation") {
        relocationLog = sim.log.find((e) => e.text.includes("is relocating"));
      }
      if (condo.state === "empty") break; // relocated + bought back
    }
    // The advance warning must surface as a TOAST, not a silent bulletin line:
    // the UI toasts only "good"/"bad" entries, so the notice is emitted "bad".
    expect(relocationLog).toBeDefined();
    expect(relocationLog!.kind).toBe("bad");
    expect(sim.money).toBeLessThan(before); // the reclaim (buy-back) was charged
  });

  it("Classic: a sold condo never relocates over decades (stays 1994-sticky)", () => {
    const { sim, condo } = towerWithSoldCondo("classic", 3);
    for (let m = 0; m < 360; m++) {
      sim.tick(MONTH);
      expect(condo.vacateReason).not.toBe("relocation");
    }
    // Never relocated: the household is still in place after three decades. (The
    // per-month assertion above already proves no relocation notice ever fired.)
    expect(condo.state).toBe("occupied");
    expect(condo.everOccupied).toBe(true);
  });

  it("Classic never draws the relocation roll from the RNG (Modern does)", () => {
    // Same seed, same single sold condo, one month. The only per-month RNG
    // difference is the relocation roll: Modern draws it (chance > 0), Classic
    // short-circuits before the draw (chance 0), so after one month the two
    // seeded streams are out of step by exactly that one draw. If Classic ever
    // drew here (a broken short-circuit) the streams would stay in lockstep.
    const classic = towerWithSoldCondo("classic", 3).sim;
    const modern = towerWithSoldCondo("modern", 3).sim;
    expect(classic.rng.seed).toBe(modern.rng.seed); // identical starting state
    classic.tick(MONTH);
    modern.tick(MONTH);
    expect(classic.rng.seed).not.toBe(modern.rng.seed); // Modern consumed the extra draw
  });

  it("Modern is deterministic: the same seed relocates on the same month", () => {
    const monthOf = (): number => {
      const { sim, condo } = towerWithSoldCondo("modern", 5);
      for (let m = 0; m < 360; m++) {
        sim.tick(MONTH);
        if (condo.vacateReason === "relocation") return m;
      }
      return -1;
    };
    const a = monthOf();
    expect(a).toBeGreaterThanOrEqual(0);
    expect(monthOf()).toBe(a);
  });
});

describe("a relocation notice is non-rescindable (a life event)", () => {
  it("a fully satisfied Modern condo on a relocation notice still leaves", () => {
    const { sim, condo } = towerWithSoldCondo("modern", 4);
    condo.state = "vacating";
    condo.vacateReason = "relocation";
    condo.satisfaction = 1; // perfectly happy: a neglect notice would rescind here
    condo.vacateAt = 0; // overdue
    const before = sim.money;
    sim.tick(60);
    expect(condo.state).not.toBe("occupied"); // did not rescind despite full satisfaction
    expect(sim.money).toBeLessThan(before); // bought back on departure
  });

  it("a neglect notice at full satisfaction DOES rescind (contrast)", () => {
    const { sim, condo } = towerWithSoldCondo("modern", 4);
    condo.state = "vacating";
    condo.vacateReason = "access";
    condo.satisfaction = 1; // recovered
    condo.vacateAt = 0;
    sim.tick(60);
    expect(condo.state).toBe("occupied"); // a fixable cause rescinds
  });
});
