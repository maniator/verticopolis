/**
 * Swaps dist/sw.js for the retiring worker on a Vercel preview deployment, so
 * a preview never serves a cached build (see src/build/previewDeploy.ts).
 * scripts/vercel-build.sh runs it after `npm run build`, whose checks have
 * already verified the production worker. Any other build is left as it is.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { isPreviewDeploy, RETIRING_SERVICE_WORKER } from "../src/build/previewDeploy.ts";

const SW = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "sw.js");

if (!isPreviewDeploy(process.env)) {
  console.log("preview-service-worker: not a preview deployment; dist/sw.js stays the production worker");
} else {
  // The build always writes a worker; a missing one means the output moved,
  // and writing ours somewhere the host does not serve would hide that.
  if (!existsSync(SW)) {
    console.error(`preview-service-worker: ${SW} does not exist; did the build output move?`);
    process.exit(1);
  }
  writeFileSync(SW, RETIRING_SERVICE_WORKER);
  console.log("preview-service-worker: preview deployment; dist/sw.js now unregisters itself and clears the precache");
}
