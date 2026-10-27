import type { TowerEngine } from "./TowerEngine";

/**
 * The tower's population as the walkers' busyness gate reads it (#1234).
 * `RenderSim.population` walks every room on the TypeScript engine (about
 * 330 µs on the large tower), and the walker pass used to read it every frame.
 * It is taken once per (clock minute, `tower.revision`) and the frames between
 * reuse it: a sim step moves the minute, a structural edit made while paused
 * moves the revision, and each sim has its own entry, so a tower swap starts
 * fresh and the replaced tower is not held alive.
 *
 * The count also reads unit states and customers, which are not in the key.
 * They move with a step, so the value is at most one step behind, and the next
 * step corrects it. Two paths can hold it longer: the worker host moves the
 * minute on the main thread before the step's reply (the unit states) lands,
 * and a paused emergency answer that guts rooms (a declined bomb threat)
 * changes states with no step. Both leave a stale count until the next step,
 * which the gate hides: it only scales a cosmetic crowd and saturates at 350.
 */
interface Memo {
  minutes: number;
  revision: number;
  population: number;
}

const memos = new WeakMap<object, Memo>();

export function crowdPopulation(engine: TowerEngine): number {
  const sim = engine.sim;
  const minutes = sim.clock.minutes;
  const revision = sim.tower.revision;
  const memo = memos.get(sim);
  if (memo && memo.minutes === minutes && memo.revision === revision) return memo.population;
  const population = sim.population;
  memos.set(sim, { minutes, revision, population });
  return population;
}
