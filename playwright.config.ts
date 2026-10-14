import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

// The engine legs of the visual gate (pr-drift-check.yml and
// update-visual-baselines.yml) set PW_WASM_VISUAL=1 to run visual.spec.ts on
// the WASM engine against the TypeScript engine's baselines. They compare
// pixels even off CI (a host browser renders differently, so a local run is
// expected to differ) and never mint: the committed baselines come from the
// TypeScript engine until the 3.0.0 flip.
const WASM_VISUAL = process.env.PW_WASM_VISUAL === "1";
if (WASM_VISUAL && process.argv.some((a) => a === "-u" || (a.startsWith("--update-snapshots") && a !== "--update-snapshots=none"))) {
  throw new Error("PW_WASM_VISUAL=1 compares against the committed baselines; it never updates them.");
}

// Playwright drives the BUILT app (via `vite preview`) for the Tier-2 end-to-end
// smoke. Headless Tier-1 playthrough tests live in vitest (the `src` tree); this
// config only covers the `e2e` folder. Run with `npm run e2e` after a build.
// The wasm-only lane (`VC_ENGINE=wasm` build; see src/build/engineBundle.ts):
// the suite runs once more against that build on its own project, which sets
// no engine preference because the build has no engine switch to read. It
// replaces the other two projects, whose builds it does not serve.
const WASM_ONLY = process.env.PW_WASM_ONLY === "1";
if (process.env.PW_WASM_ONLY && !WASM_ONLY) throw new Error(`PW_WASM_ONLY must be "1" or unset; got "${process.env.PW_WASM_ONLY}".`);
if (WASM_ONLY && WASM_VISUAL) throw new Error("PW_WASM_ONLY=1 and PW_WASM_VISUAL=1 are separate lanes; set one.");
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
    return "unrecorded"; // a corrupt file: rebuild, as the message says
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
  ignoreSnapshots: !process.env.CI && !process.env.PW_VISUAL && !WASM_VISUAL,
  // The engine leg never writes a baseline, a missing one included (the
  // default "missing" would mint the engine's render under the chromium name).
  ...(WASM_VISUAL ? { updateSnapshots: "none" as const } : {}),
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
    ? [{ name: "chromium-wasm-only", testIgnore: /visual\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }]
    : [
    { name: "chromium", testIgnore: /wasmOnly\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    // The same specs on the WASM engine: the stored engine choice (`vc.engine`,
    // see src/wasmhost/engineChoice.ts) is seeded into localStorage so every
    // page the suite opens boots on the Rust engine. Visual baselines are the
    // TypeScript engine's, so visual.spec.ts runs here only in the engine leg
    // (PW_WASM_VISUAL=1), and it reads the `chromium` baseline files.
    {
      name: "chromium-wasm",
      testIgnore: WASM_VISUAL ? [/wasmOnly\.spec\.ts/] : [/visual\.spec\.ts/, /wasmOnly\.spec\.ts/],
      ...(WASM_VISUAL ? { snapshotPathTemplate: "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-chromium{-snapshotSuffix}{ext}" } : {}),
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
