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

describe("setCars and the shift schedule (#1546)", () => {
  const night = (full: number): number[] => Array.from({ length: 24 }, (_, h) => [0, 0, 0, 0, 0, 0, 1, 1, 1][h] ?? full);

  it("runs the new cars in every hour that ran the whole fleet", () => {
    const { sim, t } = towerWithElevator();
    t.schedule = { activeCars: { weekday: Array(24).fill(1), weekend: Array(24).fill(1) } };
    expect(sim.tower.setCars(t.id, 2)).toBe(true);
    expect(t.schedule?.activeCars).toEqual({ weekday: Array(24).fill(2), weekend: Array(24).fill(2) });
    expect(sim.tower.setCars(t.id, 4)).toBe(true);
    expect(t.schedule?.activeCars).toEqual({ weekday: Array(24).fill(4), weekend: Array(24).fill(4) });
  });

  it("keeps off-shift and cut-back hours, and the two day types apart", () => {
    const { sim, t } = towerWithElevator();
    expect(sim.tower.setCars(t.id, 3)).toBe(true);
    t.schedule = { activeCars: { weekday: night(3), weekend: Array(24).fill(1) } };
    expect(sim.tower.setCars(t.id, 4)).toBe(true);
    expect(t.schedule?.activeCars?.weekday).toEqual(night(4));
    expect(t.schedule?.activeCars?.weekend).toEqual(Array(24).fill(1));
  });

  it("leaves an unscheduled shaft and the staging alone, and a shrink clamps", () => {
    const { sim, t } = towerWithElevator();
    expect(sim.tower.setCars(t.id, 2)).toBe(true);
    expect(t.schedule).toBeUndefined();
    t.schedule = { activeCars: { weekday: Array(24).fill(2) }, homeFloors: [1, 3] };
    expect(sim.tower.setCars(t.id, 3)).toBe(true);
    expect(t.schedule?.activeCars?.weekday).toEqual(Array(24).fill(3));
    expect(t.schedule?.homeFloors).toEqual([1, 3]);
    expect(sim.tower.setCars(t.id, 2)).toBe(true);
    expect(t.schedule?.activeCars?.weekday).toEqual(Array(24).fill(2));
  });
});
