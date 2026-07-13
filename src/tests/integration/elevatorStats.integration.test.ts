import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

describe("Elevator utilization stats", () => {
  it("reports passenger shafts busiest-first, and a ridden shaft shows load", () => {
    const sim = Simulation.newGame(91);
    sim.money = 1e12;
    sim.star = 1;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 6; f++) lay(sim, "floor", f);
    const shaft = sim.tower.placeTransport("elevatorStandard", C, 1, 6);
    sim.tower.setCars(shaft.transportId!, 4);
    // Fill offices so commuters actually ride the shaft.
    for (let f = 2; f <= 6; f++)
      for (let x = 0; x + 9 <= 180; x += 9) {
        const r = sim.tower.place("office", f, x);
        if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      }
    // Run a couple of weekday commutes so cars carry riders and the hourly
    // sampler folds their load into the utilization EMA.
    for (let i = 0; i < 48; i++) sim.tick(60);
    const stats = sim.elevatorStats();
    expect(stats.length).toBe(1);
    expect(stats[0].id).toBe(shaft.transportId);
    expect(stats[0].cars).toBe(4);
    expect(stats[0].utilization).toBeGreaterThan(0); // it carried people
    expect(stats[0].utilization).toBeLessThanOrEqual(1);
  });

  it("excludes staff-only service elevators from the passenger report", () => {
    const sim = Simulation.newGame(92);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 5; f++) lay(sim, "floor", f);
    sim.tower.placeTransport("elevatorService", C, 1, 5); // staff-only
    sim.tick(60);
    expect(sim.elevatorStats().length).toBe(0); // service elevator not listed
  });

  it("forgets a shaft's utilization once it's removed", () => {
    const sim = Simulation.newGame(93);
    sim.money = 1e12;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= 5; f++) lay(sim, "floor", f);
    const shaft = sim.tower.placeTransport("elevatorStandard", C, 1, 5);
    sim.tick(60);
    expect(sim.elevatorStats().length).toBe(1);
    sim.tower.removeTransport(shaft.transportId!);
    sim.tick(60); // sampler prunes the dead id
    expect(sim.elevatorStats().length).toBe(0);
    expect(sim.elevatorUtilization(shaft.transportId!)).toBeUndefined();
  });
});
