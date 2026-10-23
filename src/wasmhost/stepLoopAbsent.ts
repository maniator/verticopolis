import type { Simulation } from "../engine/Simulation";

/**
 * The stand-in for the TypeScript engine's step loop (`src/engine/sim/loop.ts`)
 * in a wasm-only build (`VC_ENGINE=wasm`, see `vite.config.ts` and
 * `src/build/engineBundle.ts`). The WASM host replaces `tick` on every tower it
 * hosts, so the loop never runs there; swapping it out keeps the TypeScript
 * simulation's time stepping out of the shipped bundle, and makes a tower the
 * host does not hold fail loudly instead of quietly ticking on TypeScript.
 * Same exports as the loop, checked by `stepLoopAbsent.test.ts`.
 */
export class StepLoopAbsentError extends Error {
  constructor(what: string) {
    super(`${what}: the TypeScript step loop is not part of this wasm-only build, so only the Rust engine can advance a tower`);
    this.name = "StepLoopAbsentError";
  }
}

export function tick(_sim: Simulation, _dtMinutes: number): void {
  throw new StepLoopAbsentError("tick");
}

export function advanceStep(_sim: Simulation, _dtMinutes: number): void {
  throw new StepLoopAbsentError("advanceStep");
}

export function onHour(_sim: Simulation): void {
  throw new StepLoopAbsentError("onHour");
}

export function onDay(_sim: Simulation): void {
  throw new StepLoopAbsentError("onDay");
}

export function finishConstruction(_sim: Simulation): void {
  throw new StepLoopAbsentError("finishConstruction");
}

/** The hour passes the tower has seen. It only reads a field, so it stays. The host keeps
 *  `onHourRuns` in step with the engine's frame. */
export function hourTicks(sim: Simulation): number {
  return sim.onHourRuns;
}
