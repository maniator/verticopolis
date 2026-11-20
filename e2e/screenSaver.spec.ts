import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * Options > Screen Saver… in a real browser: the dialog plays the picked
 * saver on its little monitor, Preview puts it up full screen with the tower
 * paused, a key brings the tower back at its speed and the dialog with it,
 * and OK keeps the choice across a reload. The idle and return triggers never
 * fire under automation, so Preview is the way in here.
 */

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.game));
  await page.evaluate(() => {
    document.getElementById("splash")?.remove();
    document.getElementById("onboard")?.remove();
  });
}

async function openDialog(page: Page): Promise<void> {
  await page.locator("#mb-options").click();
  await page.locator("#mb-screensaver").click();
  await expect(page.locator(".saver-screen")).toBeVisible();
}

test.use({ viewport: { width: 1280, height: 800 } });

test("Preview pauses the tower, a key brings it back at its speed, and OK keeps the choice", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.game.setSpeed(1));
  await openDialog(page);
  await expect(page.locator("#saver-pick")).toHaveValue("night");
  await page.locator("#saver-pick").selectOption("express");
  await page.locator('[data-saver="preview"]').click();
  await expect(page.locator("#screensaver")).toBeVisible();
  await expect(page.locator("#screensaver .screensaver-hint")).toContainText("Press any key");
  await expect.poll(() => page.evaluate(() => window.game.speed)).toBe(0);
  // Past the grace time, a key ends it, and the dialog comes back with the
  // unsaved pick.
  await page.waitForTimeout(500);
  await page.keyboard.press("a");
  await expect(page.locator("#screensaver")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.game.speed)).toBe(1);
  await expect(page.locator("#saver-pick")).toHaveValue("express");
  await page.locator('[data-saver="ok"]').click();
  await page.reload();
  await boot(page);
  await openDialog(page);
  await expect(page.locator("#saver-pick")).toHaveValue("express");
  await page.locator('[data-saver="cancel"]').click();
});

test("(None) grays Preview and Wait", async ({ page }) => {
  await boot(page);
  await openDialog(page);
  await page.locator("#saver-pick").selectOption("none");
  await expect(page.locator('[data-saver="preview"]')).toBeDisabled();
  await expect(page.locator("#saver-wait")).toBeDisabled();
  await page.keyboard.press("Escape");
});
