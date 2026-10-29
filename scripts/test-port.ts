/**
 * Run the suites converted to the engine port (`src/tests/portKit/converted.txt`)
 * with the Rust leg required, so a missing engine package fails the run
 * instead of skipping it. `npm run test:port`.
 */
import { spawnSync } from "node:child_process";
import { convertedSuites } from "../src/tests/portKit/convertedList.ts";

const suites = convertedSuites();
if (suites.length === 0) throw new Error("src/tests/portKit/converted.txt lists no suites");
const run = spawnSync("npx", ["vitest", "run", "--project", "unit", "--project", "integration", ...suites], {
  stdio: "inherit",
  env: { ...process.env, VC_REQUIRE_WASM: "1" },
});
process.exit(run.status ?? 1);
