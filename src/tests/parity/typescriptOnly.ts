import { expect, it } from "vitest";

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
const TICKED_FLAG = "__vcWasmParityTicked";
/** Where `wasmHostSetup.ts` puts its refresh, for {@link refreshFromEngine}. */
export const REFRESH_HOOK = "__vcWasmParityRefresh";

/** Called at the top of a test that reads only what the engine's frame
 *  carries every tick (the people, the clock, the unit states and counters)
 *  or the engine's own save at the end, and ticks too often for a full merge
 *  after every tick (a fixture save, or a day of minute ticks). On the parity
 *  projects the test then runs at the host's own cadence, a merge on an hour
 *  pass or a tower edit, as the game does; elsewhere it does nothing. The
 *  reason is required, and the story's test-mapping table repeats it. */
export function atEngineFrameCadence(reason: string): void {
  if (!reason.trim()) throw new Error("atEngineFrameCadence needs the reason the test reads only what the frame carries");
  if (!onWasmParityProject()) return;
  // The request lasts one test and has to come before its first hosted
  // tick, so a host never changes cadence partway through a run.
  if (expect.getState().currentTestName === undefined) throw new Error("atEngineFrameCadence is called inside a test body (the setup clears it after each test)");
  if ((globalThis as Record<string, unknown>)[TICKED_FLAG] === true) throw new Error("atEngineFrameCadence is called before the test's first tick");
  (globalThis as Record<string, unknown>)[FRAME_CADENCE_FLAG] = true;
}

/** Whether the running test asked for the host's own cadence. */
export function frameCadenceRequested(): boolean {
  return (globalThis as Record<string, unknown>)[FRAME_CADENCE_FLAG] === true;
}

/** Merge the engine's full save into a hosted instance now, for a test at
 *  the host's own cadence that asserts on state the frame does not carry
 *  (a unit's `residents`, say). Does nothing off the parity projects or
 *  on an instance that is not hosted. */
export function refreshFromEngine(sim: object): void {
  const hook = (globalThis as Record<string, unknown>)[REFRESH_HOOK];
  if (typeof hook === "function") (hook as (sim: object) => void)(sim);
}

/** `wasmHostSetup.ts` notes each hosted tick, so a late request throws. */
export function noteHostedTick(): void {
  (globalThis as Record<string, unknown>)[TICKED_FLAG] = true;
}

/** Drop the request and the tick note; `wasmHostSetup.ts` calls it after
 *  each test. */
export function clearFrameCadence(): void {
  delete (globalThis as Record<string, unknown>)[FRAME_CADENCE_FLAG];
  delete (globalThis as Record<string, unknown>)[TICKED_FLAG];
}
