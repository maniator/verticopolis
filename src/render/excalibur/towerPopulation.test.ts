import { describe, expect, it } from "vitest";
import { newSeededGame } from "../../tests/fixtures/towerFixtures";
import type { TowerEngine } from "./TowerEngine";
import { POPULATION_REFRESH_FRAMES, crowdPopulation } from "./towerPopulation";

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

/** Render `frames` frames, each reading the gate once. */
function frames(engine: TowerEngine, n: number): void {
  for (let i = 0; i < n; i++) crowdPopulation(engine);
}

describe("crowdPopulation", () => {
  it("reads the population once for any number of frames in a step", () => {
    const { reads, engine } = counted(newSeededGame(7, "modern"));
    frames(engine, 500);
    expect(reads.n).toBe(1);
  });

  it("holds the count for the refresh window after a step, then reads again", () => {
    const { reads, sim, engine } = counted(newSeededGame(7, "modern"));
    crowdPopulation(engine);
    sim.tick(1);
    frames(engine, POPULATION_REFRESH_FRAMES - 1);
    expect(reads.n).toBe(1);
    crowdPopulation(engine);
    expect(reads.n).toBe(2);
    frames(engine, 200); // no further step: nothing more to read
    expect(reads.n).toBe(2);
  });

  it("reads a few times a second when a step runs every frame, not every frame", () => {
    const { reads, sim, engine } = counted(newSeededGame(7, "modern"));
    for (let frame = 0; frame < 120; frame++) {
      sim.clock.minutes += 2; // top speed: the minute moves in every frame
      crowdPopulation(engine);
    }
    expect(reads.n).toBe(1 + Math.floor(119 / POPULATION_REFRESH_FRAMES));
  });

  it("reads again at once after a structural edit made while paused", () => {
    const { reads, sim, engine } = counted(newSeededGame(7, "modern"));
    crowdPopulation(engine);
    const minutes = sim.clock.minutes;
    sim.tower.revision++;
    crowdPopulation(engine);
    expect(sim.clock.minutes).toBe(minutes);
    expect(reads.n).toBe(2);
  });

  it("reads again when a host merge moves the revision under the same sim", () => {
    const { reads, sim, engine } = counted(newSeededGame(7, "modern"));
    crowdPopulation(engine);
    sim.tower.revision = 0; // what a host merge does: the engine's own count
    crowdPopulation(engine);
    expect(reads.n).toBe(2);
  });

  it("follows a real population change within the refresh window", () => {
    const sim = newSeededGame(7, "modern");
    const engine = { sim } as unknown as TowerEngine;
    expect(crowdPopulation(engine)).toBe(sim.population);
    for (let step = 0; step < 4; step++) {
      sim.tick(1);
      frames(engine, POPULATION_REFRESH_FRAMES);
      expect(crowdPopulation(engine)).toBe(sim.population);
    }
  });

  it("is behind a state change that moves neither the minute nor the revision until the next step", () => {
    // A declined bomb threat guts rooms with no step: the count the gate reads
    // holds until the sim steps and the window passes (documented beside the cache).
    const sim = newSeededGame(7, "modern");
    let live = 100;
    Object.defineProperty(sim, "population", { configurable: true, get: () => live });
    const engine = { sim } as unknown as TowerEngine;
    expect(crowdPopulation(engine)).toBe(100);
    live = 0;
    frames(engine, 200);
    expect(crowdPopulation(engine)).toBe(100);
    sim.tick(1);
    frames(engine, POPULATION_REFRESH_FRAMES);
    expect(crowdPopulation(engine)).toBe(0);
  });

  it("reads again for a replaced tower, even at the same minute and revision", () => {
    const first = counted(newSeededGame(7, "modern"));
    crowdPopulation(first.engine);
    const second = counted(newSeededGame(7, "modern"));
    const engine = first.engine;
    (engine as { sim: unknown }).sim = second.sim;
    expect(crowdPopulation(engine)).toBe(42);
    expect(second.reads.n).toBe(1);
  });
});
