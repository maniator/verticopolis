import { it } from "vitest";

/**
 * The per-test markers of the WASM parity projects (story-engine-test-parity,
 * #878). Those projects ran the unit and integration suites again with every
 * `Simulation` a test ticked hosted on the Rust engine. A test that proved
 * the TypeScript engine only carried `itTypeScriptOnly(reason)` and was
 * skipped there; one that read only what the engine's frame carries called
 * `atEngineFrameCadence(reason)` to run at the host's own merge cadence.
 *
 * #1421 deleted the projects and the setup that hosted them, so nothing
 * raises {@link WASM_PARITY_FLAG} and every marked test runs as a plain test
 * on the TypeScript engine, as it always did on the `unit` and `integration`
 * projects. The marks stay, each with its reason, because
 * `exclusions.ratchet.txt` and section 7 of the parity register count them;
 * they go with the marked suites when the TypeScript engine is deleted.
 */
export const WASM_PARITY_FLAG = "__vcWasmParityProject";

/** Whether a parity project's setup raised the flag; false since #1421. */
export function onWasmParityProject(): boolean {
  return (globalThis as Record<string, unknown>)[WASM_PARITY_FLAG] === true;
}

/** `it` for a test that stays on the TypeScript engine, with the reason the
 *  table records (the reason is required, so a bare skip cannot land). */
export function itTypeScriptOnly(reason: string): (name: string, fn: () => void | Promise<void>, timeout?: number) => void {
  if (!reason.trim()) throw new Error("itTypeScriptOnly needs the reason the test stays on the TypeScript engine");
  return (name, fn, timeout) => {
    it(name, fn, timeout);
  };
}

/** The mark for a test that reads only what the engine's frame carries; it
 *  changes nothing now that no parity project hosts the test. The reason is
 *  required, and the story's test-mapping table repeats it. */
export function atEngineFrameCadence(reason: string): void {
  if (!reason.trim()) throw new Error("atEngineFrameCadence needs the reason the test reads only what the frame carries");
}

/** A hosted instance's full refresh from its engine; nothing is hosted since
 *  #1421, so it does nothing. */
export function refreshFromEngine(_sim: object): void {}
