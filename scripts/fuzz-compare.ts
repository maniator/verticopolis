/**
 * Replay a fuzzer scenario on the TypeScript engine and compare its
 * checkpoints with the Rust engine's. Usage:
 *   cargo run --release --manifest-path engine-rs/Cargo.toml --bin fuzz -- <seed> <dir> [commands]
 *   npx tsx scripts/fuzz-compare.ts <dir>/fuzz-<seed>.json
 * Exit 1 on the first divergence, naming the checkpoint and both hashes.
 */
import { readFileSync } from "node:fs";
import { loadScenario, runScenario } from "../src/tests/conformance/scenario";

const file = process.argv[2];
if (!file) {
  console.error("usage: fuzz-compare <scenario.json>");
  process.exit(2);
}
const rust = JSON.parse(readFileSync(file.replace(/\.json$/, ".rs.json"), "utf8")) as { label: string; state: string; crowd: string }[];
const ts = runScenario(loadScenario(file));
const n = Math.min(rust.length, ts.length);
for (let i = 0; i < n; i++) {
  const a = ts[i];
  const b = rust[i];
  if (a.label !== b.label || a.state !== b.state || a.crowd !== b.crowd) {
    console.log(`${file}: DIVERGED at checkpoint ${i} (${a.label} / ${b.label}): state ${a.state} vs ${b.state}, crowd ${a.crowd} vs ${b.crowd}`);
    process.exit(1);
  }
}
if (rust.length !== ts.length) {
  console.log(`${file}: checkpoint count differs, TypeScript ${ts.length} vs Rust ${rust.length}`);
  process.exit(1);
}
console.log(`${file}: ok (${ts.length} checkpoints)`);
