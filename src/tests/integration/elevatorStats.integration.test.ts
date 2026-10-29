import { it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

const W = GRID.width;
const C = Math.floor(W / 2);
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

describeEngines("Elevator utilization stats", (leg: Leg) => {
  it("reports passenger shafts busiest-first, and a ridden shaft shows load", () => {
    const draft = Simulation.newGame(91);
    draft.money = 1e12;
    draft.star = 1;
    lay(draft, "lobby", 1);
    for (let f = 2; f <= 6; f++) lay(draft, "floor", f);
    const shaft = draft.tower.placeTransport("elevatorStandard", C, 1, 6);
    expect(shaft.ok).toBe(true);
    draft.tower.setCars(shaft.transportId!, 4);
    // Fill offices so commuters actually ride the shaft.
    for (let f = 2; f <= 6; f++)
      for (let x = 0; x + 9 <= 180; x += 9) {
        const r = draft.tower.place("office", f, x);
        if (r.ok) draft.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      }
    const sim = new PortSim(leg, draft);
    // Run a couple of weekday commutes so cars carry riders and the hourly
    // sampler folds their load into the utilization EMA.
    for (let i = 0; i < 48; i++) sim.tick(60);
    const stats = sim.statsReport().elevators;
    expect(stats.length).toBe(1);
    expect(stats[0].id).toBe(shaft.transportId);
    expect(stats[0].cars).toBe(4);
    expect(stats[0].utilization).toBeGreaterThan(0); // it carried people
    expect(stats[0].utilization).toBeLessThanOrEqual(1);
  });

  it("excludes staff-only service elevators from the passenger report", () => {
    const draft = Simulation.newGame(92);
    draft.money = 1e12;
    lay(draft, "lobby", 1);
    for (let f = 2; f <= 5; f++) lay(draft, "floor", f);
    expect(draft.tower.placeTransport("elevatorService", C, 1, 5).ok).toBe(true); // staff-only
    const sim = new PortSim(leg, draft);
    sim.tick(60);
    expect(sim.statsReport().elevators.length).toBe(0); // service elevator not listed
  });

  it("forgets a shaft's utilization once it's removed", () => {
    const draft = Simulation.newGame(93);
    draft.money = 1e12;
    lay(draft, "lobby", 1);
    for (let f = 2; f <= 5; f++) lay(draft, "floor", f);
    const shaft = draft.tower.placeTransport("elevatorStandard", C, 1, 5);
    expect(shaft.ok).toBe(true);
    const sim = new PortSim(leg, draft);
    sim.tick(60);
    expect(sim.statsReport().elevators.length).toBe(1);
    expect(sim.demolish(shaft.transportId!)).toBe(true);
    sim.tick(60); // sampler prunes the dead id
    expect(sim.statsReport().elevators.length).toBe(0);
    expect(sim.elevatorUtilization(shaft.transportId!)).toBeUndefined();
  });
});
