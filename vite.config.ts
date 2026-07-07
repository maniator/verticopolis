import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { VitePWA } from "vite-plugin-pwa";

const pkgVersion = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")).version as string;

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
 * always fetched network-fresh. `notes` is empty today; the `Player-note:`
 * trailer harvest (see AGENTS.md → Versioning) will populate it once
 * player-facing features ship.
 */
function emitVersionJson(): Plugin {
  return {
    name: "emit-version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: pkgVersion, sha: gitShortSha(), notes: [] as string[] }),
      });
    },
  };
}

export default defineConfig({
  root: "src",
  base: "./",
  // Compile-time app version, shown on the splash. (package.json isn't importable
  // in the browser bundle.)
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  plugins: [
    emitVersionJson(),
    // Installable PWA via Workbox (vite-plugin-pwa) — no hand-rolled service
    // worker. Registration is NOT auto-injected (`injectRegister: false`);
    // only the game entry (main.ts → src/pwa.ts) registers, so the tooling
    // pages (gallery/preview/excalibur) stay outside the app scope.
    //
    // `registerType: "prompt"` means a freshly built service worker waits
    // instead of hijacking the tab. The game listens for that (src/pwa.ts):
    // it forces a quick save, then activates the new worker so the player
    // always ends up on the latest assets without ever losing their tower.
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["apple-touch-icon.png", "favicon.png"],
      manifest: {
        name: "Verticopolis",
        short_name: "Verticopolis",
        description: "A browser-native SimTower clone — build a high-rise floor by floor.",
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
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        globIgnores: ["**/gallery*", "**/preview*", "**/excalibur*"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/gallery/, /preview/, /excalibur/],
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
        preview: resolve(__dirname, "src/preview.html"),
        excalibur: resolve(__dirname, "src/excalibur.html"),
      },
      output: {
        // Split the Excalibur engine into its own vendor chunk, separate from our
        // TowerEngine app code. Both the game (main) and the tooling (excalibur)
        // entry statically import it, so Rollup already hoisted it into one shared
        // chunk — but sharing a hash with our own code meant every TowerEngine edit
        // re-downloaded all ~550 kB of the pinned engine. Isolating it lets the
        // browser (and the PWA precache) reuse the engine across app updates.
        //
        // The name deliberately does NOT start with "excalibur": Workbox's
        // globIgnores excludes `**/excalibur*` from the game precache (to keep the
        // excalibur.html tooling entry out of the install), and a chunk named
        // `excalibur-*` would be wrongly dropped from the game's own precache.
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
    include: ["src/**/*.test.ts"],
    // A few end-to-end tests drive many in-game days of the full hourly v2
    // simulation over a tall tower; they pass quickly locally but can exceed the
    // 5s default on slower CI runners. Give the suite generous headroom.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // Measure the whole app, not just the well-tested engine — a report
      // scoped to the strong layers overstates coverage and hides the
      // untested UI shell. Excluded: non-code (declarations, configs), the
      // tests themselves, and the tooling entry points (gallery/preview/
      // excalibur pages, PWA bootstrap) — dev/build plumbing, not game
      // logic. types.ts is measured: it carries runtime predicates
      // (isPresent/isDormant), not just type aliases.
      //
      // Also excluded: layers that can only run against a real device and are
      // therefore covered by the Playwright Tier-2 tier (e2e/*.spec.ts drive the
      // live app end to end), NOT vitest — measuring them here would just depress
      // the unit number with lines no unit test can reach:
      //   - the canvas/WebGL DRAWING layer (the Excalibur engine wrapper and the
      //     pixel-sprite painters);
      //   - the Web-Audio SYNTHESIS engine (ToneAudioEngine needs an AudioContext);
      //   - src/main.ts, the composition root / app entry: its constructor news
      //     up TowerEngine (boots Excalibur/WebGL), so `new GameApp()` can't run
      //     headless. Its testable LOGIC was deliberately extracted into the
      //     src/game/* controllers (build/editor/saveLoad/inspector/keyboard),
      //     which ARE measured and well covered; what remains is engine + rAF +
      //     DOM/PWA wiring, exercised by e2e (window.game in the *.spec.ts).
      // The PURE-logic render code stays measured: src/render/facadeGeometry.ts
      // computes geometry (no canvas) and is unit-tested like the rest.
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.config.*",
        "src/tests/**",
        "src/gallery.ts",
        "src/preview.ts",
        "src/excalibur-main.ts",
        "src/pwa.ts",
        "src/main.ts",
        "src/audio/ToneAudioEngine.ts",
        "src/render/excalibur/**",
        "src/render/pixelSprites.ts",
        "src/render/sprites.ts",
        "src/render/sprites/**",
      ],
      // Enforced floor (agreed 2026-07-07): a ratchet so unit coverage of the
      // testable logic can't rot, not a vanity ceiling. Branches/functions run
      // a touch lower than lines/statements because defensive else-arms are
      // legitimately hard to force without writing junk tests.
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 80,
        branches: 80,
      },
    },
  },
});
