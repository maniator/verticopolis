import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildToStar, fitCamera } from "./helpers";

/**
 * Visual progression proof: one tower grown cumulatively through every rating
 * rung, with a screenshot captured at each. The STAR assertion at each rung is
 * the test (screenshots are artifacts, never pixel-compared: a game canvas
 * renders a hair differently per machine). The images land in e2e/output/
 * (UNTRACKED, gitignored) and CI uploads them as the per-run artifact
 * (test.yml). They must never write into the committed gallery: the
 * docs/screenshots/milestones/ baseline is rendered only by the pinned
 * Playwright container (scripts/screenshots.ts via pr-drift-check), and a
 * local `npm run e2e` on a host browser would silently dirty it with
 * different pixels (audit finding AUD-005). The final frame catches the
 * "TOWER achieved!" modal over the full tower.
 */
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "output", "milestones");
const FRAMES: ReadonlyArray<readonly [number, string]> = [
  [1, "1-star"],
  [2, "2-star"],
  [3, "3-star"],
  [4, "4-star"],
  [5, "5-star"],
  [6, "tower"],
];

test.use({ viewport: { width: 1000, height: 1200 } });

test("progression: a screenshot at each ★ milestone, 1★ → TOWER", async ({ page }) => {
  test.setTimeout(180_000); // grows a real 100-floor tower in-page across six rungs
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game));

  // Dismiss the first-run splash overlay so captures show the tower, not the
  // title screen. Just remove the overlay — don't click "New Tower" (resets the
  // sim buildToStar grows) and don't resume the engine: the game stays paused
  // (speed 0), so the clock and ambient motion can't drift between frames. The
  // renderer still reconciles the tower each frame regardless of paused, so the
  // built tower shows; only decorative motion is frozen (deterministic).
  await page.evaluate(() => document.getElementById("splash")?.remove());

  for (const [star, name] of FRAMES) {
    const reached = await page.evaluate(buildToStar, star);
    expect(reached).toBe(star); // the real assertion — the rung was genuinely earned

    if (star === 6) await expect(page.locator("#modal")).toContainText("TOWER achieved");
    await page.evaluate(fitCamera);
    await page.waitForTimeout(300); // let the frame settle at the new zoom
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  }
});
