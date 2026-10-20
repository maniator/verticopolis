/**
 * `npm run perf:before-after -- <BEFORE folder> <AFTER folder> --out <dir>`:
 * compares two `perf:worker` runs of different builds on one machine, with
 * control modes that void the comparison when the machine drifted
 * (docs/performance/benchmark-protocol.md, section 6.2).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/tests/perfWorker/beforeAfterMain";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.exit(main(process.argv.slice(2), repo));
} catch (e) {
  process.stderr.write(`perf:before-after: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}
