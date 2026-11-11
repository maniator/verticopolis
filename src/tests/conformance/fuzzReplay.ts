/**
 * Replay one scenario file on the TypeScript engine and compare it with the
 * Rust records beside it (`<id>.rs.json` and `<id>.rs.detail.json`, as the
 * fuzzer or `fuzz --replay` writes them). `scripts/fuzz-compare.ts` (the
 * nightly), `scripts/fuzz-shrink.ts` and `scripts/fuzz-corpus.ts` all go
 * through it, so the three agree on what a divergence is.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { compareRuns, describeDivergence, type Leg, type RunRecord } from "./fuzzCompare";
import { DetailError, isWasmTrap, type CheckpointDetail } from "./checkpointDetail";
import { loadScenario, runScenario, startTsEngine, type Checkpoint, type EngineStart, type ScenarioEngine } from "./scenario";
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

/** Where a bomb ransom ends the TypeScript leg's compare. The Rust engine
 *  gates the call (Classic needs Security, and no call comes during a search)
 *  and answers a refusal with a timed search (#349); the reference, slated for
 *  deletion (#1875), calls without the gate and settles a refusal at once. So
 *  from the checkpoint that carries a ransom call on, the two engines may play
 *  different games by design. The owner granted this exception for 3.0.1 on
 *  2026-11-11 (#1886). A call shows on the reference as a pending `bombThreat`
 *  at a checkpoint, or as its `emergency_resolved` when it came and went
 *  between two checkpoints. */
interface RansomCut {
  /** The first checkpoint past the reference, or `null` while none is. */
  at: number | null;
}

export function isRansomAnswer(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const { name, payload } = event as { name?: unknown; payload?: { kind?: unknown } };
  return name === "emergency_resolved" && payload?.kind === "bombThreat";
}

/** The reference engine, watching each checkpoint for a ransom call. A
 *  reload's engine is watched the same way. */
function watchRansoms(e: ScenarioEngine, cut: RansomCut, checkpointsSoFar: () => number): ScenarioEngine {
  return {
    ...e,
    drainEvents: () => {
      const events = e.drainEvents();
      const called = e.pendingChoice()?.kind === "bombThreat" || events.some(isRansomAnswer);
      if (cut.at === null && called) cut.at = checkpointsSoFar();
      return events;
    },
    reload: () => watchRansoms(e.reload(), cut, checkpointsSoFar),
  };
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
  const cut: RansomCut = { at: null };
  if (leg === "TypeScript") {
    const plain = start;
    start = (s) => watchRansoms(plain(s), cut, () => tsDetails.length);
  }
  let tsCheckpoints: Checkpoint[];
  try {
    tsCheckpoints = runScenario(scenario, start, tsDetails);
  } catch (e) {
    if (e instanceof DetailError) return harness(e.message);
    // Past a ransom call the reference may refuse what the Rust engine
    // played; compare what came before.
    if (cut.at !== null) return compareUpTo(cut.at, tsDetails, rustCheckpoints, rustDetails, leg);
    if (leg === "WASM" && isWasmTrap(e)) {
      return { status: "diverged", signature: "trap", trap: true, message: `TRAPPED, the WASM build trapped instead of finishing the scenario: ${(e as Error).message}` };
    }
    // The TypeScript engine refused a command the Rust engine accepted (or an
    // expectFail it did not meet): the divergence the fuzzer exists to find.
    return { status: "diverged", signature: throwSignature((e as Error).message), message: `DIVERGED before any hash compare, ${leg} runner threw: ${(e as Error).message}` };
  }
  if (cut.at !== null) return compareUpTo(cut.at, tsDetails, rustCheckpoints, rustDetails, leg, tsCheckpoints);
  return compareRecords({ checkpoints: tsCheckpoints, details: tsDetails }, { checkpoints: rustCheckpoints, details: rustDetails }, leg);
}

function compareRecords(ts: RunRecord, rust: RunRecord, leg: Leg): ReplayResult {
  try {
    const d = compareRuns(ts, rust, leg);
    if (d) return { status: "diverged", signature: d.field ? `${d.kind}:${d.field}` : d.kind, message: describeDivergence(d, leg) };
  } catch (e) {
    return harness((e as Error).message);
  }
  return { status: "ok", checkpoints: ts.checkpoints.length };
}

/** The compare of the checkpoints before a ransom call (see RansomCut). A
 *  run that threw returned no hashes, so its compare reads the details alone
 *  (money, log, a digest of every save field, fx), which cover the same state. */
function compareUpTo(
  at: number,
  tsDetails: CheckpointDetail[],
  rustCheckpoints: Checkpoint[],
  rustDetails: CheckpointDetail[],
  leg: Leg,
  tsCheckpoints: Checkpoint[] = rustCheckpoints,
): ReplayResult {
  const n = Math.min(at, tsCheckpoints.length, tsDetails.length, rustCheckpoints.length);
  return compareRecords(
    { checkpoints: tsCheckpoints.slice(0, n), details: tsDetails.slice(0, n) },
    { checkpoints: rustCheckpoints.slice(0, n), details: rustDetails.slice(0, n) },
    leg,
  );
}
