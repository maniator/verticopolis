import { test, expect, type Locator, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

/**
 * The 1994 desk in a real browser: a computer gets the tower, Info, Tools,
 * the Map and the Bulletin as windows on a teal desk with a taskbar. Windows
 * minimize to the taskbar and come back from it, the tower maximizes and
 * resizes, the Control Panel opens from the tray, a phone or a touch screen
 * never gets it, and `?desk=on` brings it to a smaller screen (there is no
 * player switch; `?desk=off` is for testing).
 * The other specs turn the desk off through the config's storageState; this
 * one clears that.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

test.use({ storageState: { cookies: [], origins: [] } });

// Every test that reaches a tower must end with it still on the engine.
test.afterEach(async ({ page }) => {
  if (await page.evaluate(() => !document.getElementById("splash"))) await expectEngineHosted(page);
});

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return b;
}

/** Load the game and wait for its handle, leaving the title screen up. */
async function load(page: Page, url = "/"): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => Boolean((window as any).game));
  await expect(page.locator("#boot-cover")).toHaveCount(0);
}

/** Leave the title screen the way a player does, from its first button. */
async function enterTower(page: Page): Promise<void> {
  await page.locator('#splash [data-splash="continue"], #splash [data-splash="new"]').first().click();
  // A first visit founds a tower: take the rule-set the dialog offers.
  const found = page.locator('[data-act="found"]');
  if (await found.isVisible().catch(() => false)) await found.click();
  await page.evaluate(() => document.getElementById("onboard")?.remove());
  await expect(page.locator("#splash")).toHaveCount(0);
}

/** Click the center of `locator` with the mouse. */
async function press(page: Page, locator: Locator): Promise<void> {
  const b = await box(locator);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/** Drag from a point near the left of `locator` by (dx, dy). */
async function drag(page: Page, locator: Locator, dx: number, dy: number): Promise<void> {
  const b = await box(locator);
  const x = b.x + Math.min(30, b.width / 2);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

const body = (page: Page) => page.locator("body");
const task = (page: Page, id: string) => page.locator(`.desk-task[data-win="${id}"]`);

test.describe("the desk on a computer", () => {
  test.use({ viewport: DESKTOP });

  test("the title screen sits in its own window, and entering a tower opens the desk", async ({ page }) => {
    await load(page);
    await expect(body(page)).toHaveClass(/\bdesk-title\b/);
    await expect(page.locator(".desk-title-bar")).toBeVisible();
    await expect(page.locator(".desk-taskbar-title")).toBeVisible();
    // The title screen's taskbar has no Control Panel.
    await expect(page.locator(".desk-taskbar-title .desk-tray-display")).toHaveCount(0);
    await enterTower(page);
    await expect(body(page)).toHaveClass(/\bdesk\b/);
    await expect(body(page)).not.toHaveClass(/\bdesk-title\b/);
    for (const id of ["#desk-win-tower", "#desk-win-info", "#overview-map", "#bulletin-win"]) await expect(page.locator(id)).toBeVisible();
    for (const id of ["tower", "info", "tools", "map", "bulletin"]) await expect(task(page, id)).toHaveCount(1);
  });

  test("a window minimizes to the taskbar and comes back from it", async ({ page }) => {
    await load(page);
    await enterTower(page);
    const map = page.locator("#overview-map");
    await press(page, page.locator("#overview-map .desk-btn-min"));
    await expect(map).toBeHidden();
    await expect(task(page, "map")).toHaveAttribute("aria-pressed", "false");
    await press(page, task(page, "map"));
    await expect(map).toBeVisible();
    await expect(task(page, "map")).toHaveAttribute("aria-pressed", "true");
    // The front window's own button minimizes it.
    await press(page, task(page, "map"));
    await expect(map).toBeHidden();
  });

  test("the tower maximizes and restores, and its grip makes it smaller", async ({ page }) => {
    await load(page);
    await enterTower(page);
    const tower = page.locator("#desk-win-tower");
    const home = await box(tower);
    await press(page, page.locator("#desk-win-tower .desk-btn-max"));
    const full = await box(tower);
    expect(full.width).toBeGreaterThan(home.width);
    expect(full.height).toBeGreaterThan(home.height);
    await press(page, page.locator("#desk-win-tower .desk-btn-max"));
    await expect.poll(async () => Math.round((await box(tower)).width)).toBe(Math.round(home.width));
    await drag(page, page.locator("#desk-win-tower > .desk-grip"), -200, -120);
    const smaller = await box(tower);
    expect(smaller.width).toBeLessThan(home.width - 150);
    expect(smaller.height).toBeLessThan(home.height - 80);
  });

  test("a moved window keeps its place across a reload", async ({ page }) => {
    await load(page);
    await enterTower(page);
    const bulletin = page.locator("#bulletin-win");
    const before = await box(bulletin);
    await drag(page, page.locator("#bulletin-win > .win-title"), -400, 40);
    const moved = await box(bulletin);
    expect(moved.x).toBeLessThan(before.x - 350);
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).game));
    await enterTower(page);
    const after = await box(bulletin);
    expect(after.x).toBeCloseTo(moved.x, 0);
    expect(after.y).toBeCloseTo(moved.y, 0);
  });

  test("the Verticopolis menu opens, moves by arrow keys and closes on Escape", async ({ page }) => {
    await load(page);
    await enterTower(page);
    const menu = page.locator("#desk-start-menu");
    await press(page, page.locator(".desk-start"));
    await expect(menu).toBeVisible();
    await expect(menu.locator(".mb-item").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator(".mb-item").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.locator(".desk-start")).toBeFocused();
  });

  test("no window is ever lost: Info and Tools never close, and the Window menu brings back a closed or minimized one", async ({ page }) => {
    await load(page);
    await enterTower(page);
    await expect(page.locator("#desk-win-info .desk-btn-close")).toHaveCount(0);
    await expect(page.locator("#palette .desk-btn-close")).toHaveCount(0);
    await press(page, page.locator("#overview-map .overview-map-close"));
    await expect(page.locator("#overview-map")).toBeHidden();
    await press(page, page.locator("#desk-win-info .desk-btn-min"));
    await press(page, page.locator("#palette .desk-btn-min"));
    await expect(page.locator("#desk-win-info")).toBeHidden();
    await expect(page.locator("#palette")).toBeHidden();
    for (const [item, win] of [["#mb-dw-map", "#overview-map"], ["#mb-dw-info", "#desk-win-info"], ["#mb-dw-tools", "#palette"]]) {
      await press(page, page.locator("#mb-window"));
      await press(page, page.locator(item));
      await expect(page.locator(win)).toBeVisible();
    }
  });

  test("a right-click on a taskbar button opens the window menu, and its Minimize sends the window down", async ({ page }) => {
    await load(page);
    await enterTower(page);
    const b = await box(task(page, "map"));
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" });
    const menu = page.locator(".desk-win-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-command="maximize"]')).toBeDisabled();
    await press(page, menu.locator('[data-command="minimize"]'));
    await expect(menu).toBeHidden();
    await expect(page.locator("#overview-map")).toBeHidden();
  });

  test("the Control Panel opens from the tray, with no Desktop switch, and Options has none either", async ({ page }) => {
    await load(page);
    await enterTower(page);
    await press(page, page.locator(".desk-tray-display"));
    const panel = page.locator("#desk-win-control");
    await expect(panel).toBeVisible();
    await expect(task(page, "control")).toHaveCount(1);
    await expect(panel.locator(".desk-control-icon")).toHaveCount(4);
    await expect(page.locator("#mb-desk")).toHaveCount(0);
  });
});

