import { describe, it, expect } from "vitest";
import { Ledger, WINDOW, ledgerCatFor } from "../../engine/Ledger";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/types";
import { GRID } from "../../engine/facilities";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

const W = GRID.width;
const C = Math.floor(W / 2);
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

describe("Ledger (rolling income/expense record)", () => {
  it("averages a per-day amount over completed days", () => {
    const l = new Ledger();
    // Three days of $300/day retail income.
    for (let d = 0; d < 3; d++) {
      l.record("retail", 300);
      l.endDay();
    }
    expect(l.averagePerDay().retail).toBe(300);
    // A category that never moved reads 0.
    expect(l.averagePerDay().offices).toBe(0);
  });

  it("amortizes a lumpy quarterly amount across the window", () => {
    const l = new Ledger();
    // One big office-rent lump, then 89 quiet days → a full 90-day window with
    // the lump appearing once: avg/day = lump / 90.
    l.record("offices", 90_000);
    l.endDay();
    for (let d = 0; d < WINDOW - 1; d++) l.endDay();
    expect(l.averagePerDay().offices).toBeCloseTo(1000, 5);
  });

  it("drops days older than the window", () => {
    const l = new Ledger();
    l.record("food", 9000); // day 0
    l.endDay();
    // Push WINDOW more empty days: the day-0 lump falls off the trailing window.
    for (let d = 0; d < WINDOW; d++) l.endDay();
    expect(l.averagePerDay().food).toBe(0);
  });

  it("nets income against expenses in the same category", () => {
    const l = new Ledger();
    l.record("hotels", 5000);
    l.record("hotels", -2000); // overhead
    l.endDay();
    expect(l.averagePerDay().hotels).toBe(3000);
  });

  it("shows the current partial day before any day completes", () => {
    const l = new Ledger();
    expect(l.hasData()).toBe(false);
    l.record("retail", 500);
    expect(l.hasData()).toBe(true);
    expect(l.averagePerDay().retail).toBe(500); // partial-day estimate
  });

  it("round-trips through serialize/restore, hardening garbage", () => {
    const l = new Ledger();
    l.record("offices", 1200);
    l.endDay();
    l.record("food", 300);
    const restored = Ledger.restore(JSON.parse(JSON.stringify(l.serialize())));
    expect(restored.averagePerDay().offices).toBe(1200);
    // A hand-edited save with a bogus value is coerced away, not trusted.
    const dirty = Ledger.restore({ today: { food: "lots", offices: 5 }, history: "nope" });
    expect(dirty.averagePerDay().offices).toBe(5);
    expect(dirty.averagePerDay().food).toBe(0);
  });

  it("maps facility kinds to report categories (and skips non-revenue kinds)", () => {
    expect(ledgerCatFor("office")).toBe("offices");
    expect(ledgerCatFor("hotelSuite")).toBe("hotels");
    expect(ledgerCatFor("shop")).toBe("retail");
    expect(ledgerCatFor("restaurant")).toBe("food");
    expect(ledgerCatFor("cinema")).toBe("entertainment");
    expect(ledgerCatFor("lobby")).toBeNull();
    expect(ledgerCatFor("elevatorStandard")).toBeNull();
    expect(ledgerCatFor("security")).toBeNull();
  });
});

/** A lit shop and three occupied offices on floor 2, served by an elevator.
 *  Occupied offices give the shop a demand pool to serve (income is
 *  demand-driven), so the retail line takes real dollars. */
function shopTower(leg: Leg, seed: number): PortSim {
  const draft = Simulation.newGame(seed);
  draft.money = 1e9;
  draft.star = 3;
  lay(draft, "lobby", 1);
  lay(draft, "floor", 2);
  const sim = new PortSim(leg, draft);
  sim.buildTransport("elevatorStandard", C, 1, 2);
  sim.setup((d) => {
    const shop = d.tower.place("shop", 2, 0);
    d.tower.units.find((u) => u.id === shop.unitId)!.state = "occupied";
    for (const x of [20, 32, 44]) {
      const o = d.tower.place("office", 2, x);
      expect(o.ok, o.reason).toBe(true);
      d.tower.units.find((u) => u.id === o.unitId)!.state = "occupied";
    }
  });
  return sim;
}

describeEngines("Income breakdown integration", (leg) => {
  it("records shop traffic income into the retail line as the tower runs", () => {
    const sim = shopTower(leg, 77);
    // Run a few days so the shop earns during its open hours and days roll over.
    for (let d = 0; d < 3; d++) sim.tick(60 * 24);
    const { averages, hasData } = sim.state.incomeBreakdown();
    expect(hasData).toBe(true);
    expect(averages.retail).toBeGreaterThan(0); // the shop is on the retail line
  });

  it("survives save/load with its accrued figures intact", () => {
    const sim = shopTower(leg, 78);
    for (let d = 0; d < 3; d++) sim.tick(60 * 24);
    const before = sim.state.incomeBreakdown().averages.retail;
    const reloaded = new PortSim(leg, Simulation.deserialize(JSON.parse(sim.save()) as SerializedGame));
    expect(reloaded.state.incomeBreakdown().averages.retail).toBeCloseTo(before, 5);
  });
});
