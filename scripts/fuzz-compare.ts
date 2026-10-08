/**
 * Replay a fuzzer scenario on the TypeScript engine and compare its
 * checkpoints with the Rust engine's. Usage:
 *   cargo run --release --manifest-path engine-rs/Cargo.toml --bin fuzz -- <seed> <dir> [commands]
 *   npx tsx scripts/fuzz-compare.ts <dir>/fuzz-<seed>.json
 * Exit 1 on the first divergence, naming the checkpoint and both hashes.
 */
import { existsSync, readFileSync } from "node:fs";
import { loadScenario, runScenario } from "../src/tests/conformance/scenario";

const file = process.argv[2];
if (!file) {
  console.error("usage: fuzz-compare <scenario.json>");
  process.exit(2);
}
if (!file.endsWith(".json")) {
  console.error(`${file}: expected the fuzzer's <dir>/fuzz-<seed>.json`);
  process.exit(2);
}
const rsPath = file.replace(/\.json$/, ".rs.json");
if (!existsSync(rsPath)) {
  console.error(`${file}: no Rust checkpoints at ${rsPath} (did the fuzzer finish?)`);
  process.exit(2);
}
const rust = JSON.parse(readFileSync(rsPath, "utf8")) as unknown;
if (!Array.isArray(rust)) {
  console.error(`${rsPath}: expected a checkpoint array`);
  process.exit(2);
}
const rustList = rust as { label: string; state: string; crowd: string }[];
let ts: { label: string; state: string; crowd: string }[];
try {
  ts = runScenario(loadScenario(file));
} catch (e) {
  // The TypeScript engine refused a command the Rust engine accepted (or an
  // expectFail it did not meet): the divergence the fuzzer exists to find.
  console.log(`${file}: DIVERGED before any hash compare, TypeScript runner threw: ${(e as Error).message}`);
  process.exit(1);
}
const n = Math.min(rustList.length, ts.length);
for (let i = 0; i < n; i++) {
  const a = ts[i];
  const b = rustList[i];
  if (a.label !== b.label || a.state !== b.state || a.crowd !== b.crowd) {
    console.log(`${file}: DIVERGED at checkpoint ${i} (${a.label} / ${b.label}): state ${a.state} vs ${b.state}, crowd ${a.crowd} vs ${b.crowd}`);
    process.exit(1);
  }
}
if (rustList.length !== ts.length) {
  console.log(`${file}: checkpoint count differs, TypeScript ${ts.length} vs Rust ${rustList.length}`);
  process.exit(1);
}
console.log(`${file}: ok (${ts.length} checkpoints)`);
