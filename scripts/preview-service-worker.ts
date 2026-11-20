/**
 * Swaps dist/sw.js for the retiring worker on a Vercel preview deployment, so
 * a preview never serves a cached build (see src/build/previewDeploy.ts).
 * scripts/vercel-build.sh runs it after `npm run build`, whose checks have
 * already verified the production worker. Any other build is left as it is.
 * The manual's own worker, dist/help/sw.js, is written by the help site's
 * build (scripts/manual-worker.ts) and stays on every deployment: it answers
 * pages from the network first, so a preview's manual is never stale.
 * The decision lives in `applyPreviewWorker`, tested in
 * src/build/previewDeploy.test.ts.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { applyPreviewWorker } from "../src/build/previewDeploy.ts";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const files = { exists: existsSync, write: (path: string, text: string) => writeFileSync(path, text) };

const outcome = applyPreviewWorker(process.env, resolve(DIST, "sw.js"), files);
if (outcome.code === 0) console.log(outcome.message);
else {
  console.error(outcome.message);
  process.exit(outcome.code);
}
