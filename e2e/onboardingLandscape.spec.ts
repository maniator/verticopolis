import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

/**
 * The Getting Started card on a phone held sideways, in a real browser. On
 * split-screen sizes the top bar wraps to several lines, and the card sits
 * below it so the last stat row stays visible. With the Map open, the card
 * moves beside the Map card and stays readable (at least 200px wide) and on
 * screen.
 */

test.afterEach(async ({ page }) => expectEngineHosted(page));

type Box = { left: number; top: number; right: number; bottom: number };

async function cardUp(page: Page, vp: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(vp);
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    const g = (window as any).game;
    g.onboarding.dismissSplash();
    g.replayOnboarding();
  });
  await expect(page.locator("#onboard.onboard--mobile")).toBeVisible();
}

const box = (page: Page, selector: string): Promise<Box> =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });

for (const vp of [
  { width: 700, height: 330 },
  { width: 520, height: 300 },
]) {
  test(`on a split screen (${vp.width}x${vp.height}) the card sits below the wrapped top bar`, async ({ page }) => {
    await cardUp(page, vp);
    const bar = await box(page, "#topbar");
    expect(bar.bottom, "the top bar must wrap here for this test to mean anything").toBeGreaterThan(90);
    expect((await box(page, "#onboard")).top).toBeGreaterThanOrEqual(bar.bottom);
  });
}

for (const vp of [
  { width: 852, height: 352 },
  { width: 600, height: 352 },
  { width: 520, height: 300 },
]) {
  test(`with the Map open (${vp.width}x${vp.height}) the card sits beside it, readable and on screen`, async ({
    page,
  }) => {
    await cardUp(page, vp);
    await page.click("#btn-map");
    await expect(page.locator("#overview-map")).toBeVisible();
    const card = await box(page, "#onboard");
    const map = await box(page, "#overview-map");
    expect(card.left).toBeGreaterThanOrEqual(map.right - 1); // a subpixel edge at most
    expect(card.right - card.left).toBeGreaterThanOrEqual(200);
    expect(card.right).toBeLessThanOrEqual(vp.width);
  });
}
