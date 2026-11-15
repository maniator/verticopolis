import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * The Win95 menu bar that replaced the right sidebar, in a real browser: the
 * menus open by mouse and keyboard, Tower Info and Bulletin open from the
 * Window menu and remember it across a reload, the status bar names the tower,
 * the phone keeps a logo on the menu bar, and Full Screen fills the screen.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game));
  await page.evaluate(() => {
    document.getElementById("splash")?.remove();
    document.getElementById("onboard")?.remove();
  });
}

test.describe("the menu bar on a desktop", () => {
  test.use({ viewport: DESKTOP });

  test("the sidebar is gone, and the menu bar and status bar frame the tower", async ({ page }) => {
    await boot(page);
    await expect(page.locator("#sidebar")).toHaveCount(0);
    await expect(page.locator("#menubar")).toBeVisible();
    await expect(page.locator("#statusbar")).toBeVisible();
    await expect(page.locator("#sb-tower")).toHaveText(/ · (Classic|Modern)$/);
    // The stage reaches the window's right edge, less the app frame.
    const stage = await page.locator("#stage").boundingBox();
    expect(stage!.x + stage!.width).toBeGreaterThan(DESKTOP.width - 24);
  });

  test("a click opens a menu, pointing switches menus, and a pick closes it", async ({ page }) => {
    await boot(page);
    await page.locator("#mb-file").click();
    await expect(page.locator("#mb-file-menu")).toBeVisible();
    await page.locator("#mb-tower").hover();
    await expect(page.locator("#mb-file-menu")).toBeHidden();
    await expect(page.locator("#mb-tower-menu")).toBeVisible();
    await page.locator("#btn-stats").click();
    await expect(page.locator("#mb-tower-menu")).toBeHidden();
    await expect(page.locator("#modal")).toBeVisible();
  });

  test("the keyboard walks the menus: Alt+letter, arrows and Escape", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Alt+h");
    await expect(page.locator("#mb-help-menu")).toBeVisible();
    await expect(page.locator("#btn-help")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#mb-options-menu")).toBeVisible();
    await expect(page.locator("#btn-settings")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#mb-options-menu")).toBeHidden();
    await expect(page.locator("#mb-options")).toBeFocused();
  });

  test("Tower Info opens from the Tower menu, the Bulletin starts open, and both stay as left across a reload", async ({ page }) => {
    await boot(page);
    await expect(page.locator("#tower-win")).toBeHidden();
    await expect(page.locator("#bulletin-win #log")).toBeVisible();
    await page.locator("#mb-tower").click();
    await expect(page.locator("#mb-win-tower")).toHaveAttribute("aria-checked", "false");
    await page.locator("#mb-win-tower").click();
    await expect(page.locator("#tower-win")).toBeVisible();
    await expect(page.locator("#tower-stats")).toContainText("Floors");
    await page.locator("#mb-tower").click();
    await expect(page.locator("#mb-win-tower")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await page.locator("#mb-window").click();
    await expect(page.locator("#mb-win-bulletin")).toHaveAttribute("aria-checked", "true");
    await page.locator("#mb-win-bulletin").click();
    await expect(page.locator("#bulletin-win")).toBeHidden();
    await boot(page);
    await expect(page.locator("#tower-win")).toBeVisible();
    await expect(page.locator("#bulletin-win")).toBeHidden();
    await page.locator('#tower-win [data-close="tower-win"]').click();
    await expect(page.locator("#tower-win")).toBeHidden();
  });

  test("Rename opens Tower Info with the name selected", async ({ page }) => {
    await boot(page);
    await page.locator("#mb-tower").click();
    await page.locator("#mb-rename").click();
    await expect(page.locator("#tower-name")).toBeFocused();
  });

  test("the status bar hides from the Window menu", async ({ page }) => {
    await boot(page);
    await page.locator("#mb-window").click();
    await page.locator("#mb-win-statusbar").click();
    await expect(page.locator("#statusbar")).toBeHidden();
  });

  test("Full Screen fills the screen and leaves it again", async ({ page }) => {
    await boot(page);
    await page.locator("#mb-window").click();
    await page.locator("#mb-fullscreen").click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.locator("#mb-window").click();
    await expect(page.locator("#mb-fullscreen")).toHaveAttribute("aria-checked", "true");
    await page.locator("#mb-fullscreen").click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  });

  test("File > Close saves the tower, shows the title screen, and Continue brings it back paused", async ({ page }) => {
    await boot(page);
    const name = await page.evaluate(() => (window as any).game.enginePort.towerName() as string);
    await page.locator("#mb-file").click();
    await page.locator("#mb-close").click();
    await expect(page.locator("#splash")).toBeVisible();
    await expect(page.locator('#splash [data-splash="continue"]')).toBeFocused();
    // Close is grayed on the title screen.
    await page.locator("#mb-file").click();
    await expect(page.locator("#mb-close")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await page.locator('#splash [data-splash="continue"]').click();
    await expect(page.locator("#splash")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).game.speed)).toBe(0);
    expect(await page.evaluate(() => (window as any).game.enginePort.towerName())).toBe(name);
  });
});

test.describe("the menu bar on a phone", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("keeps a logo, fits on one row, and drops the status bar", async ({ page }) => {
    await boot(page);
    await expect(page.locator(".menubar-brand")).toBeVisible();
    await expect(page.locator("#topbar .brand")).toBeHidden();
    await expect(page.locator("#statusbar")).toBeHidden();
    const bar = await page.locator("#menubar").boundingBox();
    const help = await page.locator("#mb-help").boundingBox();
    expect(help!.x + help!.width).toBeLessThanOrEqual(PHONE.width);
    expect(help!.y).toBeLessThan(bar!.y + bar!.height);
  });

  test("Help opens on screen and Tower Info sits clear of Bulletin", async ({ page }) => {
    await boot(page);
    await page.locator("#mb-help").tap();
    const menu = await page.locator("#mb-help-menu").boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(PHONE.width);
    await page.locator("#mb-help").tap();
    for (const [menu, item] of [
      ["#mb-tower", "#mb-win-tower"],
      ["#mb-window", "#mb-win-bulletin"],
    ]) {
      await page.locator(menu).tap();
      await page.locator(item).tap();
    }
    const tower = (await page.locator("#tower-win").boundingBox())!;
    const news = (await page.locator("#bulletin-win").boundingBox())!;
    expect(news.x + news.width).toBeLessThanOrEqual(tower.x);
  });
});
