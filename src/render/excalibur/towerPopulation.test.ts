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
