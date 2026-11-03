/**
 * Replay a fuzzer scenario on the TypeScript engine, or with --wasm on the
 * shipped WASM build in Node (npm run wasm:build), and compare its
 * checkpoints with the native Rust engine's. Usage:
 *   cargo run --release --manifest-path engine-rs/Cargo.toml --features conformance --bin fuzz -- <seed> <dir> [commands]
 *   npx tsx scripts/fuzz-compare.ts [--wasm] <dir>/fuzz-<seed>.json
 * Compares the state, crowd and events hashes at every checkpoint, then the
 * money, the log and each field of the full save. Exit 1 on the first
 * divergence, naming the checkpoint and the field. Exit 3 when the harness
 * itself failed (a missing or malformed record), so a night's summary can tell
 * an engine divergence from a broken run.
 */
import { replayCompare } from "../src/tests/conformance/fuzzReplay";

const HARNESS = 3;
const args = process.argv.slice(2);
const wasmLeg = args[0] === "--wasm";
const file = args[wasmLeg ? 1 : 0];
if (!file || args.length > (wasmLeg ? 2 : 1)) {
  console.error("usage: fuzz-compare [--wasm] <scenario.json>");
  process.exit(2);
}
if (!file.endsWith(".json")) {
  console.error(`${file}: expected the fuzzer's <dir>/fuzz-<seed>.json`);
  process.exit(2);
}

const leg = wasmLeg ? "WASM" : "TypeScript";
const result = replayCompare(file, undefined, leg);
if (result.status === "harness") {
  console.error(`${file}: ${result.message}`);
  process.exit(HARNESS);
}
if (result.status === "diverged") {
  console.log(`${file}: ${result.message}`);
  process.exit(1);
}
console.log(`${file}: ok (${result.checkpoints} checkpoints, ${leg} leg)`);
