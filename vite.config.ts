import { defineConfig, type Plugin, type HtmlTagDescriptor } from "vite";
import { configDefaults } from "vitest/config";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { VitePWA } from "vite-plugin-pwa";
import { notesForVersion } from "./src/changelog";

const pkgVersion = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")).version as string;

/** Player-facing "What's new" lines for THIS build, read from the committed
 *  CHANGELOG.md section matching the package version (empty for an internal
 *  build with no player notes, or if the file is missing/unreadable). */
function changelogNotes(): string[] {
  try {
    return notesForVersion(readFileSync(resolve(__dirname, "CHANGELOG.md"), "utf8"), pkgVersion);
  } catch {
    return [];
  }
}

/** Short git SHA of the build, or "unknown" outside a checkout. */
function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

/**
 * Emit `dist/version.json` describing THIS build — the file the running (old)
 * client fetches when a new worker is waiting, to learn what it's updating to
 * (see src/pwa.ts `fetchUpdateInfo`). It is deliberately a `.json`, which
 * Workbox's `globPatterns` does not match, so it is never precached and is
 * always fetched network-fresh. `notes` is the player-facing "What's new" list,
 * read from the CHANGELOG.md section matching this version (see `changelogNotes`
 * and CONTRIBUTING.md → "Player notes").
 */
function emitVersionJson(): Plugin {
  return {
    name: "emit-version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: pkgVersion, sha: gitShortSha(), notes: changelogNotes() }),
      });
    },
  };
}

/** The one alt text for the shared social share card (og-image.png), reused by
 *  every page's og:image:alt / twitter:image:alt below. */
const OG_IMAGE_ALT =
  "Verticopolis: an art-deco skyline at dusk with the tagline Build a SimTower-style skyscraper in your browser and a Play free call to action.";

/**
 * The SEO/OG head tags every deployed page shares, identical across the game,
 * the gallery, and the /help page. Per-page UNIQUE tags (title, description,
 * canonical, og:url, og:title/description, twitter:title/description) stay inline
 * in each page's own HTML; only the invariant boilerplate is centralized here.
 *
 * These are injected at BUILD time (static HTML, so search crawlers and social
 * unfurlers, which don't run JavaScript, see them) rather than copy-pasted per
 * page. lit-html renders the page BODY at runtime, but the head must be static,
 * so this build-time inject is the crawler-safe way to keep one source.
 */
