import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation";
import { ensureStarterLobby, layTile, MID } from "../../tests/fixtures/towerFixtures";

function towerWithElevator() {
  const sim = Simulation.newGame(7, "classic");
  sim.money = 1e9;
  ensureStarterLobby(sim);
  for (let f = 2; f <= 4; f++) for (let x = MID - 10; x < MID + 10; x++) layTile(sim, "floor", f, x);
  expect(sim.buildTransport("elevatorStandard", MID - 8, 1, 4).ok).toBe(true);
  const t = sim.tower.transportAt(1, MID - 8)!;
  return { sim, t };
}

describe("setCars", () => {
  it("keeps one carLoad entry per car when the fleet grows or shrinks", () => {
    const { sim, t } = towerWithElevator();
    expect(t.cars).toBe(1);
    t.carLoad = [3];
    expect(sim.tower.setCars(t.id, 3)).toBe(true);
    expect(t.carLoad).toEqual([3, 0, 0]);
    expect(sim.tower.setCars(t.id, 2)).toBe(true);
    expect(t.carLoad).toEqual([3, 0]);
  });

  it("realigns a carLoad of the wrong length whenever the fleet size changes", () => {
    const { sim, t } = towerWithElevator();
    t.carLoad = [];
    expect(sim.tower.setCars(t.id, 2)).toBe(true);
    expect(t.carLoad).toEqual([0, 0]);
    t.carLoad = [3, 4, 5, 6];
    expect(sim.tower.setCars(t.id, 3)).toBe(true);
    expect(t.carLoad).toEqual([3, 4, 5]);
  });

  it("leaves a shaft with no carLoad yet alone", () => {
    const { sim, t } = towerWithElevator();
    t.carLoad = undefined;
    expect(sim.tower.setCars(t.id, 2)).toBe(true);
    expect(t.carLoad).toBeUndefined();
  });
});
