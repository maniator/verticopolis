/**
 * The fuzz corpus: scenarios the seeded differential once diverged on (and
 * smoke entries that keep the job from running on nothing), kept under
 * `conformance/fuzz-corpus/`. Each entry has a golden: the native Rust run's
 * records (`<id>.rs.json` and `<id>.rs.detail.json`, as `fuzz --replay` writes
 * them) pinned under `conformance/fuzz-corpus/goldens/`. A pull request that
 * touches the engine replays every entry natively and through the WASM build
 * and fails when either run leaves its golden (`scripts/fuzz-corpus.ts`).
 * Corpus entries are not part of the locked conformance suite, so a golden
 * that moves on purpose is refreshed with `fuzz-corpus --update` and does
 * not move the crate version.
 */
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CONFORMANCE_DIR } from "./scenario";

/** A corpus file name: lowercase words and digits joined by dashes. */
export const CORPUS_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const corpusDir = (): string => resolve(CONFORMANCE_DIR, "fuzz-corpus");

/** Where each entry's pinned native Rust records live. */
export const goldenDir = (dir: string = corpusDir()): string => resolve(dir, "goldens");

/** The two record files of one entry's golden, by the entry's id. */
export const goldenFiles = (id: string): [string, string] => [`${id}.rs.json`, `${id}.rs.detail.json`];

/** The records `fuzz --replay` writes next to a scenario (`<id>.rs.json` and
 *  `<id>.rs.detail.json`) are not entries. */
const RECORD = /\.rs(\.detail)?\.json$/;

/** The corpus files, sorted. */
export function corpusFiles(dir: string = corpusDir()): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !RECORD.test(f))
    .sort()
    .map((f) => resolve(dir, f));
}

/** What the Rust half of one entry's replay means: 0 ran, 1 the engine
 *  refused the scenario and 101 is a panic (both fail the entry), anything else
 *  (a cut-off, a missing file, bad input) is the harness failing. */
export function rustVerdict(code: number): "ok" | "failed" | "harness" {
  if (code === 0) return "ok";
  return code === 1 || code === 101 ? "failed" : "harness";
}

/** The corpus job's exit code: a failed entry beats a harness failure, so a
 *  divergence is never reported as a mere tooling problem. */
export function corpusExit(failed: readonly string[], harness: boolean): 0 | 1 | 3 {
  if (failed.length) return 1;
  return harness ? 3 : 0;
}

/** Entries to add to `failed` once the loop is done: the run as a whole must
 *  not outlast the budget even when no single entry was cut off. */
export function lateFailure(elapsedSeconds: number, budgetSeconds: number, failed: readonly string[]): string[] {
  return elapsedSeconds > budgetSeconds && !failed.some((f) => f.endsWith("(over budget)")) ? ["(the last entry ran past the budget)"] : [];
}
