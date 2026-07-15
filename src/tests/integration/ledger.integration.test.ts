import { describe, it, expect } from "vitest";
import { Ledger, WINDOW, ledgerCatFor } from "../../engine/Ledger";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";

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

describe("Income breakdown integration", () => {
  it("records shop traffic income into the retail line as the tower runs", () => {
    const sim = Simulation.newGame(77);
    sim.money = 1e9;
    sim.star = 3;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    const shop = sim.tower.place("shop", 2, 0);
    sim.tower.units.find((u) => u.id === shop.unitId)!.state = "occupied";
    // Occupied offices give the shop a demand pool to serve (income is
    // demand-driven), so the retail line takes real dollars.
    for (const x of [20, 32, 44]) {
      const o = sim.tower.place("office", 2, x);
      sim.tower.units.find((u) => u.id === o.unitId)!.state = "occupied";
    }
    // Run a few days so the shop earns during its open hours and days roll over.
    for (let d = 0; d < 3; d++) sim.tick(60 * 24);
    const { averages, hasData } = sim.incomeBreakdown();
    expect(hasData).toBe(true);
    expect(averages.retail).toBeGreaterThan(0); // the shop is on the retail line
  });

  it("survives save/load with its accrued figures intact", () => {
    const sim = Simulation.newGame(78);
    sim.money = 1e9;
    sim.star = 3;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    const shop = sim.tower.place("shop", 2, 0);
    sim.tower.units.find((u) => u.id === shop.unitId)!.state = "occupied";
    // Occupied offices give the shop a demand pool to serve (income is
    // demand-driven), so the retail line takes real dollars.
    for (const x of [20, 32, 44]) {
      const o = sim.tower.place("office", 2, x);
      sim.tower.units.find((u) => u.id === o.unitId)!.state = "occupied";
    }
    for (let d = 0; d < 3; d++) sim.tick(60 * 24);
    const before = sim.incomeBreakdown().averages.retail;
    const reloaded = Simulation.deserialize(sim.serialize());
    expect(reloaded.incomeBreakdown().averages.retail).toBeCloseTo(before, 5);
  });
});
