/**
 * `npm run perf:worker`: the engine-host comparison in one browser, the pinned
 * pre-cutover `ts` build against the shipped `wasm` host, with the long-task
 * and main-thread blocking rows (M4). Not a gate. See
 * docs/performance/benchmark-protocol.md.
 *
 *   npm run perf:worker                      # 10 reps, 1x and 4x, all scenarios
 *   npm run perf:worker -- --quick           # 2 short reps, a smoke test
 *   npm run perf:worker -- --aa wasm         # an A/A pass, the same mode in both slots
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/tests/perfWorker/main";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
main(process.argv.slice(2), repo).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`perf:worker: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(2);
  },
);
