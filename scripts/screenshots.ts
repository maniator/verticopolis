/**
 * Verticopolis screenshot generator: the SINGLE source of truth for every image
 * under docs/screenshots/ (showcase), docs/screenshots/features/ (feature shots),
 * and docs/screenshots/milestones/ (the star ladder). Replaces the old fleet of
 * shot-*.mjs scripts.
 *
 * This file is the RUNNER + entry point. The rest of the generator is split by
 * execution context so each part reads on its own:
 *   • screenshot-env.ts      : output dirs, browser/server config, Shot/Scene types
 *   • screenshot-builders.ts : the page-context builders (⚠ serialized into the
 *                              browser; self-contained, see that file's banner)
 *   • screenshot-scenes.ts   : the declarative SCENES manifest (what shots exist)
 *
 * Run:  npm run screenshots        (local host capture: build + serve + shoot
 *                                    with the host Chromium. Fast, for PREVIEW
 *                                    and iteration only. Its DOM-chrome pixels
 *                                    can differ by a hair, so do NOT commit its
 *                                    output as the final set.)
 *   or: node scripts/screenshots.ts   (against an already-built dist on :4173)
 *
 * The CANONICAL committed images come from CI, never a local run: the
 * update-screenshots.yml and update-visual-baselines.yml workflows run this
 * generator inside the pinned Playwright Docker image (one Chromium build +
 * fonts, so antialiasing is stable) and commit the pixels back. A marker push
 * (`[update-screenshots]` / `[update-baselines]`) triggers them. Regenerate the
 * committed set that way, not by committing a host run.
 *
 * Env knobs: RUN_SERVER=1 spawns its own `vite preview`; ONLY=milestones,tablet
 * re-shoots just those scene ids; BASE_URL / PORT / PW_CHROME override targets.
 *
 * TypeScript runs natively on Node ≥ 22.18 (type-stripping): no build step, no
 * extra dep. Keep every module here ERASABLE (type annotations / interfaces /
 * `as` only; no enums, namespaces, or parameter properties), and import sibling
 * modules with an explicit `.ts` extension so the native loader resolves them.
 */
import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { DIRS, DESKTOP, PHONE, EXECUTABLE, PORT, BASE, assertReady, type OutDir, type Scene, type Shot } from "./screenshot-env.ts";
import { pgClearTransients, pgDismissSplash, pgFrame, pgSetClock, pgSetOverlay } from "./screenshot-builders.ts";
import { SCENES } from "./screenshot-scenes.ts";

// ---- Runner -----------------------------------------------------------------

let captured = 0;
const failures: string[] = [];
const perDir: Record<OutDir, number> = { screenshots: 0, features: 0, milestones: 0 };

async function takeShot(page: Page, scene: Scene, shot: Shot): Promise<void> {
  const outDir = shot.outDir ?? scene.outDir;
  const path = join(DIRS[outDir], `${shot.name}.png`);
  const baseVp = scene.viewport ?? DESKTOP;
  if (shot.viewport) await page.setViewportSize(shot.viewport);
  try {
    if (shot.clock !== undefined) await page.evaluate(pgSetClock, shot.clock);
    // Always drive the overlay dropdown (default "") so a prior shot's overlay
    // never bleeds into the next, so every shot gets a clean map state.
    await page.evaluate(pgSetOverlay, shot.overlay ?? "");
    if (shot.setup) await shot.setup(page);
    if (shot.frame) {
      await page.evaluate(pgFrame, { tile: shot.frame.tile ?? null, floor: shot.frame.floor, zoom: shot.frame.zoom });
    }
    await page.waitForTimeout(shot.wait ?? 500);
    // Sweep stray toasts / event dialogs the running sim may have popped during
    // the wait, unless this shot is deliberately showing a modal.
    const keepDialogs = shot.keepDialogs ?? (!!shot.crop && shot.crop.includes("modal"));
    await page.evaluate(pgClearTransients, keepDialogs);
    await page.waitForTimeout(80);
    if (shot.crop) {
      await page.locator(shot.crop).screenshot({ path });
    } else {
      await page.screenshot({ path, fullPage: !!shot.fullPage });
    }
  } finally {
    // Always restore the scene viewport, even if the shot threw, so one failed
    // shot can't cascade a wrong size into the rest of the scene.
    if (shot.viewport) await page.setViewportSize(baseVp);
  }
  captured++;
  perDir[outDir]++;
  console.log(`  ✓ ${outDir}/${shot.name}`);
}

