import { describe, expect, it } from "vitest";
import type { TowerEngine } from "./TowerEngine";
import { POPULATION_REFRESH_FRAMES, crowdPopulation } from "./towerPopulation";

/** Game minutes one step moves the clock in the stand-in. */
const MINUTES_PER_STEP = 1;
/** People the stand-in tower gains on each step. */
const ARRIVALS_PER_STEP = 5;
/** The revision a new tower opens at: its starter lobby is one edit. */
const STARTER_REVISION = 1;

/** A stand-in for the renderer's sim, holding only the reads the gate makes:
 *  the clock, the tower's revision and the population. A step moves the
 *  minute and adds arrivals. */
function newSim() {
  return {
    clock: { minutes: 0 },
    tower: { revision: STARTER_REVISION },
    people: 0,
    get population(): number {
      return this.people;
    },
    tick(steps: number): void {
      this.clock.minutes += steps * MINUTES_PER_STEP;
      this.people += steps * ARRIVALS_PER_STEP;
    },
  };
}

/** An engine stand-in around a sim whose `population` read is counted. */
function counted(sim: ReturnType<typeof newSim>) {
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
    const { reads, engine } = counted(newSim());
    frames(engine, 500);
    expect(reads.n).toBe(1);
  });

  it("holds the count for the refresh window after a step, then reads again", () => {
    const { reads, sim, engine } = counted(newSim());
    sim.tick(1);
    crowdPopulation(engine);
    expect(reads.n).toBe(1);
    sim.tick(1);
    frames(engine, POPULATION_REFRESH_FRAMES - 1);
    expect(reads.n).toBe(1);
    crowdPopulation(engine);
    expect(reads.n).toBe(2);
    frames(engine, 200); // no further step: nothing more to read
    expect(reads.n).toBe(2);
  });

  it("reads a few times a second when a step runs every frame, not every frame", () => {
    const { reads, sim, engine } = counted(newSim());
    for (let frame = 0; frame < 120; frame++) {
      sim.clock.minutes += 2; // top speed: the minute moves in every frame
      crowdPopulation(engine);
    }
    expect(reads.n).toBe(1 + Math.floor(119 / POPULATION_REFRESH_FRAMES));
  });

  it("reads again at once after a structural edit made while paused", () => {
    const { reads, sim, engine } = counted(newSim());
    crowdPopulation(engine);
    const minutes = sim.clock.minutes;
    sim.tower.revision++;
    crowdPopulation(engine);
    expect(sim.clock.minutes).toBe(minutes);
    expect(reads.n).toBe(2);
  });

  it("reads again when a host merge moves the revision under the same sim", () => {
    const { reads, sim, engine } = counted(newSim());
    crowdPopulation(engine);
    sim.tower.revision = 0; // what a host merge does: the engine's own count
    crowdPopulation(engine);
    expect(reads.n).toBe(2);
  });

  it("follows a population change within the refresh window", () => {
    const sim = newSim();
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
    const sim = newSim();
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
    const first = counted(newSim());
    crowdPopulation(first.engine);
    const second = counted(newSim());
    const engine = first.engine;
    (engine as { sim: unknown }).sim = second.sim;
    expect(crowdPopulation(engine)).toBe(42);
    expect(second.reads.n).toBe(1);
  });
});
