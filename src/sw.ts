import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute, setCatchHandler } from "workbox-routing";

/**
 * The service worker (#985, #1345). vite-plugin-pwa builds it with
 * `strategies: "injectManifest"` and fills in the precache manifest, so the
 * worker has its own source for the one thing a generated worker cannot do: a
 * catch handler. The behavior is otherwise what the generated worker had:
 * a `SKIP_WAITING` message activates a waiting worker (src/pwa.ts sends it
 * after the save), the precache is the manifest, outdated caches are
 * deleted, and a navigation that no precache entry answers gets the cached
 * app shell, unless it names one of the paths below.
 *
 * The catch handler matters because every precache entry carries the sha256
 * integrity of its built file (vite.config.ts). A miss on a controlled page is
 * stored again only with it, which is how an installed game starts offline
 * after its caches were cleared. The same check refuses a body from another
 * build. For a navigation that must not leave the player on the browser's
 * error page: when the deployed page is a newer build than this worker's
 * manifest, the page loads from the network, as it would with no worker,
 * and the newer worker installs. Everything else stays refused: a script or
 * engine file whose bytes are not the build's own fails, so the page's own
 * byte check and the install race tests keep their meaning.
 */
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null; integrity?: string }[] };

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") void self.skipWaiting();
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Keep the non-game pages and the real static files out of the app-shell
// fallback, letting them fall through to the network rather than the game
// shell: the `/gallery` and `/help` public pages, `version.json` (the
// update-check payload), the crawler control files `robots.txt` /
// `sitemap.xml`, and the `og-image.png` share card (a direct navigation to
// it, e.g. opening the card in a new tab while the service worker controls
// the origin, must return the PNG, not the shell), none of which are app
// routes. Without the `/help` entry the fallback would answer a `/help`
// navigation with the precached game shell.
//
// `help.html` is kept OUT of precache (the `globIgnores` entries above),
// exactly like `gallery.html`, so the CLEAN `/help` always resolves over
// the network via the Vercel rewrite and is never stale. This matters
// because Workbox precaching defaults `cleanURLs` to true: a navigation to
// `/help` generates a `/help.html` variation, so a precached `/help.html`
// would answer the clean `/help` FROM THE CACHE, pinning it to whatever was
// cached when the service worker installed and serving an outdated page
// across deploys until the worker updates (and the `/help` page does not
// register the worker, so a `/help`-only visitor never triggers that
// update). The denylist alone does not prevent this: it
// governs only the app-shell NavigationRoute, not the precache route. Not
// precaching the page is the fix; the trade-off is that `/help` is
// online-only (no offline copy), the same call already made for `/gallery`.
// A precache alias for the clean URL is separately rejected: with
// a generated manifest it would make Workbox fetch `/help` at install, which 404s
// anywhere the Vercel rewrite is absent (`vite preview`, the e2e harness),
// failing the whole precache and taking the game's offline down with it.
// `.well-known/` joins the machine-readable files for the same reason
// robots.txt and sitemap.xml are here: they are documents ABOUT the
// site rather than pages of it, and answering one with the game shell
// makes a person checking it think it is missing. Android's Digital
// Asset Links verifier fetches server-side and never meets a service
// worker, so this changes nothing for verification itself; it is what
// makes checking the file by hand tell the truth.
// `third-party-notices.txt` (#951, written after each build) is the
// same kind of document, so a navigation to it, query string or not,
// reaches the file itself.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [
      /gallery/,
      /help/,
      /preview/,
      /version\.json$/,
      // The engine package's own files (its BUILD.json above all) are
      // documents; a navigation to one must reach the file itself.
      /\/engine\//,
      /robots\.txt$/,
      /sitemap\.xml$/,
      /third-party-notices\.txt(\?.*)?$/,
      /og-image\.png$/,
      // No trailing slash: a bare `/.well-known` navigation should reach the
      // host's own 404 rather than the game shell, same as the file below it.
      /\.well-known/,
    ],
  }),
);

setCatchHandler(({ request }) => (request.mode === "navigate" ? fetch(request) : Promise.resolve(Response.error())));
