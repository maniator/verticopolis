/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { buildToStar } from "./helpers";

/**
 * Building while paused (#1936). The boot tower is Classic, whose catalog says
 * it does not build while paused: a click with a build tool at speed 0 places
 * nothing, says "Unpause to build." and points at Play. Once the clock runs,
 * the same click places the room.
 */

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game));
  await page.evaluate(() => document.getElementById("splash")?.remove());
  await page.evaluate(buildToStar, 3);
}

/** Where a click lands on bare floor 4, left of the offices buildToStar lays. */
async function bareFloorSpot(page: Page): Promise<{ x: number; y: number }> {
  await page.evaluate(() => (window as any).game.engine.setCamera(20, 4, 1));
  // Let the renderer draw the new view before the click lands on it.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const e = (window as any).game.engine;
    const r = (document.getElementById("view") as HTMLCanvasElement).getBoundingClientRect();
    const floorPx = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
    return { x: r.left + e.worldToScreenX(20), y: r.top + e.worldToScreenY(4) + floorPx / 2 };
  });
}

const units = (page: Page) => page.evaluate(() => (window as any).game.sim.tower.units.length as number);

test("Classic refuses a build while paused, says why, and builds once the clock runs", async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => (window as any).game.reader.header.mode)).toBe("classic");
  await page.evaluate(() => (window as any).game.setSpeed(0));
  await page.click('.pal-item[data-kind="office"]');
  const at = await bareFloorSpot(page);
  const before = await units(page);

  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#toast-wrap .toast.bad", { hasText: "Unpause to build." })).toBeVisible();
  await expect(page.locator('#speed button[data-speed="1"]')).toHaveClass(/play-nudge/);
  expect(await units(page), "the paused click placed nothing").toBe(before);

  await page.evaluate(() => (window as any).game.setSpeed(1));
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => units(page)).toBeGreaterThan(before);
});
