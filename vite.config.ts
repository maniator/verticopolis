import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { VitePWA } from "vite-plugin-pwa";

const pkgVersion = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")).version as string;

export default defineConfig({
  root: "src",
  base: "./",
  // Compile-time app version, shown on the splash. (package.json isn't importable
  // in the browser bundle.)
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  plugins: [
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
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
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
      // untested UI shell. Only tooling entry points are excluded: the
      // gallery/preview/excalibur pages and the PWA bootstrap are dev/build
      // plumbing, not game logic.
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.config.*",
        "**/types.ts",
        "src/tests/**",
        "src/gallery.ts",
        "src/preview.ts",
        "src/excalibur-main.ts",
        "src/pwa.ts",
      ],
    },
  },
});
