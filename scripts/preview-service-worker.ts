/**
 * Swaps dist/sw.js for the retiring worker on a Vercel preview deployment, so
 * a preview never serves a cached build (see src/build/previewDeploy.ts).
 * scripts/vercel-build.sh runs it after `npm run build`, whose checks have
 * already verified the production worker. Any other build is left as it is.
 * The decision lives in `applyPreviewWorker`, tested in
 * src/build/previewDeploy.test.ts.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { applyPreviewWorker } from "../src/build/previewDeploy.ts";

const SW = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "sw.js");

const outcome = applyPreviewWorker(process.env, SW, { exists: existsSync, write: (path, text) => writeFileSync(path, text) });
if (outcome.code === 0) console.log(outcome.message);
else {
  console.error(outcome.message);
  process.exit(outcome.code);
}
