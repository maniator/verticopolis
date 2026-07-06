import { test, expect } from "@playwright/test";
import { buildToStar } from "./helpers";

/**
 * Visual regression gate — the CI tripwire for the class of bug unit tests
 * can't see: a selector change inflating the title-bar ✕, a mis-scoped media
 * query stretching a button into a pill, a sprite refactor shifting a pixel.
 * (All three shipped before this gate existed.)
 *
 * Baselines are committed in visual.spec.ts-snapshots/ and MINTED BY CI (push
 * a commit containing "[update-baselines]" — see the update-visual-baselines
 * workflow): rasterization differs across Chromium builds, so only the CI
 * renderer's output binds. Review the bot's baseline commit like code — an
 * unexplained pixel change IS the bug. Local runs skip the pixel comparison
 * (see ignoreSnapshots in playwright.config.ts) but still smoke the dialogs;
 * on CI failure the actual/diff images land in test-results/ (uploaded as
 * the playwright-visual-diffs artifact).
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

  test("update prompt matches baseline and freezes the sim", async ({ page }) => {
    // Surface the update prompt exactly as the PWA layer does when a new build
    // is found (the activate callback is a no-op so the page doesn't reload).
    // The prompt auto-surfaces from the game loop at the next calm moment.
    await page.evaluate(() => (window as any).game.onUpdateAvailable(async () => {}));
    await page.waitForSelector("#modal[open]");

    // While the prompt is open the sim is FROZEN — even at full speed the clock
    // must not advance, so a player reading it can't lose game-hours. (Restore
    // speed 0 afterward so the shot stays deterministic like the sibling tests.)
    await page.evaluate(() => ((window as any).game.speed = 3));
    const before = await page.evaluate(() => (window as any).game.sim.clock.minutes);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => (window as any).game.sim.clock.minutes);
    expect(after).toBe(before);
    await page.evaluate(() => ((window as any).game.speed = 0));

    await expect(page.locator("#modal .modal-box")).toHaveScreenshot("update-prompt.png");
  });

  test("deferred update chip matches baseline", async ({ page }) => {
    // Find an update, then choose "Later" — the deferred state where the modal
    // is gone but the "↻ Update" chip stays in the speed toolbar as the way back
    // in. Snapshot that toolbar cluster (static — no live counters) so the chip's
    // placement and styling are pinned.
    await page.evaluate(() => (window as any).game.onUpdateAvailable(async () => {}));
    await page.waitForSelector("#modal[open]");
    await page.locator('#modal [data-act="later"]').click();
    await page.waitForFunction(() => document.getElementById("modal")?.open === false);
    await page.waitForSelector("#btn-update:not([hidden])");
    await expect(page.locator("#speed")).toHaveScreenshot("update-chip.png");
  });
});