const SHARED_HEAD_TAGS: HtmlTagDescriptor[] = [
  { tag: "meta", attrs: { name: "robots", content: "index, follow, max-image-preview:large" }, injectTo: "head" },
  { tag: "meta", attrs: { property: "og:type", content: "website" }, injectTo: "head" },
  { tag: "meta", attrs: { property: "og:site_name", content: "Verticopolis" }, injectTo: "head" },
  { tag: "meta", attrs: { property: "og:image", content: "https://verticopolis.com/og-image.png" }, injectTo: "head" },
  { tag: "meta", attrs: { property: "og:image:width", content: "1200" }, injectTo: "head" },
  { tag: "meta", attrs: { property: "og:image:height", content: "630" }, injectTo: "head" },
  { tag: "meta", attrs: { property: "og:image:alt", content: OG_IMAGE_ALT }, injectTo: "head" },
  { tag: "meta", attrs: { property: "og:locale", content: "en_US" }, injectTo: "head" },
  { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" }, injectTo: "head" },
  { tag: "meta", attrs: { name: "twitter:image", content: "https://verticopolis.com/og-image.png" }, injectTo: "head" },
  { tag: "meta", attrs: { name: "twitter:image:alt", content: OG_IMAGE_ALT }, injectTo: "head" },
  { tag: "meta", attrs: { name: "theme-color", content: "#000080" }, injectTo: "head" },
  { tag: "link", attrs: { rel: "icon", href: "./favicon.png", type: "image/png" }, injectTo: "head" },
  { tag: "link", attrs: { rel: "apple-touch-icon", href: "./apple-touch-icon.png" }, injectTo: "head" },
];

/** Inject the shared head tags into the three PUBLIC pages (the game, the
 *  gallery, and /help). `preview.html` is the noindex screenshot harness, so it
 *  is deliberately left out. */
function sharedHead(): Plugin {
  const pages = new Set(["index.html", "gallery.html", "help.html"]);
  return {
    name: "shared-head",
    transformIndexHtml: {
      order: "pre",
      handler(_html, ctx) {
        // ctx.path is the page path. The production build always passes the real
        // filename (e.g. "/index.html"), but the dev server serves the game at
        // "/", whose basename is "", so map an empty basename to index.html.
        const base = (ctx.path.split("?")[0].split("/").pop() ?? "").toLowerCase();
        const file = base === "" ? "index.html" : base;
        return pages.has(file) ? SHARED_HEAD_TAGS : [];
      },
    },
  };
}

export default defineConfig({
  root: "src",
  base: "./",
  // Compile-time app version, shown on the splash. (package.json isn't importable
  // in the browser bundle.)
  // Compile-time build identity. `__APP_VERSION__` shows on the splash;
  // `__APP_SHA__` lets the running client compare itself against the deployed
  // `version.json` (see src/pwa.ts) so it can detect a newer build even if the
  // service-worker update check is missed.
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __APP_SHA__: JSON.stringify(gitShortSha()),
  },
  plugins: [
    emitVersionJson(),
    sharedHead(),
    // Installable PWA via Workbox (vite-plugin-pwa) — no hand-rolled service
    // worker. Registration is NOT auto-injected (`injectRegister: false`);
    // only the game entry (main.ts → src/pwa.ts) registers, so the tooling
    // pages (gallery/preview) stay outside the app scope.
    //
    // `registerType: "prompt"` means a freshly built service worker waits
    // instead of hijacking the tab. The game listens for that (src/pwa.ts):
    // it forces a quick save, then activates the new worker so the player
    // always ends up on the latest assets without ever losing their tower.
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      // Every icon (favicon, apple-touch-icon, the three manifest icons) is
      // already precached ONCE by the workbox globPatterns below (**/*.png over
      // the build output). `includeAssets` and the plugin's default
      // includeManifestIcons: true would add the same five files a second time,
      // which double-listed them in the generated service-worker manifest and
      // overstated the build log's precache count (26 listed, 21 unique;
      // PROD-003). Workbox deduped at install, so nothing user-facing changed,
      // but the manifest and its reported count should tell the truth.
      includeManifestIcons: false,
      manifest: {
        name: "Verticopolis",
        short_name: "Verticopolis",
        description: "A browser-native SimTower clone: build a high-rise floor by floor.",
        theme_color: "#000080",
        background_color: "#008080",
        display: "standalone",
        orientation: "any",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the game shell only. The dev/tooling entry points and their
        // chunks are excluded so an install ships just the game.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,mp3}"],
        // og-image.png is the social/crawler share card, not part of the game
        // shell, so keep it out of the offline precache. `help.html` and its own
        // page entry chunk (`help-*.js`) are excluded too (see the note below),
        // and so is `assets/help-media/**`, the `/help` page's Classic vs Modern
        // stills (online-only, like the rest of `/help`; see the build's
        // `assetFileNames` note). The two help patterns are deliberately narrow:
        // `**/help.html` and `**/help-*.js` match the page and its entry chunk,
        // while the shared `helpContent-*.js` chunk (which starts with `helpC`,
        // not `help-`) is left precached, because the in-game Help modal imports
        // it and needs it offline. A broad `**/help*` would wrongly sweep
        // `helpContent-*.js` too.
        globIgnores: ["**/gallery*", "**/preview*", "**/og-image*", "**/help.html", "**/help-*.js", "**/help-media/**"],
        navigateFallback: "index.html",
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
        // update). The `navigateFallbackDenylist` alone does not prevent this: it
        // governs only the app-shell NavigationRoute, not the precache route. Not
        // precaching the page is the fix; the trade-off is that `/help` is
        // online-only (no offline copy), the same call already made for `/gallery`.
        // A precache alias for the clean URL is separately rejected: with
        // generateSW it would make Workbox fetch `/help` at install, which 404s
        // anywhere the Vercel rewrite is absent (`vite preview`, the e2e harness),
        // failing the whole precache and taking the game's offline down with it.
        navigateFallbackDenylist: [/gallery/, /help/, /preview/, /version\.json$/, /robots\.txt$/, /sitemap\.xml$/, /og-image\.png$/],
        cleanupOutdatedCaches: true,
        // Excalibur's bundle is comfortably large; lift the precache ceiling.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: {
        // Keep the service worker out of `vite dev` so it can't cache-poison HMR.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    open: false,
    host: true,
  },
  build: {
    target: "esnext",
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        gallery: resolve(__dirname, "src/gallery.html"),
        help: resolve(__dirname, "src/help.html"),
        preview: resolve(__dirname, "src/preview.html"),
      },
      output: {
        // The `/help` page's paired Classic vs Modern stills are imported from
        // `docs/screenshots` (one source with the docs gallery). Route those
        // assets into a dedicated `assets/help-media/` folder so the
        // service-worker precache can exclude them with a single `**/help-media/**`
        // glob: the `/help` page is online-only (see the workbox globIgnores note),
        // so its images do not belong in the game-shell install. Every other asset
        // keeps Vite's default `assets/[name]-[hash][extname]` path.
        assetFileNames(info) {
          const sources = info.originalFileNames ?? (info.originalFileName ? [info.originalFileName] : []);
          const fromHelpMedia = sources.some((p) => p.replace(/\\/g, "/").includes("docs/screenshots/"));
          return fromHelpMedia ? "assets/help-media/[name]-[hash][extname]" : "assets/[name]-[hash][extname]";
        },
        // Split the Excalibur engine into its own vendor chunk, separate from our
        // TowerEngine app code. Sharing a hash with our own code meant every
        // TowerEngine edit re-downloaded all ~550 kB of the pinned engine.
        // Isolating it lets the browser (and the PWA precache) reuse the engine
        // across app updates. The name starts with "vendor", so it does not match
        // Workbox's `**/gallery*` / `**/preview*` tooling-page globIgnores.
        manualChunks(id) {
          // Normalize separators before matching: Rollup normally emits POSIX
          // module ids, but be defensive so the split still holds if a build
          // (e.g. Windows) surfaces backslashes.
          if (id.replace(/\\/g, "/").includes("node_modules/excalibur")) return "vendor-excalibur";
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    root: ".",
    // A few end-to-end tests drive many in-game days of the full hourly v2
    // simulation over a tall tower; they pass quickly locally but can exceed the
    // 5s default on slower CI runners. Give the suite generous headroom.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Two tiers, split by filename suffix (see CONTRIBUTING.md → "Testing &
    // coverage"). UNIT tests sit next to the module they cover (`foo.ts` +
    // `foo.test.ts`) and mock their collaborators; INTEGRATION tests drive
    // several modules or a whole Sim/Tower and carry the `.integration.test.ts`
    // suffix. `vitest run` runs both (the CI gate); `vitest --project unit` /
    // `--project integration` runs one. Coverage stays at the root config below
    // so the single ratchet still measures the whole app across both projects.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          // Setting `exclude` on a project REPLACES Vitest's built-in defaults
          // (node_modules, dist, etc.), so spread them back in before adding our
          // own. The `include` is scoped to `src/**` today so nothing vendored is
          // reachable, but the colocation reorg keeps moving test files around;
          // keeping the defaults means a stray `*.test.ts` under a future
          // `src/**/node_modules` or build-output dir can never be collected.
          exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // Coverage measures the whole app so the report can't overstate itself.
      // Only code that can't run headless is excluded — src/main.ts (its ctor
      // boots the WebGL engine) and src/render/excalibur/** — plus dev/tooling
      // entry points; those are integration-covered by the Playwright e2e tier.
      // Everything else (incl. the sprite painters and the audio engine) IS
      // unit-measured. Rationale, test tiers, and the per-file floors below are
      // documented in CONTRIBUTING.md → "Testing & coverage".
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.config.*",
        // Test files never count as measured source. Colocated unit tests
        // (`foo.test.ts` next to `foo.ts`) make this glob load-bearing: the
        // custom exclude array REPLACES Vitest's defaults, so without it every
        // colocated test would be scored as uncovered source and sink the floors.
        "**/*.test.ts",
        // Fixtures and any non-`.test.ts` helpers under the integration tree.
        "src/tests/**",
        "src/gallery.ts",
        "src/helpPage.ts",
        "src/preview.ts",
        "src/pwa.ts",
        "src/main.ts",
        // The boot entry (bootstrap.ts) and constructor wiring (game/appBoot.ts)
        // extracted from main.ts are MEASURED: both run headlessly and carry
        // their own unit tests (bootstrap.test.ts covers the WebGL probe, the
        // telemetry gate, and the boot/error branches; appBoot.test.ts drives
        // runBootFlow and invokes every wireControllers adapter closure). Only
        // main.ts itself stays excluded, because its ctor boots the real WebGL
        // engine.
        // The Excalibur/WebGL render layer was split into friend-modules; the
        // headless-testable ones are now MEASURED (towerInputCamera, towerOverlay,
        // towerCrowd) with per-file floors below. What stays excluded genuinely
        // can't run under happy-dom: its logic funnels through `new ex.Canvas`
        // (which needs a real 2D context) and the live Excalibur engine.
        //   - TowerEngine.ts: the class ctor boots the WebGL engine; its methods
        //     are thin delegations to the measured friend-modules.
        //   - towerScene.ts: bakeSharedGraphics / makeSky / makeOverlay and the
        //     dispose/teardown lifecycle all allocate ex.Canvas or drive engine
        //     teardown; only two trivial pure exports are reachable.
        //   - towerReconcile.ts: every reconciler funnels through addRoom /
        //     addTransport / transportGraphic / syncCrane, all of which bake an
        //     ex.Canvas, so nothing here can run headless.
        // These are integration-covered by the Playwright e2e tier.
        "src/render/excalibur/TowerEngine.ts",
        "src/render/excalibur/towerScene.ts",
        "src/render/excalibur/towerReconcile.ts",
      ],
      // Enforced floors (a ratchet, not a vanity ceiling). Global floor holds the
      // logic layers; per-file globs stop a weak painter/synth file hiding behind
      // strong siblings. Draw code gets lower BRANCH floors (visual variants are
      // the e2e visual tier's job). See CONTRIBUTING.md → "Coverage floors".
      thresholds: {
        statements: 93,
        lines: 94,
        functions: 94,
        branches: 86,
        // Per-file lines are EXEMPTIONS only: the audio graph and the procedural
        // draw code genuinely can't reach the branch/line floor from unit tests
        // (audio wiring and per-pixel visual variants are the Playwright e2e
        // tier's job), so those files get a lower floor. A file that already
        // clears the global gets no line: a per-file threshold that just
        // restates the global earns nothing and is left off.
        // ToneAudioEngine.ts is the graph/lifecycle orchestrator: it clears the
        // global on statements and lines, so only its function and branch floors
        // stay lower. The mocked-Tone graph test drives the wiring end to end,
        // but units can't reach every construction and teardown branch.
        // (toneVoices.ts, slimmed to the action jingles, now clears the global
        // outright and needs no per-file floor.)
        "src/audio/ToneAudioEngine.ts": { functions: 80, branches: 72 },
        "src/render/sprites/**": { branches: 72 },
        "src/render/pixelSprites.ts": { statements: 82, lines: 84 },
        // towerCrowd.ts is MEASURED, but roughly half of it (syncMotion,
        // buildWalkers, spawnWalker) bakes ex.Canvas cab/train/walker graphics,
        // which needs a real 2D context and can't run under happy-dom; that half
        // is the Playwright tier's job. The reconcile/clear/updateMotion paths
        // ARE unit-covered here, so it gets an honest lower floor rather than
        // staying fully excluded.
        "src/render/excalibur/towerCrowd.ts": { statements: 46, lines: 46, functions: 50, branches: 45 },
      },
    },
  },
});
