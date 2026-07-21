# Page architecture: the standalone `/help` page

Load-bearing build-surface detail for CAP-5 (the shareable `/help` page). SPEC.md
cites this companion; it holds the per-file catalog the kernel would bloat.

## The page and its single source

`src/help.html` is a Vite input rendering the **full how-to-play guide** (the
CAP-5 rescope): the same sections the in-game Help modal shows, the basics, going
further, Classic vs Modern, keyboard, About, plus the report call to action. It is
a full document in the retro page shell (CAP-6, `pageShell(...)`): a title bar
reading "Verticopolis: How to Play", the lead, the guide sections, and the report
call to action. No game code, no Excalibur canvas, no sim.

The page does NOT duplicate the guide prose. Both the modal (`help.ts`) and the
page (`helpPage.ts`) render the one shared source `src/ui/templates/helpContent.ts`
(`HELP_SECTIONS` + `helpLede`/`helpAboutBody`/`helpReportBlock`), with the Classic
vs Modern section still coming from `compareTemplate()`; so the guide copy has one
home and the `help.test.ts` drift guard keeps protecting every surface at once.
Classic vs Modern is a section anchored `/help#classic-vs-modern`.

The one prose copy that exists OUTSIDE source is build output, never a source:
`scripts/prerender-help.ts` (a post-build step of `npm run build`, added for
issue #516 under the narrowed non-goal) renders the built help chunk under
happy-dom and injects the resulting markup into `dist/help.html`'s `#app`, so
crawlers and no-JS visitors get the full guide with the hashed figure URLs. It
is regenerated from the same chunk on every build and cannot drift from the
source; the script fails the build loudly if the guide prose or any figure
asset is missing. The client script clears the prerendered children and
re-renders identical markup (no hydration); the SOURCE `src/help.html` keeps
its noscript for dev and non-prerendered builds, while the built file's
noscript is replaced by the real content.

## Build inputs

| Concern | Change |
| --- | --- |
| Vite input | Add `src/help.html` to `rollupOptions.input` alongside `src/index.html`, `src/gallery.html`, `src/preview.html`. |
| Precache | Keep `src/help.html` (and its `help-*.js` page entry chunk) OUT of precache via `globIgnores`, mirroring `gallery.html`. Precaching `help.html` serves a STALE clean `/help`: Workbox precaching defaults `cleanURLs` to true, so a `/help` navigation matches the precached `/help.html` and is answered from cache, pinning `/help` to the SW-install snapshot across deploys (and `/help` does not register the SW, so a `/help`-only visitor never updates it). Excluding it lets the clean `/help` always resolve over the network via the Vercel rewrite (fresh). Use the narrow `**/help.html` and `**/help-*.js`, not a broad `**/help*`, so the shared `helpContent-*.js` chunk STAYS precached: the in-game Help modal needs it offline. Trade-off: `/help` is online-only (no offline copy), the same call already made for `/gallery`. `preview.html` stays ignored: it is a Rollup input, so it is built and reachable, but it is a test/screenshot harness, kept out of precache and unlinked and unindexed. |
| SW registration | `help.html` does NOT register a service worker. The root-scope game SW (registered only by `main.ts` -> `pwa.ts`) already covers `/help` because it is same-origin under the root scope. |
| navigateFallback | Add `/help` to `navigateFallbackDenylist` so the `index.html` app-shell fallback does not hijack a `/help` navigation. Without it, Workbox answers every navigation (including `/help`) with the precached `index.html`, serving the game instead of the help page. |
| Clean-URL offline | `/help` is online-only: neither the clean `/help` nor `/help.html` is precached, so a `/help` navigation always falls through to the network (Vercel rewrite `/help` -> `/help.html`) and is fresh. This is the fix for a staleness bug: when `help.html` WAS precached, Workbox's default `cleanURLs` made the clean `/help` match the precached `/help.html` and serve it from cache, pinning `/help` to the SW-install snapshot across deploys. The spec originally also prescribed a precache alias to make the clean URL resolve offline; that is **deliberately not implemented** (recorded in the backlog): a generateSW `additionalManifestEntries` / `manifestTransform` alias makes Workbox FETCH `/help` at SW install, which 404s anywhere the Vercel rewrite is absent (`vite preview`, the e2e harness), failing the whole precache and taking the game's own offline down with it. `/gallery` is likewise online-only (intentionally not precached at all). |

## Vercel routing

- TARGETED rewrites only, one per clean page:
  `{ "source": "/help", "destination": "/help.html" }` and
  `{ "source": "/gallery", "destination": "/gallery.html" }`. Do NOT enable
  sitewide `cleanUrls`: it would rewrite every page's canonical at once and
  change existing URLs. Two explicit rewrites, nothing global.
- `rel="canonical"` on `help.html` points at `/help`; the gallery's existing
  canonical moves from `/gallery.html` to the clean `/gallery`. Both clean URLs
  go in the sitemap; sibling links target `/help` and `/gallery` (never the
  `.html`).

## Deployed-page audit (the cleanup ask)

The Vite inputs are `src/index.html` (game), `src/gallery.html` (public), and
`src/preview.html`. `preview.html` is the ACTIVE e2e and screenshot harness
(referenced by `playwright.config.ts`, the e2e specs, and
`scripts/screenshots.ts`), so it stays. No orphaned deployed `.html` page exists
to remove; the other `.html` files in the tree are skill assets and party-mode
transcripts, never deployed. If implementation surfaces a genuinely dead page it
removes that page and its Vite input; otherwise the cleanup is a no-op with this
finding on the record. `/help` adds one input (four total).

## Back to game (the affordance the owner called out)

Two return paths, both must work:

1. **From the in-app modals** (Help modal, compare modal): closing the modal
   (the close button, `Esc`, or backdrop click) drops the player back onto the
   live tower. No navigation, no reload. This is the existing `#modal` close path.
2. **From the standalone `/help` page**: a "Back to game" control in the title
   bar and in the footer is a real `<a href="/">`. Following it loads the game at
   `/`. If the player arrived from the game in a new tab, they can also just
   switch or close the tab; if they arrived from a shared `/help` link with no
   game running, `/` boots a fresh tower.

The "Back to game" link is a plain same-origin anchor to `/`, so it works with
JS disabled, from a cold share link, and inside the installed PWA.

### Sibling-page cross-links

The retro page shell carries a small nav of sibling links. `/help` links to the
Sprite Gallery at the clean `/gallery`; the gallery links to `/help` and "Back to
game" (`/`). All are plain same-origin anchors (no `target="_blank"` between
sibling pages), so navigation stays inside the same tab/window and works cold.

