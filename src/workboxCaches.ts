/** The prefix Workbox gives every cache it creates (the precache is
 *  `workbox-precache-v2-<scope>`). The game creates no other caches. Shared by
 *  the page (src/pwa.ts) and the preview's retiring worker
 *  (src/build/previewDeploy.ts).
 *
 *  Keep this file ERASABLE (see screenshot-env.ts) so `node` can import it. */
export const WORKBOX_CACHE_PREFIX = "workbox-";