async function runScene(browser: Browser, scene: Scene): Promise<void> {
  console.log(`\n▶ scene: ${scene.id}`);
  const vp = scene.viewport ?? DESKTOP;
  // A phone-sized scene must also present as a touch device, or `@media (pointer:
  // coarse)` / mobile-only chrome never applies and the "mobile" shot renders the
  // desktop UI. isMobile/hasTouch are Chromium-only (we always launch Chromium).
  const mobile = vp.width <= PHONE.width;
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: scene.outDir === "screenshots" ? 1 : 2, isMobile: mobile, hasTouch: mobile });
  page.on("pageerror", (e) => console.error("  PAGE ERROR:", e.message));
  try {
    if (scene.route) {
      // Route pages (e.g. preview.html) animate off performance.now(); pin it to a
      // constant BEFORE any page script runs so the captured frame is byte-stable
      // even inside the pinned container. Each route page sets its ready flag
      // synchronously at module load, so freezing the timer never blocks it.
      await page.addInitScript(() => {
        const t = 1_000;
        // Assigning performance.now directly can throw in a hardened Chromium
        // (the property may be non-writable); define it defensively and never
        // let this break navigation.
        try {
          Object.defineProperty(performance, "now", { configurable: true, value: () => t });
        } catch {
          try {
            performance.now = () => t;
          } catch {
            /* keep the real clock; the frame just won't be perfectly frozen */
          }
        }
      });
    }
    await page.goto(scene.route ? `${BASE}/${scene.route}` : BASE, { waitUntil: "networkidle" });
    if (scene.route) {
      // Route pages set their own ready flag (galleryReady / excaliburReady / previewReady).
      // A missing flag means the page never finished rendering, so capturing now would
      // commit a blank/half-drawn PNG over a good one. Record the failure and SKIP the
      // scene's shots entirely, leaving the existing committed images untouched.
      try {
        await page.waitForFunction(() => {
          const w = window as any;
          return w.galleryReady === true || w.excaliburReady === true || w.previewReady === true;
        }, null, { timeout: 12000 });
      } catch {
        for (const shot of scene.shots) {
          failures.push(`${scene.id}/${shot.name}: route never signaled ready, skipped (kept existing image)`);
          console.error(`  ✗ ${shot.name}: route never ready, skipped`);
        }
        return;
      }
      await page.waitForTimeout(800);
    } else {
      await page.waitForFunction(() => !!(window as any).game, null, { timeout: 15000 });
      if (!scene.keepSplash) await page.evaluate(pgDismissSplash);
      if (scene.build) await page.evaluate(scene.build);
      if (scene.assertUnits) await assertReady(page, scene.assertUnits);
    }
    for (const shot of scene.shots) {
      try {
        await takeShot(page, scene, shot);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`${scene.id}/${shot.name}: ${msg}`);
        console.error(`  ✗ ${shot.name}: ${msg}`);
      }
    }
  } finally {
    await page.close();
  }
}


// ---- main -------------------------------------------------------------------

async function main(): Promise<void> {
  let server: ChildProcess | null = null;
  if (process.env.RUN_SERVER) {
    server = spawn("npx", ["vite", "preview", "--port", String(PORT)], { stdio: "inherit" });
    // Wait for the preview server to answer.
    const ok = await (async () => {
      for (let i = 0; i < 40; i++) {
        try {
          const res = await fetch(BASE);
          if (res.ok) return true;
        } catch {
          /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    })();
    if (!ok) {
      server.kill("SIGTERM");
      throw new Error("vite preview did not come up");
    }
  }

  // ONLY=scene-id[,scene-id] re-shoots a subset (fast iteration); default all.
  const only = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  const scenes = only.length ? SCENES.filter((sc) => only.includes(sc.id)) : SCENES;
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  try {
    for (const scene of scenes) {
      // A scene's setup (game wait / build / assertReady) can throw; keep it from
      // aborting the whole run. Record every shot in the scene as failed (so its
      // existing committed image is left untouched) and move to the next scene.
      try {
        await runScene(browser, scene);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        for (const shot of scene.shots) failures.push(`${scene.id}/${shot.name}: scene setup failed (${msg})`);
        console.error(`  ✗ scene ${scene.id} aborted: ${msg}`);
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }

  console.log(`\n──────── captured ${captured} shots ────────`);
  for (const d of Object.keys(perDir) as OutDir[]) console.log(`  ${d.padEnd(12)} ${perDir[d]}`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
