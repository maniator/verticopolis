import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import { GENERAL_SPEC_PATTERN, SWITCHABLE_ONLY_SPEC_PATTERN } from "./src/tests/playwrightLaneSelection";

// The suite runs on the Rust engine (#1353). The switchable lane keeps the
// specs that depend on the engine-choice build, while the wasm-only lane runs
// the general browser-regression suite once against the wasm-only build, which
// sets no engine preference because it has no engine switch to read. The dual-
// lane integrity spec remains in both lanes because it checks the same behavior
// across the switchable and wasm-only builds.

// Playwright drives the BUILT app (via `vite preview`) for the Tier-2 end-to-end
// smoke. Headless Tier-1 playthrough tests live in vitest (the `src` tree); this
// config only covers the `e2e` folder. Run with `npm run e2e` after a build.
const WASM_ONLY = process.env.PW_WASM_ONLY === "1";
if (process.env.PW_WASM_ONLY && !WASM_ONLY) throw new Error(`PW_WASM_ONLY must be "1" or unset; got "${process.env.PW_WASM_ONLY}".`);
// The lane must match the build it serves: the projects of one lane fail in
// confusing ways against the other's build. The build records its mode.
const builtMode = (() => {
  let text: string;
  try {
    text = readFileSync(new URL("./dist/version.json", import.meta.url), "utf8");
  } catch {
    return null; // no build yet: the web server step reports that
  }
  try {
    return (JSON.parse(text) as { engineBuild?: string } | null)?.engineBuild ?? "unrecorded";
  } catch {
    throw new Error("dist/version.json is unreadable; rebuild (VC_TOOLING=1 npm run build, with VC_ENGINE=wasm for PW_WASM_ONLY=1).");
  }
})();
if (builtMode !== null && (builtMode === "wasm-only") !== WASM_ONLY) {
  throw new Error(
    `dist/ is a${builtMode === "unrecorded" ? "n older build that records no engine mode" : ` ${builtMode} build`}, but ` +
      `${WASM_ONLY ? "PW_WASM_ONLY=1 expects a wasm-only one" : "this lane expects a switchable one"}. Rebuild for the lane ` +
      `(VC_TOOLING=1 npm run build, with VC_ENGINE=wasm for PW_WASM_ONLY=1), or set PW_WASM_ONLY to match the build.`,
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  expect: {
    // Visual-baseline comparisons (visual.spec.ts). Animations are frozen and
    // the caret hidden so a blink can't flake a shot; the diff threshold stays
    // at Playwright's strict default — the compared surfaces are deterministic
    // (pinned clock, paused sim), so any pixel drift is a real change.
    toHaveScreenshot: { animations: "disabled", caret: "hide" },
  },
  // Baselines are minted by CI (the update-visual-baselines workflow) because
  // glyph/canvas rasterization differs across Chromium builds — a local
  // browser is never the arbiter. Locally the visual tests still RUN (the
  // clicks and locators smoke the dialogs) but skip the pixel comparison;
  // set PW_VISUAL=1 to compare anyway (e.g. to eyeball a diff in progress).
  ignoreSnapshots: !process.env.CI && !process.env.PW_VISUAL,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Sandboxes that can't download browsers can point at a preinstalled
    // Chromium (e.g. PW_CHROMIUM_PATH=/opt/pw-browsers/chromium). Unset —
    // the normal case, including CI — Playwright uses its own browser.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: WASM_ONLY
    ? [{ name: "chromium-wasm-only", testIgnore: [/visual\.spec\.ts/, SWITCHABLE_ONLY_SPEC_PATTERN], use: { ...devices["Desktop Chrome"] } }]
    : [
    // The Rust engine: the stored engine choice (`vc.engine`, see
    // src/wasmhost/engineChoice.ts) is seeded into localStorage so every page
    // the suite opens boots on it. This lane intentionally limits itself to the
    // switchable-only tests and the dual-lane integrity fallback assertions
    // whose behavior differs across builds, while the general browser
    // regression suite runs once on the wasm-only tooling build.
    {
      name: "chromium-wasm",
      testIgnore: [/wasmOnly\.spec\.ts/, GENERAL_SPEC_PATTERN],
      snapshotPathTemplate: "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-chromium{-snapshotSuffix}{ext}",
      use: {
        ...devices["Desktop Chrome"],
        storageState: {
          cookies: [],
          origins: [{ origin: "http://127.0.0.1:4173", localStorage: [{ name: "vc.engine", value: "wasm" }] }],
        },
      },
    },
  ],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
