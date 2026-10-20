/**
 * `npm run perf:calibrate -- <A/A folder>... --out <dir>`: δ and ε candidates
 * from `perf:compare --aa` result folders (docs/performance/benchmark-protocol.md,
 * section 6.1). Exits 0 only when the candidates are adoptable.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/tests/perfCompare/calibrateMain";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.exit(main(process.argv.slice(2), repo));
} catch (e) {
  process.stderr.write(`perf:calibrate: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}
