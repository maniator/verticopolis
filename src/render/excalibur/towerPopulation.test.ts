import { describe, expect, it } from "vitest";
import { newSeededGame } from "../../tests/fixtures/towerFixtures";
import type { TowerEngine } from "./TowerEngine";
import { crowdPopulation } from "./towerPopulation";

/** An engine stand-in around a live sim whose `population` read is counted. */
function counted(sim: ReturnType<typeof newSeededGame>) {
  const reads = { n: 0 };
  Object.defineProperty(sim, "population", {
    configurable: true,
    get: () => {
      reads.n++;
      return 42;
    },
  });
  return { reads, sim, engine: { sim } as unknown as TowerEngine };
}

describe("crowdPopulation", () => {
  it("reads the population once for any number of frames in a step", () => {
    const { reads, engine } = counted(newSeededGame(7, "modern"));
    for (let frame = 0; frame < 120; frame++) expect(crowdPopulation(engine)).toBe(42);
    expect(reads.n).toBe(1);
  });

  it("reads again after the sim steps, once per step", () => {
    const { reads, sim, engine } = counted(newSeededGame(7, "modern"));
    crowdPopulation(engine);
    for (let step = 1; step <= 3; step++) {
      sim.tick(1);
      crowdPopulation(engine);
      crowdPopulation(engine);
      expect(reads.n).toBe(step + 1);
    }
  });

  it("reads again after a structural edit made while paused", () => {
    const { reads, sim, engine } = counted(newSeededGame(7, "modern"));
    crowdPopulation(engine);
    const minutes = sim.clock.minutes;
    sim.tower.revision++;
    crowdPopulation(engine);
    expect(sim.clock.minutes).toBe(minutes);
    expect(reads.n).toBe(2);
  });

  it("reads again when a host merge moves the minute or the revision under the same sim", () => {
    const { reads, sim, engine } = counted(newSeededGame(7, "modern"));
    crowdPopulation(engine);
    // What a host merge does: set the minute and the revision from the engine.
    sim.clock.minutes += 60;
    crowdPopulation(engine);
    sim.tower.revision = 0;
    crowdPopulation(engine);
    expect(reads.n).toBe(3);
  });

  it("follows a real population change by the next step", () => {
    const sim = newSeededGame(7, "modern");
    const engine = { sim } as unknown as TowerEngine;
    expect(crowdPopulation(engine)).toBe(sim.population);
    for (let step = 0; step < 6; step++) {
      sim.tick(1);
      expect(crowdPopulation(engine)).toBe(sim.population);
    }
  });

  it("is at most a step behind a state change that moves neither the minute nor the revision", () => {
    // A declined bomb threat guts rooms with no step: the count the gate reads
    // holds until the next step (documented beside the cache).
    const sim = newSeededGame(7, "modern");
    let live = 100;
    Object.defineProperty(sim, "population", { configurable: true, get: () => live });
    const engine = { sim } as unknown as TowerEngine;
    expect(crowdPopulation(engine)).toBe(100);
    live = 0;
    expect(crowdPopulation(engine)).toBe(100);
    sim.tick(1);
    expect(crowdPopulation(engine)).toBe(0);
  });

  it("reads again for a replaced tower, even at the same minute and revision", () => {
    const first = counted(newSeededGame(7, "modern"));
    crowdPopulation(first.engine);
    const second = counted(newSeededGame(7, "modern"));
    const engine = first.engine;
    (engine as { sim: unknown }).sim = second.engine.sim;
    expect(crowdPopulation(engine)).toBe(42);
    expect(second.reads.n).toBe(1);
  });
});
