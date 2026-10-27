/**
 * Replay one scenario file on the TypeScript engine and compare it with the
 * Rust records beside it (`<id>.rs.json` and `<id>.rs.detail.json`, as the
 * fuzzer or `fuzz --replay` writes them). `scripts/fuzz-compare.ts` (the
 * nightly), `scripts/fuzz-shrink.ts` and `scripts/fuzz-corpus.ts` all go
 * through it, so the three agree on what a divergence is.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { compareRuns, describeDivergence } from "./fuzzCompare";
import { DetailError, type CheckpointDetail } from "./checkpointDetail";
import { loadScenario, runScenario, type Checkpoint } from "./scenario";

export type ReplayResult =
  | { status: "ok"; checkpoints: number }
  /** `signature` names the kind of divergence (`state:units`, `money`, `threw`)
   *  without its position, so a shrinker can tell that a smaller scenario
   *  still shows the same thing. */
  | { status: "diverged"; signature: string; message: string }
  /** The harness itself failed: a missing or malformed record, an unreadable
   *  scenario. Never an engine divergence. */
  | { status: "harness"; message: string };

/** What a TypeScript refusal names, so a shrink cannot settle on a different
 *  refusal: the runner's messages start with the command (`build fitnessClub @
 *  4,196 failed: ...`, `buildTransport elevatorExpress @ x212 failed: ...`,
 *  `resolveChoice: cannot pay`), so the words before ` @`, ` failed` or `:`
 *  become part of the signature. A message of another shape is plain `threw`. */
export function throwSignature(message: string): string {
  const head = /^([A-Za-z][\w-]*(?: [A-Za-z][\w-]*)?)(?: @| failed|:)/.exec(message);
  return head ? `threw:${head[1].replace(/ /g, ":")}` : "threw";
}

const harness = (message: string): ReplayResult => ({ status: "harness", message: `HARNESS: ${message}` });

function readRecord<T>(path: string, what: string): T[] | string {
  if (!existsSync(path)) return `no ${what} at ${path} (did the fuzzer finish?)`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return `${path}: ${(e as Error).message}`;
  }
  return Array.isArray(parsed) ? (parsed as T[]) : `${path}: expected a ${what} array`;
}

/** Run `file` on the TypeScript engine and compare it with the Rust records in
 *  `rustDir` (the scenario's own folder by default). */
export function replayCompare(file: string, rustDir: string = dirname(file)): ReplayResult {
  const stem = basename(file).replace(/\.json$/, "");
  const checkpointsPath = join(rustDir, `${stem}.rs.json`);
  const detailsPath = join(rustDir, `${stem}.rs.detail.json`);
  const rustCheckpoints = readRecord<Checkpoint>(checkpointsPath, "Rust checkpoints");
  if (typeof rustCheckpoints === "string") return harness(rustCheckpoints);
  const rustDetails = readRecord<CheckpointDetail>(detailsPath, "Rust checkpoint detail");
  if (typeof rustDetails === "string") return harness(rustDetails);
  let scenario: ReturnType<typeof loadScenario>;
  try {
    scenario = loadScenario(file);
  } catch (e) {
    return harness((e as Error).message);
  }
  const tsDetails: CheckpointDetail[] = [];
  let tsCheckpoints: Checkpoint[];
  try {
    tsCheckpoints = runScenario(scenario, undefined, tsDetails);
  } catch (e) {
    if (e instanceof DetailError) return harness(e.message);
    // The TypeScript engine refused a command the Rust engine accepted (or an
    // expectFail it did not meet): the divergence the fuzzer exists to find.
    return { status: "diverged", signature: throwSignature((e as Error).message), message: `DIVERGED before any hash compare, TypeScript runner threw: ${(e as Error).message}` };
  }
  try {
    const d = compareRuns({ checkpoints: tsCheckpoints, details: tsDetails }, { checkpoints: rustCheckpoints, details: rustDetails });
    if (d) return { status: "diverged", signature: d.field ? `${d.kind}:${d.field}` : d.kind, message: describeDivergence(d) };
  } catch (e) {
    return harness((e as Error).message);
  }
  return { status: "ok", checkpoints: tsCheckpoints.length };
}
