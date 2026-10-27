import type { TowerEngine } from "./TowerEngine";

/**
 * The tower's population as the walkers' busyness gate reads it (#1234).
 * `RenderSim.population` walks every room on the TypeScript engine (about
 * 330 µs on the large tower), and the walker pass used to read it every frame.
 * Frames reuse the last count, and it is read again when:
 *
 * - the structure changes (`tower.revision` moves, so a build or a removal made
 *   while paused shows at once),
 * - the sim is a different object (a tower swap starts fresh, and the replaced
 *   tower is not held alive), or
 * - the sim has stepped (the clock minute moved) and at least
 *   {@link POPULATION_REFRESH_FRAMES} frames have passed since the last read.
 *
 * The frame count caps the cost at the top game speeds, where a step runs
 * every frame and the minute alone would miss every frame (#1335): the walk
 * runs about twice a second at 60 Hz whatever the speed.
 *
 * The count therefore trails the sim by up to that many frames (about half a
 * second), and by more on two paths the key cannot see: the worker host moves
 * the minute on the main thread before the step's reply (the unit states)
 * lands, and a paused emergency answer that guts rooms (a declined bomb
 * threat) changes states with no step. The gate only scales a cosmetic crowd
 * and saturates at 350, so the lag is invisible.
 */
export const POPULATION_REFRESH_FRAMES = 30;

interface Memo {
  minutes: number;
  revision: number;
  population: number;
  /** Frames since the last read in which the sim had stepped. */
  stale: number;
}

const memos = new WeakMap<object, Memo>();

export function crowdPopulation(engine: TowerEngine): number {
  const sim = engine.sim;
  const minutes = sim.clock.minutes;
  const revision = sim.tower.revision;
  const memo = memos.get(sim);
  if (memo && memo.revision === revision && (memo.minutes === minutes || ++memo.stale < POPULATION_REFRESH_FRAMES)) {
    return memo.population;
  }
  const population = sim.population;
  memos.set(sim, { minutes, revision, population, stale: 0 });
  return population;
}
