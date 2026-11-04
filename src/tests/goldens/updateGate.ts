import { renameSync, writeFileSync } from "node:fs";
import { afterAll, type RunnerTask } from "vitest";

/**
 * The refresh rule every golden here keeps: its own switch writes it only from
 * a run in which every test in the writing file ran and passed, never in CI.
 * Each golden has its own switch, and each switch names one writer, so a
 * refresh of one golden (or of the conformance lock, `VC_CONFORMANCE_UPDATE=1`)
 * never rewrites another, and no run has two suites writing the same file:
 * - `VC_FRAME_DAYS_UPDATE=1`: the frame-day golden, from the Rust engine;
 * - `VC_CARD_TEXT_UPDATE=typescript`: the card-text towers and their lines,
 *   from the TypeScript referee;
 * - `VC_CARD_TEXT_UPDATE=rust`: the card-text lines, from the Rust sweep, on
 *   the committed towers.
 */

/** A switch's value, or undefined when it is unset, empty or "0" (off, as
 *  for `VC_CONFORMANCE_UPDATE`). */
function refreshSwitch<T extends string>(name: string, values: readonly T[]): T | undefined {
  const value = process.env[name];
  if (value === undefined || value === "" || value === "0") return undefined;
  if (process.env.CI) throw new Error(`${name} is a local regeneration switch and never runs in CI`);
  if (!(values as readonly string[]).includes(value)) throw new Error(`${name} must be ${values.join(" or ")}, not ${JSON.stringify(value)}`);
  return value as T;
}

/** `VC_FRAME_DAYS_UPDATE=1`: the Rust run writes the frame-day golden. */
export const FRAME_DAYS_UPDATE = refreshSwitch("VC_FRAME_DAYS_UPDATE", ["1"]) === "1";

/** Which suite writes the card-text golden in this run, if any. The other
 *  suite skips, since it would read files the writer is replacing; run it on
 *  the new files afterwards. Once the referee goes with `src/engine/`, the
 *  sweep is the only writer. */
export type CardTextWriter = "typescript" | "rust";
export const CARD_TEXT_WRITER: CardTextWriter | undefined = refreshSwitch("VC_CARD_TEXT_UPDATE", ["typescript", "rust"] as const);

/** The full names of the tests under `task` that did not pass: the ones
 *  that failed, and the ones a filter (`-t`) or a skip left out. */
export function testsNotPassed(task: RunnerTask, path: readonly string[] = []): string[] {
  const here = task.type === "suite" && task.name ? [...path, task.name] : path;
  if (task.type === "suite") return task.tasks.flatMap((t) => testsNotPassed(t, here));
  const state = task.result?.state ?? task.mode;
  return state === "pass" ? [] : [`${[...here, task.name].join(" > ")} (${state})`];
}

/**
 * When `writing` is on, write the golden once the test file has finished, and
 * only when every test in it ran and passed and `unfinished()` names no case
 * (it returns the cases that never produced output). A `-t` filter that
 * leaves a test out writes nothing. Call it at the top level of the file,
 * outside any `describe`, so the gate covers the whole file; a call inside a
 * `describe` fails the run even when `writing` is off.
 */
export function writeAfterPassingRun(what: string, writing: boolean, unfinished: () => readonly string[], write: () => void): void {
  // Vitest reads the first argument as fixtures and wants an object pattern
  // there; the file's suite comes second.
  // eslint-disable-next-line no-empty-pattern
  afterAll(({}, suite) => {
    if (!("filepath" in suite)) throw new Error(`writeAfterPassingRun for the ${what} belongs at the top level of the test file`);
    if (!writing) return;
    const notPassed = testsNotPassed(suite);
    if (notPassed.length > 0) throw new Error(`${what} NOT written; every test in the file has to run and pass, and these did not: ${notPassed.join("; ")}`);
    const missing = unfinished();
    if (missing.length > 0) throw new Error(`${what} NOT written; these cases did not finish: ${missing.join(", ")}`);
    write();
  });
}

/** Write a golden file whole or not at all, so a test reading it beside the
 *  writer never sees half of one. */
export function writeGoldenFile(file: string, text: string | Uint8Array): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}
