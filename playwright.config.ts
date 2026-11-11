import { defineConfig, devices } from "@playwright/test";

// Playwright drives the BUILT app (via `vite preview`) for the Tier-2 end-to-end
// smoke. Headless Tier-1 playthrough tests live in vitest (the `src` tree); this
// config only covers the `e2e` folder. Run with `npm run e2e` after a tooling
// build (`VC_TOOLING=1 npm run build`).
//
// The game runs on the Rust engine only, so there is one build and one set of
// specs. The projects split the specs by how they need the machine, not by
// engine:
//   - `chromium-serial`: pixel baselines (visual, atlas), the perf gate and
//     the engine identity and status specs. These want exclusive CPU and fixed timing.
//   - `chromium`: the general browser regression suite.
// `npm run e2e` runs both; CI runs them as the `e2e-serial` and `e2e-general` jobs
// with `--project`.
const SERIAL_SPECS = ["engineIdentity", "engineStatusRows", "atlas", "visual", "perf", "overviewMapPerf"];
const SERIAL_SPEC_PATTERN = new RegExp(`(?:^|[\\\\/])(?:${SERIAL_SPECS.join("|")})\\.spec\\.ts$`);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker everywhere. Two on the general CI job broke main once (a mobile
  // gesture spec timed out) and the speed-up was never shown to be steady.
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
  projects: [
    {
      name: "chromium-serial",
      testMatch: SERIAL_SPEC_PATTERN,
      // Baselines are named for the browser, whatever the project is called.
      snapshotPathTemplate: "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-chromium{-snapshotSuffix}{ext}",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: SERIAL_SPEC_PATTERN,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
