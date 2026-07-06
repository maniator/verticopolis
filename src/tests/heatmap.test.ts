import { describe, it, expect } from "vitest";
import {
  Simulation,
  congestionSeverity,
  CONGESTION_CHURN,
  CONGESTION_GRIDLOCK,
  type HeatCell,
} from "../engine/Simulation";
import { GRID } from "../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** All overlay cells covering `floor` (congestion/occupancy have at most one;
 *  satisfaction has one per present tenant unit). */
function cellsOn(map: HeatCell[], floor: number): HeatCell[] {
  return map.filter((c) => c.floor === floor);
}
function cellOn(map: HeatCell[], floor: number): HeatCell | undefined {
  return map.find((c) => c.floor === floor);
}

describe("floorHeatmap (stats overlay data)", () => {
  it("occupancy: a fully-vacant office floor is redder than a fully-leased one", () => {
    const sim = Simulation.newGame(51);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 3);
    sim.buildTransport("elevatorStandard", C, 1, 3);
    // Floor 2: two occupied offices. Floor 3: two vacant offices.
    for (const x of [0, 9]) {
      const r = sim.tower.place("office", 2, x);
      sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    }
    for (const x of [0, 9]) sim.tower.place("office", 3, x);
    const map = sim.floorHeatmap("occupancy");
    expect(cellOn(map, 2)!.severity).toBe(0); // fully leased → green
    expect(cellOn(map, 3)!.severity).toBe(1); // fully vacant → red
  });

  it("reports each tinted floor's built column extent", () => {
    const sim = Simulation.newGame(52);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    const r = sim.tower.place("office", 2, 40); // width 9 → tiles 40..48
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    const cell = cellOn(sim.floorHeatmap("occupancy"), 2)!;
    expect(cell.minX).toBeLessThanOrEqual(40);
    expect(cell.maxX).toBeGreaterThanOrEqual(48);
  });

  it("satisfaction: an unhappy tenant floor reads redder than a content one", () => {
    const sim = Simulation.newGame(53);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 3);
    const happy = sim.tower.place("office", 2, 0);
    const sad = sim.tower.place("office", 3, 0);
    const hu = sim.tower.units.find((u) => u.id === happy.unitId)!;
    const su = sim.tower.units.find((u) => u.id === sad.unitId)!;
    hu.state = "occupied";
    hu.satisfaction = 1;
    su.state = "occupied";
    su.satisfaction = 0.2;
    const map = sim.floorHeatmap("satisfaction");
    expect(cellOn(map, 3)!.severity).toBeGreaterThan(cellOn(map, 2)!.severity);
  });

  it("satisfaction: one miserable suite reddens on its own, not averaged away by happy neighbors on its floor", () => {
    // Regression: a single vacating condo at 0% satisfaction sharing a floor
    // with several content condos used to read green because the floor's
    // average happiness stayed high. Each present unit must now tint by its own
    // unhappiness.
    const sim = Simulation.newGame(56);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    const sadX = 0;
    const happyXs = [16, 32, 48, 64];
    const sad = sim.tower.place("condo", 2, sadX);
    const su = sim.tower.units.find((u) => u.id === sad.unitId)!;
    su.state = "vacating";
    su.satisfaction = 0;
    for (const x of happyXs) {
      const r = sim.tower.place("condo", 2, x);
      const u = sim.tower.units.find((unit) => unit.id === r.unitId)!;
      u.state = "occupied";
      u.satisfaction = 1;
    }
    const cells = cellsOn(sim.floorHeatmap("satisfaction"), 2);
    const sadCell = cells.find((c) => c.minX <= sadX && c.maxX >= sadX)!;
    expect(sadCell.severity).toBe(1); // the miserable suite is fully red
    // The happy suites stay green regardless of their unhappy neighbor.
    for (const x of happyXs) {
      const cell = cells.find((c) => c.minX <= x && c.maxX >= x)!;
      expect(cell.severity).toBe(0);
    }
  });

  it("occupancy/satisfaction skip floors with no tenancy; congestion covers built floors", () => {
    const sim = Simulation.newGame(54);
    sim.money = 1e12;
    lay(sim, "lobby", 1); // structural only, no rentable units
    expect(cellOn(sim.floorHeatmap("occupancy"), 1)).toBeUndefined(); // no tenancy → untinted
    expect(cellOn(sim.floorHeatmap("congestion"), 1)).toBeDefined(); // congestion tints built floors
  });

  it("satisfaction skips a leased-but-empty floor (no one present to judge), occupancy flags it", () => {
    const sim = Simulation.newGame(55);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.tower.place("office", 2, 0); // built, but vacant (nobody present)
    // Occupancy sees a vacant office (red); satisfaction has no present tenant
    // to judge, so it leaves the floor untinted rather than falsely flagging it.
    expect(cellOn(sim.floorHeatmap("occupancy"), 2)!.severity).toBe(1);
    expect(cellOn(sim.floorHeatmap("satisfaction"), 2)).toBeUndefined();
  });
});

