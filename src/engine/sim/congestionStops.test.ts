import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation";
import { GRID } from "../facilities";
import { lay, mustBuild, placeUnit } from "../../tests/fixtures/towerFixtures";
import { loadFixtureSave } from "../../tests/perfCompare/scenarios";

/**
 * The congestion map splits each floor's riders across the shafts that stop
 * there, reading each shaft's stop list from the tower's per-revision cache
 * (`tower.stopsOf`). A stop edit bumps the revision, so the map follows it on
 * the next build even with the cache warm, a tower loaded cold builds the
 * same map, and the cached list holds exactly the floors of the span the
 * shaft does not skip, in order.
 */

function towerWithTwoBanks(): Simulation {
  const sim = Simulation.newGame(21);
  sim.simModel = "v2";
  sim.money = 1e12;
  lay(sim, "lobby", 1);
  for (let f = 2; f <= 10; f++) lay(sim, "floor", f);
  mustBuild(sim, "elevatorStandard", GRID.width - 6, 1, 10);
  mustBuild(sim, "elevatorStandard", GRID.width - 12, 1, 10);
  for (const f of [5, 8]) {
    for (let x = 0; x + 9 <= 90; x += 9) placeUnit(sim, "office", f, x).state = "occupied";
  }
  return sim;
}

describe("the congestion map's stop lists", () => {
  it("follows a stop edit with the stop cache warm, and matches a cold load", () => {
    const sim = towerWithTwoBanks();
    const both = sim.spatialCongestionByFloor();
    expect(both.get(5)).toBeGreaterThan(0);
    // Floor 5 loses one of its two shafts: the other carries all its riders.
    const second = sim.tower.transports[1];
    expect(sim.tower.setStop(second.id, 5, false)).toBe(true);
    const skipped = sim.spatialCongestionByFloor();
    expect(skipped.get(5)).toBeGreaterThan(both.get(5)!);
    expect([...skipped.keys()]).toEqual([...both.keys()]);
    // The map scales demand by the time of day, so the cold copy takes the same clock.
    const cold = Simulation.deserialize(sim.serialize());
    cold.clock.minutes = sim.clock.minutes;
    expect([...cold.spatialCongestionByFloor()]).toEqual([...skipped]);
    // And back: the stop returns, and so does the even split.
    expect(sim.tower.setStop(second.id, 5, true)).toBe(true);
    expect([...sim.spatialCongestionByFloor()]).toEqual([...both]);
  });

  it("splits a floor's riders only onto the shafts that stop there, an express included", () => {
    const sim = towerWithTwoBanks();
    sim.star = 5;
    const before = sim.spatialCongestionByFloor();
    // An express over the same floors stops only at the lobby and its top:
    // floors 5 and 8 sit on its skip list, so their readings do not move.
    mustBuild(sim, "elevatorExpress", GRID.width - 18, 1, 10);
    const express = sim.tower.transports[2];
    expect(express.kind).toBe("elevatorExpress");
    expect(express.skipFloors).toEqual(expect.arrayContaining([5, 8]));
    const after = sim.spatialCongestionByFloor();
    expect([after.get(5), after.get(8)]).toEqual([before.get(5), before.get(8)]);
    const cold = Simulation.deserialize(sim.serialize());
    cold.clock.minutes = sim.clock.minutes;
    expect([...cold.spatialCongestionByFloor()]).toEqual([...after]);
  });

  it("reads each span less its skipped floors from the cache, on a tower with express shafts, stairs and escalators", () => {
    const sim = Simulation.deserialize(loadFixtureSave("conformance/fixtures/split-tower-4.vctower"));
    const t = sim.tower;
    const kinds = new Set(t.transports.map((tr) => tr.kind));
    expect([...kinds]).toEqual(expect.arrayContaining(["elevatorExpress", "stairs", "escalator"]));
    expect(t.transports.some((tr) => (tr.skipFloors?.length ?? 0) > 0)).toBe(true);
    for (const tr of t.transports) {
      const skipped = new Set(tr.skipFloors ?? []);
      const span: number[] = [];
      for (let f = tr.bottom; f <= tr.top; f++) if (!skipped.has(f)) span.push(f);
      expect(t.stopsOf(tr)).toEqual(span);
    }
  });
});