test.describe("the desk on a computer-sized touch screen", () => {
  test.use({ viewport: DESKTOP, hasTouch: true });

  test("a big screen whose main input is touch keeps its own layout", async ({ page }) => {
    await load(page);
    await expect(body(page)).toHaveClass(/\bsplash-up\b/);
    await expect(body(page)).not.toHaveClass(/\bdesk-title\b/);
  });
});

test.describe("the desk on other screens", () => {
  test("a phone never gets the desk", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await load(page);
    await expect(body(page)).not.toHaveClass(/\bdesk-title\b/);
    await enterTower(page);
    await expect(body(page)).not.toHaveClass(/\bdesk\b/);
    await expect(page.locator("#desk-taskbar")).toHaveCount(0);
  });

  test("?desk=on brings the desk to a screen narrower than a computer's, and ?desk=off turns it off", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await load(page);
    await enterTower(page);
    await expect(body(page)).not.toHaveClass(/\bdesk\b/);
    await load(page, "/?desk=on");
    await enterTower(page);
    await expect(body(page)).toHaveClass(/\bdesk\b/);
    expect(await page.evaluate(() => localStorage.getItem("vc-desk"))).toBe("any");
    await load(page, "/?desk=off");
    await enterTower(page);
    await expect(body(page)).not.toHaveClass(/\bdesk\b/);
    expect(await page.evaluate(() => localStorage.getItem("vc-desk"))).toBe("off");
  });

  test("a smaller browser window pulls the windows back onto the desk", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await load(page);
    await enterTower(page);
    await drag(page, page.locator("#bulletin-win > .win-title"), 2000, 0);
    await page.setViewportSize({ width: 1100, height: 700 });
    await expect.poll(async () => {
      const b = await box(page.locator("#bulletin-win"));
      return b.x + b.width <= 1100;
    }).toBe(true);
    const tower = await box(page.locator("#desk-win-tower"));
    expect(tower.x + tower.width).toBeLessThanOrEqual(1100);
  });

  test("the desk leaves when the window gets too small, and comes back with every window", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await load(page);
    await enterTower(page);
    await expect(body(page)).toHaveClass(/\bdesk\b/);
    await page.setViewportSize({ width: 800, height: 700 });
    await expect(body(page)).not.toHaveClass(/\bdesk\b/);
    await expect(page.locator("#stage")).toBeVisible();
    await page.setViewportSize(DESKTOP);
    await expect(body(page)).toHaveClass(/\bdesk\b/);
    await expect(page.locator("#desk-win-tower")).toBeVisible();
  });
});