describe("congestionSeverity (overlay ramp, sim-anchored)", () => {
  const AMBER = 2 / 3; // the amber ramp stop (green 0 · chartreuse ⅓ · amber ⅔ · red 1)

  it("pins the color ramp to the sim's own thresholds", () => {
    expect(congestionSeverity(0)).toBe(0); // clear → green
    // Amber lands exactly at the churn threshold (where tenants start leaving).
    expect(congestionSeverity(CONGESTION_CHURN)).toBeCloseTo(AMBER, 5);
    // Fully red at gridlock, and clamped beyond it.
    expect(congestionSeverity(CONGESTION_GRIDLOCK)).toBe(1);
    expect(congestionSeverity(CONGESTION_GRIDLOCK + 1)).toBe(1);
    expect(congestionSeverity(-1)).toBe(0);
  });

  it("monotonically increases with congestion", () => {
    let prev = -1;
    // A dense grid that straddles the churn join (…0.99, 1.0, 1.01…) so a
    // discontinuity or slope flip at the branch boundary can't slip through.
    for (const c of [0, 0.05, 0.1, 0.24, 0.5, 0.8, 0.99, 1.0, 1.01, 1.2, 1.4, 1.59, 1.6]) {
      const s = congestionSeverity(c);
      expect(s).toBeGreaterThan(prev);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      prev = s;
    }
  });

  it("is continuous where the two branches meet at churn", () => {
    const AMBER = 2 / 3;
    // Both branches must converge on the amber stop — no visible seam at churn.
    expect(congestionSeverity(CONGESTION_CHURN - 1e-6)).toBeCloseTo(AMBER, 3);
    expect(congestionSeverity(CONGESTION_CHURN + 1e-6)).toBeCloseTo(AMBER, 3);
  });

  it("spreads the healthy sub-churn range so a well-served tower is not flat green", () => {
    // A comfortable tower sits well under churn; those floors must still be
    // visibly distinct (the bug this fixes: everything collapsed into one green).
    const low = congestionSeverity(0.05);
    const busyButFine = congestionSeverity(0.24);
    expect(low).toBeGreaterThan(0); // not pure green
    expect(busyButFine - low).toBeGreaterThan(0.1); // a real, visible gap
    expect(busyButFine).toBeLessThan(AMBER); // …yet honestly still below "straining"
  });

  it("peakCongestion reports the busiest floor's ratio for the legend", () => {
    const sim = Simulation.newGame(60);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 6; f++) lay(sim, "floor", f);
    sim.buildTransport("elevatorStandard", C, 1, 6);
    sim.tower.setCars(sim.tower.transports[0].id, 1); // one weak car → real load
    for (let f = 2; f <= 6; f++) {
      for (let x = 0; x + 9 <= C; x += 9) {
        const r = sim.tower.place("office", f, x);
        if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      }
    }
    const peak = sim.peakCongestion();
    let maxFloor = 0;
    for (let f = 2; f <= 6; f++) maxFloor = Math.max(maxFloor, sim.congestionAt(f));
    expect(peak).toBeCloseTo(maxFloor, 5); // the max across floors
    expect(peak).toBeGreaterThan(0);
  });
});
