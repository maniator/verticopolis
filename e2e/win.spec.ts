import { test, expect } from "@playwright/test";
import { buildToStar } from "./helpers";

/**
 * Tier-2 end-to-end smoke: prove the TOWER win actually SURFACES to a real
 * player in the browser — the congratulations modal — which the headless
 * playthrough cannot check (it has no DOM). `buildToStar(6)` reproduces a
 * winning state through the app's public sim API and runs the REAL win logic
 * (`sim.checkVip`); we then assert the game's own update loop opens the modal.
 */
test("winning the TOWER shows the congratulations modal", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game));

  // Dismiss the title screen first, the way a real player does before playing:
  // the update loop deliberately holds back auto-surfaced modals (this congrats
  // included) while the splash is up, so nothing pops over the title screen.
  await page.evaluate(() => document.getElementById("splash")?.remove());

  const star = await page.evaluate(buildToStar, 6);
  expect(star).toBe(6); // the real win logic reached TOWER

  const modal = page.locator("#modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("TOWER achieved");
});
