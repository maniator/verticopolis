/**
 * `npm run perf:load-cost -- --before <dist> --after <dist>`: the engine
 * load cost measurement of #985 (before and after the verified loader), on
 * cold, repeat, offline and restarted boots. Not a gate; it reports.
 * Details and the decision rule: src/tests/perfLoadCost/main.ts.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/tests/perfLoadCost/main";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
main(process.argv.slice(2), repo).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`perf-load-cost: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(2);
  },
);
