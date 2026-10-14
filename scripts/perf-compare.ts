/**
 * `npm run perf:compare`: the TypeScript vs Rust/WASM engine comparison
 * (issue #972). Not a gate: it measures and reports, and fails only when the
 * two configurations are not comparable (a WASM fallback, a state mismatch, a
 * failed run). The existing regression gate is `npm run perf`.
 *
 *   npm run perf:compare                      # 10 reps, both throttles, all scenarios
 *   npm run perf:compare -- --quick           # 2 short reps, a smoke test
 *   npm run perf:compare -- --reps 20 --skip-build --out /tmp/run
 *
 * Methodology and the latest results: docs/performance/ts-vs-wasm.md.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/tests/perfCompare/main";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
main(process.argv.slice(2), repo).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`perf:compare: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(2);
  },
);
