import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
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
    expect(map.get(2)!.severity).toBe(0); // fully leased → green
    expect(map.get(3)!.severity).toBe(1); // fully vacant → red
  });

  it("reports each tinted floor's built column extent", () => {
    const sim = Simulation.newGame(52);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    const r = sim.tower.place("office", 2, 40); // width 9 → tiles 40..48
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    const cell = sim.floorHeatmap("occupancy").get(2)!;
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
    expect(map.get(3)!.severity).toBeGreaterThan(map.get(2)!.severity);
  });

  it("occupancy/satisfaction skip floors with no tenancy; congestion covers built floors", () => {
    const sim = Simulation.newGame(54);
    sim.money = 1e12;
    lay(sim, "lobby", 1); // structural only, no rentable units
    expect(sim.floorHeatmap("occupancy").has(1)).toBe(false); // no tenancy → untinted
    expect(sim.floorHeatmap("congestion").has(1)).toBe(true); // congestion tints built floors
  });
});
