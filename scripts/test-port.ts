/**
 * Run the suites converted to the engine port (`src/tests/portKit/converted.txt`).
 * They skip without the engine package; CI builds it first. `npm run test:port`.
 */
import { spawnSync } from "node:child_process";
import { convertedSuites } from "../src/tests/portKit/convertedList.ts";

const suites = convertedSuites();
if (suites.length === 0) throw new Error("src/tests/portKit/converted.txt lists no suites");
const run = spawnSync("npx", ["vitest", "run", "--project", "unit", "--project", "integration", ...suites], {
  stdio: "inherit",
});
process.exit(run.status ?? 1);
