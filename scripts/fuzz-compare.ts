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
import { replayCompare } from "../src/tests/conformance/fuzzReplay";

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

const result = replayCompare(file);
if (result.status === "harness") {
  console.error(`${file}: ${result.message}`);
  process.exit(HARNESS);
}
if (result.status === "diverged") {
  console.log(`${file}: ${result.message}`);
  process.exit(1);
}
console.log(`${file}: ok (${result.checkpoints} checkpoints)`);
