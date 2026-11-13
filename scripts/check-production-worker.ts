/**
 * Fails unless the build in dist/ ships the precaching service worker. The
 * production deploy (.github/workflows/deploy-production.yml) runs it after
 * `vercel build --prod` and before `vercel deploy`, so a build that carries a
 * preview's retiring worker (src/build/previewDeploy.ts) or no Workbox
 * precache never goes live. The check itself is `productionWorkerProblem`,
 * tested in src/build/previewDeploy.test.ts.
 *
 *   node scripts/check-production-worker.ts [path to sw.js]
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { productionWorkerProblem } from "../src/build/previewDeploy.ts";

const SW = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "sw.js");

const problem = productionWorkerProblem(existsSync(SW) ? readFileSync(SW, "utf8") : null);
if (problem) {
  console.error(`check-production-worker: ${problem} (${SW}).`);
  process.exit(1);
}
console.log(`check-production-worker: ${SW} is the precaching worker.`);
