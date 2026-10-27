import type { TowerEngine } from "./TowerEngine";

/**
 * The tower's population as the walkers' busyness gate reads it (#1234).
 * `RenderSim.population` walks every room on the TypeScript engine (about
 * 330 µs on the large tower), and the walker pass used to read it every frame.
 * The count only moves when the sim steps or the structure changes, so it is
 * taken once per (step, revision) and the frames between reuse it. The sim's
 * clock minute stands for the step (a step always advances it), `tower.revision`
 * covers an edit made while paused, and the sim itself covers a tower swap.
 */
interface Memo {
  sim: object | null;
  minutes: number;
  revision: number;
  population: number;
}

const memos = new WeakMap<TowerEngine, Memo>();

export function crowdPopulation(engine: TowerEngine): number {
  const sim = engine.sim;
  const minutes = sim.clock.minutes;
  const revision = sim.tower.revision;
  let memo = memos.get(engine);
  if (memo && memo.sim === sim && memo.minutes === minutes && memo.revision === revision) return memo.population;
  const population = sim.population;
  if (!memo) memos.set(engine, (memo = { sim, minutes, revision, population }));
  else {
    memo.sim = sim;
    memo.minutes = minutes;
    memo.revision = revision;
    memo.population = population;
  }
  return population;
}
