/**
 * Shared vocabulary for the screenshot generator: output dirs, browser/server
 * config, and the Shot/Scene manifest types. Node-side only, imported by the
 * runner (screenshots.ts) and the manifest (screenshot-scenes.ts).
 *
 * Keep this file ERASABLE (type annotations / interfaces / `as` only; no enums,
 * namespaces, or parameter properties) so `node scripts/screenshots.ts` can run
 * it directly via native type-stripping.
 */
import { type Page } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");
// Where the generated gallery is written. Defaults to the committed
// docs/screenshots tree; SHOTS_DIR relocates the whole set (features/milestones
// stay relative to it) so two renders can run CONCURRENTLY into separate roots
// without clobbering each other's PNGs. The determinism guard (screenshot-
// determinism-check.ts) uses this to render its two independent legs in parallel:
// leg a into <root-a>/docs/screenshots, leg b into <root-b>/docs/screenshots,
// then byte-diffs the two trees. A relative SHOTS_DIR resolves against ROOT (not
// process.cwd()), matching the default above, so the override is stable no matter
// where the script is launched from; an absolute value is used as-is.
const SHOTS_DIR = process.env.SHOTS_DIR ? resolve(ROOT, process.env.SHOTS_DIR) : resolve(ROOT, "docs/screenshots");
export const DIRS = {
  screenshots: SHOTS_DIR,
  features: resolve(SHOTS_DIR, "features"),
  milestones: resolve(SHOTS_DIR, "milestones"),
};
export type OutDir = keyof typeof DIRS;
// Browser: PW_CHROME wins (the CI container path sets it to the image's Chromium);
// else a preinstalled sandbox Chromium if present; else undefined so Playwright
// launches its OWN bundled browser (the normal `npm run screenshots` dev machine).
const SANDBOX_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
export const EXECUTABLE = process.env.PW_CHROME || (existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : undefined);
export const PORT = Number(process.env.PORT || 4173);
export const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });

export type Viewport = { width: number; height: number };
export type Frame = { tile?: number; floor: number; zoom: number };

export interface Shot {
  name: string; // file basename, no extension
  outDir?: OutDir; // defaults to the scene's outDir
  clock?: number; // set the in-game hour (0..23) before framing
  overlay?: "" | "congestion" | "occupancy" | "satisfaction"; // map overlay via the real dropdown
  frame?: Frame; // camera: centre tile (default lot centre), floor, zoom
  crop?: string; // CSS selector to screenshot instead of the whole page
  fullPage?: boolean;
  viewport?: Viewport; // temporary viewport override for this shot
  wait?: number; // extra settle ms (default 500)
  // Force a FULL draw during this shot's settle (draw every frame, not just the
  // final one). By default a settle skips the intermediate draws (pgStepNoDraw):
  // only the final frame is captured, so the discarded frames' software raster is
  // pure waste, and the drawPos sync keeps that final frame byte-identical. That
  // skip is safe for the whole gallery EXCEPT a few draw-coupled shots: per-shot
  // viewport resizes (the tablet shots) and shots whose pixels advance in the draw
  // path (the sky/sun clips, the live-engine previews). Those set drawSettle so
  // their settle draws every frame. See pgStepNoDraw for the coupling.
  drawSettle?: boolean;
  keepDialogs?: boolean; // this shot INTENTIONALLY shows a modal, so don't clear it
  setup?: (page: Page) => Promise<void>; // escape hatch for one-off staging
}

export interface Scene {
  id: string;
  outDir: OutDir;
  viewport?: Viewport; // desktop by default
  route?: string; // navigate here instead of building a tower (gallery/preview)
  keepSplash?: boolean; // firstRun scene captures splash states, so don't dismiss
  initScript?: () => void; // runs before page scripts, for per-scene localStorage/bootstrap tweaks
  build?: () => void; // stage the sim once for this scene (runs in-page)
  assertUnits?: number; // after build, assert the tower has ≥ this many units
  shots: Shot[];
}

export const DESKTOP: Viewport = { width: 1280, height: 800 };
export const PHONE: Viewport = { width: 390, height: 844 };

/** Assert the page finished staging: the splash is gone and (optionally) the
 *  tower has at least `minUnits` units. Shared by the runner and by the few
 *  scene setups that build a tower inline before surfacing a modal. */
export async function assertReady(page: Page, minUnits: number): Promise<void> {
  const state = await page.evaluate(() => ({
    splash: !!document.getElementById("splash"),
    units: (window as unknown as { game?: any }).game?.sim?.tower?.units?.length ?? 0,
  }));
  if (state.splash) throw new Error("splash leaked (not dismissed)");
  if (minUnits > 0 && state.units < minUnits) throw new Error(`tower too small (${state.units} < ${minUnits} units)`);
}
