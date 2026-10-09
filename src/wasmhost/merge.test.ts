import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { mergeSimulation } from "./merge";

/** A tower with a lobby row, two offices and a shaft, ticked a little. */
function tower(seed: number): Simulation {
  const sim = Simulation.newGame(seed, "classic");
  sim.money = 1e9;
  for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  expect(sim.build("office", 2, 175).ok).toBe(true);
  expect(sim.build("office", 2, 186).ok).toBe(true);
  expect(sim.buildTransport("stairs", 170, 1, 2).ok).toBe(true);
  return sim;
}

const withoutLog = (save: ReturnType<Simulation["serialize"]>) => {
  const { log: _log, ...rest } = save as typeof save & { log?: unknown };
  return rest;
};

describe("mergeSimulation", () => {
  it("makes the target serialize as the fresh instance while every held object keeps its identity", () => {
    const target = tower(5);
    const fresh = tower(5);
    fresh.tick(180);
    expect(fresh.build("office", 3, 175).ok).toBe(true);
    fresh.tower.towerName = "Merged";
    fresh.money = 123456;
    const heldTower = target.tower;
    const heldUnit = target.tower.units[0];
    const heldTransport = target.tower.transports[0];
    const heldUnits = target.tower.units;
    const heldById = target.tower.byId;
    const heldClock = target.clock;
    const founder = target.founder;

    const targetLog = [...target.log];
    const targetLogSeq = target.logSeq;
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), { revision: 99, mealOverlayRevision: 3 });

    // Everything the save carries follows the fresh instance, except the log
    // and its cursor, which the frame sync appends on its own.
    expect(withoutLog(target.serialize())).toEqual(withoutLog(fresh.serialize()));
    expect(target.log).toEqual(targetLog);
    expect(target.logSeq).toBe(targetLogSeq);
    expect(target.tower).toBe(heldTower);
    expect(target.tower.units).toBe(heldUnits);
    expect(target.tower.byId).toBe(heldById);
    expect(target.clock).toBe(heldClock);
    expect(target.tower.units[0]).toBe(heldUnit);
    expect(target.tower.transports[0]).toBe(heldTransport);
    expect(target.tower.byId.get(heldUnit.id)).toBe(heldUnit);
    expect(target.tower.units.length).toBe(fresh.tower.units.length);
    expect(target.tower.revision).toBe(99);
    expect(target.tower.mealOverlayRevision).toBe(3);
    expect(target.founder).toBe(founder);
    expect(target.clock.minutes).toBe(fresh.clock.minutes);
    expect(target.tower.towerName).toBe("Merged");
  });

  it("drops a unit the fresh instance no longer has and keeps the crowd", () => {
    const target = tower(9);
    const fresh = tower(9);
    const gone = fresh.tower.units.find((u) => u.kind === "office")!;
    fresh.tower.removeUnit(gone.id);
    target.crowd.people.push({ id: 1, seed: 1, state: "toDest", floor: 1, fy: 0, x: 170, floors: [], originFloor: 1, shafts: [], leg: 0, shaftId: null, carIndex: null, destX: 170, wait: 0, tripWait: 0, age: 0, linger: 0 });
    mergeSimulation(target, Simulation.deserialize(fresh.serialize()), { revision: 1, mealOverlayRevision: 0 });
    expect(target.tower.byId.has(gone.id)).toBe(false);
    expect(target.tower.units.some((u) => u.id === gone.id)).toBe(false);
    expect(target.crowd.people.length).toBe(1);
    expect(withoutLog(target.serialize())).toEqual(withoutLog(fresh.serialize()));
  });
});
