import type { Simulation } from "../Simulation";
import { INVALID_REQUEST } from "../request";

/**
 * The result records of `TsEngine`'s commands, built as the Rust engine
 * builds them (`engine-rs/src/wasm_port.rs`): slot 0 the status (1 done, 0
 * refused), slot 1 the balance's change measured around the command, then the
 * command's own slots. A refusal's text goes to `reason`, which only the
 * members that answer a status clear.
 */

/** What a command reads and writes on the engine that runs it. */
export interface PortState {
  readonly sim: Simulation;
  reason: string | undefined;
}

/** Whether every value is a whole JS number within the safe integers, the
 *  test the Rust engine's `whole` makes. */
export const whole = (...ns: number[]): boolean => ns.every((n) => Number.isSafeInteger(n));

export const flag = (b: boolean): number => (b ? 1 : 0);

export function record(done: boolean, delta: number, own: readonly number[] = []): Float64Array {
  const r = new Float64Array(2 + own.length);
  r[0] = flag(done);
  r[1] = delta;
  r.set(own, 2);
  return r;
}

/** The answer to a command begun at balance `before`: done, or refused with
 *  `reason` (`INVALID_REQUEST` when the engine gave none). */
export function finish(e: PortState, before: number, done: boolean, reason?: string, own: readonly number[] = []): Float64Array {
  if (!done) e.reason = reason ?? INVALID_REQUEST;
  return record(done, e.sim.money - before, own);
}

export function refuse(e: PortState, reason: string, own: readonly number[] = []): Float64Array {
  e.reason = reason;
  return record(false, 0, own);
}
