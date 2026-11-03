/**
 * Replay one scenario file on the TypeScript engine and compare it with the
 * Rust records beside it (`<id>.rs.json` and `<id>.rs.detail.json`, as the
 * fuzzer or `fuzz --replay` writes them). `scripts/fuzz-compare.ts` (the
 * nightly), `scripts/fuzz-shrink.ts` and `scripts/fuzz-corpus.ts` all go
 * through it, so the three agree on what a divergence is.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { compareRuns, describeDivergence, type Leg } from "./fuzzCompare";
import { DetailError, isWasmTrap, type CheckpointDetail } from "./checkpointDetail";
import { loadScenario, runScenario, startTsEngine, type Checkpoint, type EngineStart } from "./scenario";
import { hasWasmPackage, startWasmEngine, wasm, WASM_PKG } from "./wasmEngine";

export type ReplayResult =
  | { status: "ok"; checkpoints: number }
  /** `signature` names the kind of divergence (`state:units`, `money`, `threw`)
   *  without its position, so a shrinker can tell that a smaller scenario
   *  still shows the same thing. `trap` marks a WASM leg whose engine trapped
   *  (see {@link isWasmTrap}) instead of returning a different value. */
  | { status: "diverged"; signature: string; message: string; trap?: true }
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

/** Run `file` on the TypeScript engine (or, with `leg` `WASM`, on the shipped
 *  build through the binding in Node) and compare it with the Rust records in
 *  `rustDir` (the scenario's own folder by default). */
export function replayCompare(file: string, rustDir: string = dirname(file), leg: Leg = "TypeScript"): ReplayResult {
  let start: EngineStart = startTsEngine;
  if (leg === "WASM") {
    if (!hasWasmPackage()) return harness(`no WASM package at ${WASM_PKG} (npm run wasm:build)`);
    // A package that is present but will not load (a stale binding, a bad cache) is
    // the harness failing, not the engine disagreeing.
    try {
      wasm();
    } catch (e) {
      return harness(`the WASM package failed to load: ${(e as Error).message}`);
    }
    start = startWasmEngine;
  }
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
    tsCheckpoints = runScenario(scenario, start, tsDetails);
  } catch (e) {
    if (e instanceof DetailError) return harness(e.message);
    if (leg === "WASM" && isWasmTrap(e)) {
      return { status: "diverged", signature: "trap", trap: true, message: `TRAPPED, the WASM build trapped instead of finishing the scenario: ${(e as Error).message}` };
    }
    // The TypeScript engine refused a command the Rust engine accepted (or an
    // expectFail it did not meet): the divergence the fuzzer exists to find.
    return { status: "diverged", signature: throwSignature((e as Error).message), message: `DIVERGED before any hash compare, ${leg} runner threw: ${(e as Error).message}` };
  }
  try {
    const d = compareRuns({ checkpoints: tsCheckpoints, details: tsDetails }, { checkpoints: rustCheckpoints, details: rustDetails }, leg);
    if (d) return { status: "diverged", signature: d.field ? `${d.kind}:${d.field}` : d.kind, message: describeDivergence(d, leg) };
  } catch (e) {
    return harness((e as Error).message);
  }
  return { status: "ok", checkpoints: tsCheckpoints.length };
}