## Installed-PWA reality and the standalone fallback

`target="_blank"` from an installed PWA (`display: standalone`) is unreliable:
iOS drops to Safari and loses the session, Android/desktop break out to the
system browser. So the "Open full page" affordance INSIDE the in-app modal is
progressive enhancement:

- Markup is a real `<a href="/help" target="_blank" rel="noopener">` so a plain
  browser tab (and no-JS) opens the shareable page in a new tab as written.
- A click handler feature-detects installed standalone
  (`matchMedia('(display-mode: standalone)').matches || navigator.standalone`).
  When installed, it prevents the new-tab navigation and instead opens the
  in-app compare modal, keeping the player in the running sim.

The standalone page never runs the sim, so there is nothing to pause on it; a
backgrounded `/help` tab is browser-throttled and the game resumes at its prior
speed on return. The pause-on-open behavior is the MODAL's job (CAP-3), not the
page's.

## Vercel tracking parity

The game injects `@vercel/speed-insights` and `@vercel/analytics` in
`bootstrap.ts`, host-gated to `verticopolis.com` / `*.vercel.app`, best-effort
inside a `try/catch` so the endpoint 404s stay off localhost, `vite preview`, and
the native Capacitor shell. The new `/help` page and the gallery must report the
same telemetry the same way:

- Factor the host-gated inject into a small shared helper (e.g.
  `src/telemetry.ts` exporting `injectVercelTelemetry()`), reused by `bootstrap`,
  `gallery.ts`, and the `/help` entry script. Same host gate, same `try/catch`.
- `gallery.html` gains this analytics it does not have today; `/help` gets it
  from the start. So every page reports Core Web Vitals and page views like the
  game, on production and preview only.

## SEO / OG head parity

Both pages carry a full head like `index.html` / `gallery.html`: `title`, meta
`description`, `rel="canonical"` (the clean `/help` and `/gallery`), `robots`,
the `og:*` and `twitter:*` tags with an image and alt text, and a sitemap entry.
Both canonicals are the clean URLs served by the targeted Vercel rewrites above.

## Tests

- A page test asserts the `/help` page renders every shared guide section (each
  under an anchored heading, including the `classic-vs-modern` section whose
  `compareTemplate()` divergence phrases and "pixel-faithful to 1994" closer are
  present) and that the "Back to game" anchor targets `/`.
- A telemetry test (mirroring `bootstrap.test.ts`): the shared helper injects on
  `verticopolis.com` / `*.vercel.app` and no-ops elsewhere; the gallery and
  `/help` entry scripts call it.
- A guard asserts no page HTML/CSS other than the retro token file declares
  `--r-face` (single source of the palette; see retro-design-system.md).
- Progressive-enhancement handler: a unit test that with standalone detection
  true the click is intercepted (compare modal opens, no navigation) and with it
  false the anchor is left to navigate.
- Prerender: the page module clears any prerendered `#app` children before
  rendering (a unit test seeds the container and asserts a single copy after
  load), and `scripts/prerender-help.ts` enforces its own output at build time
  (guide prose present, every figure `src` a hashed `help-media` URL resolving
  to an emitted file, exact figure count), failing `npm run build` otherwise.
