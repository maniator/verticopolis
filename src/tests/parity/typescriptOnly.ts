import { it } from "vitest";

/**
 * The per-test TypeScript-only marker of the WASM parity projects
 * (story-engine-test-parity, #878). A test that drives the instance through
 * something no relayed command carries (a clock jump after the crowd exists,
 * a direct write to a live counter the save never holds, a subsystem call
 * such as `economy.hotelCheckout()`, the sampled v1 model) proves the
 * TypeScript engine only; on `integrationWasm` and `unitWasm` it is skipped,
 * its name suffixed with `[TypeScript-only: <reason>]`, and the story's
 * test-mapping table lists every file that uses the marker with the same
 * reason. On the plain `unit` and `integration` projects the marker is `it`
 * itself, under the plain name.
 *
 * `wasmHostSetup.ts` raises the flag; a test file never sets it.
 */
export const WASM_PARITY_FLAG = "__vcWasmParityProject";

export function onWasmParityProject(): boolean {
  return (globalThis as Record<string, unknown>)[WASM_PARITY_FLAG] === true;
}

/** `it` for a test that stays on the TypeScript engine, with the reason the
 *  table records (the reason is required, so a bare skip cannot land). */
export function itTypeScriptOnly(reason: string): (name: string, fn: () => void | Promise<void>, timeout?: number) => void {
  if (!reason.trim()) throw new Error("itTypeScriptOnly needs the reason the test stays on the TypeScript engine");
  // On the parity projects the skipped test's name carries the reason, so a
  // report lists why each skip is there.
  if (onWasmParityProject()) {
    return (name, fn, timeout) => {
      it.skip(`${name} [TypeScript-only: ${reason}]`, fn, timeout);
    };
  }
  return (name, fn, timeout) => {
    it(name, fn, timeout);
  };
}

const FRAME_CADENCE_FLAG = "__vcWasmParityFrameCadence";

/** Called at the top of a test that reads only what the engine's frame
 *  carries every tick (the people, the clock, the unit states and counters)
 *  or the engine's own save at the end, and ticks too often for a full merge
 *  after every tick (a fixture save, or a day of minute ticks). On the parity
 *  projects the test then runs at the host's own cadence, a merge on an hour
 *  pass or a tower edit, as the game does; elsewhere it does nothing. The
 *  reason is required, and the story's test-mapping table repeats it. */
export function atEngineFrameCadence(reason: string): void {
  if (!reason.trim()) throw new Error("atEngineFrameCadence needs the reason the test reads only what the frame carries");
  if (onWasmParityProject()) (globalThis as Record<string, unknown>)[FRAME_CADENCE_FLAG] = true;
}

/** Whether the running test asked for the host's own cadence. */
export function frameCadenceRequested(): boolean {
  return (globalThis as Record<string, unknown>)[FRAME_CADENCE_FLAG] === true;
}

/** Drop the request; `wasmHostSetup.ts` calls it after each test. */
export function clearFrameCadence(): void {
  delete (globalThis as Record<string, unknown>)[FRAME_CADENCE_FLAG];
}
