import { test, expect } from "@playwright/test";
import { buildToStar } from "./helpers";

/**
 * Visual regression gate — the CI tripwire for the class of bug unit tests
 * can't see: a selector change inflating the title-bar ✕, a mis-scoped media
 * query stretching a button into a pill, a sprite refactor shifting a pixel.
 * (All three shipped before this gate existed.)
 *
 * Baselines are committed in visual.spec.ts-snapshots/. When a change is
 * INTENTIONAL, regenerate with `npm run e2e -- --update-snapshots` and review
 * the baseline diff like code — an unexplained pixel change IS the bug. On CI
 * failure, the actual/diff images land in test-results/ (uploaded as the
 * playwright-visual-diffs artifact).
 *
 * Determinism: the gallery pins performance.now before load (same trick as
 * scripts/screenshots.mjs) so canvas animation frames bake at one instant.
 * The dialog shots capture opaque DOM windows — no canvas bleed-through —
 * over a paused game (buildToStar sets speed 0) with the clock pinned.
 */

test.describe("sprite gallery", () => {
  test.use({ viewport: { width: 960, height: 1200 } });

  test("sprite catalog matches baseline", async ({ page }) => {
    await page.addInitScript(() => {
      performance.now = () => 12125;
    });
    await page.goto("/gallery.html", { waitUntil: "networkidle" });
    await page.waitForFunction(() => (window as unknown as { galleryReady?: boolean }).galleryReady === true);
    await expect(page).toHaveScreenshot("sprite-gallery.png", { fullPage: true });
  });
});

test.describe("dialog chrome", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).game));
    // Same setup as the milestones progression: drop the splash overlay
    // without resetting the sim, then grow a real 1★ tower. buildToStar
    // freezes time (speed 0) and fixes funds, so the only nondeterministic
    // value left is the clock — pin it back to the founding minute.
    await page.evaluate(() => document.getElementById("splash")?.remove());
    const star = await page.evaluate(buildToStar, 1);
    expect(star).toBe(1);
    await page.evaluate(() => {
      ((window as any).game.sim.clock as { minutes: number }).minutes = 7 * 60;
    });
  });

  test("stats dialog matches baseline", async ({ page }) => {
    await page.click("#btn-stats");
    await expect(page.locator("#modal .modal-box")).toHaveScreenshot("stats-dialog.png");
  });

  test("editor card matches baseline", async ({ page }) => {
    // Select an office through the same path a canvas click takes.
    await page.evaluate(() => {
      const g = (window as any).game;
      const office = g.sim.tower.units.find((u: { kind: string }) => u.kind === "office");
      g.selectPicked({ type: "unit", id: office.id, kind: office.kind });
    });
    await expect(page.locator("#editor")).toHaveScreenshot("editor-card.png");
  });
});
