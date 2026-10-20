/**
 * `npm run perf:restore`: the restore-point benchmark for the runtime
 * fallback (#874). Not a gate: it times the work the restore points add to
 * a hosted tower on the small, medium and large perf scenarios at 1x and 4x
 * CPU throttle, and writes results.json and report.md.
 *
 *   npm run perf:restore                        # 10 reps, both throttles, all scenarios
 *   npm run perf:restore -- --quick             # 2 short reps, a smoke test
 *   npm run perf:restore -- --skip-build --out docs/performance/results/<folder>
 *
 * Run it on the owner's desktop under docs/performance/benchmark-protocol.md.
 * Temporary, with the WASM engine's fallback (#874): the TypeScript engine's
 * retirement removes it (story-engine-retire-typescript.md).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/tests/perfRestore/main";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
main(process.argv.slice(2), repo).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`perf:restore: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(2);
  },
);
