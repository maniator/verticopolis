/**
 * Fails unless the build in dist/ ships the precaching service worker. The
 * production deploy (.github/workflows/deploy-production.yml) runs it after
 * `vercel build --prod` and before `vercel deploy`, so a build that carries a
 * preview's retiring worker (src/build/previewDeploy.ts) or no Workbox
 * precache never goes live. It also checks dist/help/sw.js is the manual
 * host's self-removing worker. The checks are `productionWorkerProblem` and
 * `helpHostWorkerProblem`, tested in src/build/previewDeploy.test.ts.
 *
 *   node scripts/check-production-worker.ts [path to sw.js]
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { helpHostWorkerProblem, productionWorkerProblem } from "../src/build/previewDeploy.ts";

const SW = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "sw.js");

const HELP_SW = resolve(dirname(SW), "help", "sw.js");
const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

for (const [path, problem] of [
  [SW, productionWorkerProblem(read(SW))],
  [HELP_SW, helpHostWorkerProblem(read(HELP_SW))],
] as const) {
  if (problem) {
    console.error(`check-production-worker: ${problem} (${path}).`);
    process.exit(1);
  }
}
console.log(`check-production-worker: ${SW} is the precaching worker and ${HELP_SW} the manual host's self-removing one.`);
