/**
 * Replay a fuzzer scenario on the TypeScript engine and compare its
 * checkpoints with the Rust engine's. Usage:
 *   cargo run --release --manifest-path engine-rs/Cargo.toml --features conformance --bin fuzz -- <seed> <dir> [commands]
 *   npx tsx scripts/fuzz-compare.ts <dir>/fuzz-<seed>.json
 * Compares the state, crowd and events hashes at every checkpoint, then the
 * money, the log and each field of the full save. Exit 1 on the first
 * divergence, naming the checkpoint and the field. Exit 3 when the harness
 * itself failed (a missing or malformed record), so a night's summary can tell
 * an engine divergence from a broken run.
 */
import { existsSync, readFileSync } from "node:fs";
import { compareRuns, describeDivergence } from "../src/tests/conformance/fuzzCompare";
import type { CheckpointDetail } from "../src/tests/conformance/checkpointDetail";
import { loadScenario, runScenario, type Checkpoint } from "../src/tests/conformance/scenario";

const HARNESS = 3;
const file = process.argv[2];
if (!file) {
  console.error("usage: fuzz-compare <scenario.json>");
  process.exit(2);
}
if (!file.endsWith(".json")) {
  console.error(`${file}: expected the fuzzer's <dir>/fuzz-<seed>.json`);
  process.exit(2);
}

function readRecord<T>(path: string, what: string): T[] {
  if (!existsSync(path)) {
    console.error(`${file}: HARNESS: no ${what} at ${path} (did the fuzzer finish?)`);
    process.exit(HARNESS);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    console.error(`${path}: HARNESS: expected a ${what} array`);
    process.exit(HARNESS);
  }
  return parsed as T[];
}

const rust = {
  checkpoints: readRecord<Checkpoint>(file.replace(/\.json$/, ".rs.json"), "Rust checkpoints"),
  details: readRecord<CheckpointDetail>(file.replace(/\.json$/, ".rs.detail.json"), "Rust checkpoint detail"),
};
const tsDetails: CheckpointDetail[] = [];
let tsCheckpoints: Checkpoint[];
try {
  tsCheckpoints = runScenario(loadScenario(file), undefined, tsDetails);
} catch (e) {
  // The TypeScript engine refused a command the Rust engine accepted (or an
  // expectFail it did not meet): the divergence the fuzzer exists to find.
  console.log(`${file}: DIVERGED before any hash compare, TypeScript runner threw: ${(e as Error).message}`);
  process.exit(1);
}
const d = compareRuns({ checkpoints: tsCheckpoints, details: tsDetails }, rust);
if (d) {
  console.log(`${file}: ${describeDivergence(d)}`);
  process.exit(1);
}
console.log(`${file}: ok (${tsCheckpoints.length} checkpoints)`);
