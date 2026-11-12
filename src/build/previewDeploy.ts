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
 *     knows nothing of the rule above, but the browser re-fetches `sw.js` on
 *     each navigation (vercel.json serves it with no caching), installs this
 *     one, and this one unregisters itself and reloads the tab from the
 *     network.
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

/**
 * The `sw.js` a preview ships. It has no fetch handler, so it never serves a
 * request. On install it skips waiting; on activate it deletes Workbox's
 * caches, unregisters itself, and navigates each window it controls to its own
 * URL, which now loads from the network. Towers live in IndexedDB and local
 * storage, which it never touches.
 *
 * A tab can only be navigated by the worker that controls it, and a tab the
 * old worker controlled passes to this one when it activates. Unregistering
 * first means that navigation reaches the network instead of a worker.
 */
export const RETIRING_SERVICE_WORKER = `// Verticopolis preview deployment: no service worker (src/build/previewDeploy.ts).
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await self.caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(${JSON.stringify(WORKBOX_CACHE_PREFIX)})).map((name) => self.caches.delete(name)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => null)));
    })(),
  );
});
`;
