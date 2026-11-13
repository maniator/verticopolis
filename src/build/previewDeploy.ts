/**
 * Preview deployments run without a service worker.
 *
 * A Vercel preview is a test build: every push to a branch replaces it, and
 * its branch URL keeps the same origin from one push to the next. With the
 * game's worker installed, the first visit precaches the build and every
 * later visit is served from that cache until the update prompt runs, so a
 * reviewer opening the branch link after a push sees the old build. Previews
 * therefore skip the worker entirely; production and every local or CI build
 * keep it, because only Vercel sets `VERCEL_ENV` and only previews set it to
 * `preview`.
 *
 * Two pieces carry it out:
 *   - The page never registers a worker on a preview (`__PREVIEW_DEPLOY__`,
 *     read through src/deployTarget.ts by src/pwa.ts), and removes any
 *     registration an earlier build of that preview left behind.
 *   - The preview's `sw.js` is replaced by {@link RETIRING_SERVICE_WORKER}
 *     (scripts/preview-service-worker.ts, run by scripts/vercel-build.sh). A
 *     tab still controlled by an old worker runs the old page code, which
 *     knows nothing of the rule above. Its next update check fetches this
 *     `sw.js` (vercel.json serves it with no caching): the old page's own
 *     check 15 seconds after load, on focus or hourly (src/pwa.ts), or the
 *     browser's after a navigation. The browser installs this worker, which
 *     unregisters itself and reloads the tab from the network.
 *
 * The production `sw.js` is still generated and checked by `npm run build`
 * first, so a preview proves the precache guards the same as any build.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs the script
 * that imports it directly.
 */
import { WORKBOX_CACHE_PREFIX } from "../workboxCaches.ts";

/** The Vercel deployment environment a preview build runs in. */
const VERCEL_PREVIEW_ENV = "preview";

/** Whether this build is a Vercel preview deployment. `vercel build --prod`
 *  (the production deploy) sets `VERCEL_ENV=production`; local and CI builds
 *  leave it unset. */
export function isPreviewDeploy(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.VERCEL_ENV === VERCEL_PREVIEW_ENV;
}

/** The first words of {@link RETIRING_SERVICE_WORKER}, which no production
 *  worker carries: the deploy check looks for them (productionWorkerProblem). */
export const RETIRING_WORKER_MARKER = "Verticopolis preview deployment";

/** The call Workbox's generated worker makes to precache the build. */
export const PRECACHE_CALL = "precacheAndRoute(";

/**
 * The `sw.js` a preview ships. It has no fetch handler, so it never serves a
 * request. On install it skips waiting; on activate it deletes Workbox's
 * caches, unregisters itself, and navigates each window it controls to its own
 * URL, which now loads from the network. Towers live in IndexedDB and local
 * storage, which it never touches.
 *
 * A tab can only be navigated by the worker that controls it, and a tab the
 * old worker controlled passes to this one when it activates. Unregistering
 * first means that navigation reaches the network instead of a worker. A
 * Cache Storage failure never stops the unregister or the reload.
 */
export const RETIRING_SERVICE_WORKER = `// ${RETIRING_WORKER_MARKER}: no service worker (src/build/previewDeploy.ts).
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await self.caches.keys().catch(() => []);
      await Promise.all(names.filter((name) => name.startsWith(${JSON.stringify(WORKBOX_CACHE_PREFIX)})).map((name) => self.caches.delete(name).catch(() => false)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => null)));
    })(),
  );
});
`;

/** The file system calls {@link applyPreviewWorker} makes, so a test can stand in for them. */
export interface WorkerFiles {
  exists(path: string): boolean;
  write(path: string, text: string): void;
}

/** What {@link applyPreviewWorker} did: the exit code for its script and the line to print. */
export interface WorkerOutcome {
  code: 0 | 1;
  message: string;
}

/**
 * scripts/preview-service-worker.ts: on a preview build, replace the built
 * worker at `swPath` with {@link RETIRING_SERVICE_WORKER}; on any other build,
 * leave it. A missing worker on a preview fails, since writing ours where the
 * host does not serve it would hide that the build output moved.
 */
export function applyPreviewWorker(env: Readonly<Record<string, string | undefined>>, swPath: string, files: WorkerFiles): WorkerOutcome {
  if (!isPreviewDeploy(env)) {
    return { code: 0, message: "preview-service-worker: not a preview deployment; dist/sw.js stays the production worker" };
  }
  if (!files.exists(swPath)) {
    return { code: 1, message: `preview-service-worker: ${swPath} does not exist; did the build output move?` };
  }
  files.write(swPath, RETIRING_SERVICE_WORKER);
  return { code: 0, message: "preview-service-worker: preview deployment; dist/sw.js now unregisters itself and clears the precache" };
}

/**
 * Why a production build's `sw.js` is not the precaching worker, or null when
 * it is. `sw` is the file's text, or null when the file is missing. The
 * production deploy (.github/workflows/deploy-production.yml, through
 * scripts/check-production-worker.ts) runs this on the build it is about to
 * ship, so a preview's retiring worker can never reach players.
 */
export function productionWorkerProblem(sw: string | null): string | null {
  if (sw === null) return "dist/sw.js is missing, so production would ship no service worker";
  if (sw.includes(RETIRING_WORKER_MARKER)) return "dist/sw.js is the preview deployment's retiring worker, which would unregister every player's worker";
  if (!sw.includes(PRECACHE_CALL)) return `dist/sw.js has no Workbox ${PRECACHE_CALL}...) call, so production would precache nothing`;
  return null;
}
