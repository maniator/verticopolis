/**
 * Replay a fuzzer scenario on the shipped WASM build in Node (npm run
 * wasm:build) and compare its checkpoints with the native Rust engine's. Usage:
 *   cargo run --release --manifest-path engine-rs/Cargo.toml --features conformance --bin fuzz -- <seed> <dir> [commands]
 *   npx tsx scripts/fuzz-compare.ts <dir>/fuzz-<seed>.json
 * Compares the state, crowd and events hashes at every checkpoint, then the
 * money, the log, each field of the full save and the fx sequences. Exit 1 on the first
 * divergence, naming the checkpoint and the field. Exit 3 when the harness
 * itself failed (a missing or malformed record, no WASM package), so a night's
 * summary can tell an engine divergence from a broken run. Exit 4 when the WASM
 * build trapped instead of returning a different value.
 */
import { replayCompare } from "../src/tests/conformance/fuzzReplay";

const HARNESS = 3;
const TRAP = 4;
const args = process.argv.slice(2);
const file = args[0];
if (!file || args.length > 1) {
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
  process.exit(result.trap ? TRAP : 1);
}
console.log(`${file}: ok (${result.checkpoints} checkpoints, WASM leg)`);
