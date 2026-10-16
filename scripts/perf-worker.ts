/**
 * `npm run perf:worker`: the engine-host comparison (TypeScript, the shipped
 * main-thread WASM host, the experimental coalesced host and the
 * experimental worker host). Not a gate. See
 * docs/architecture/wasm-worker-host.md and docs/performance/wasm-worker-host.md.
 *
 *   npm run perf:worker                      # 10 reps, 1x and 4x, all scenarios
 *   npm run perf:worker -- --quick           # 2 short reps, a smoke test
 *   npm run perf:worker -- --read-model      # the read model shape only, in Node
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
