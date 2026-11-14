import { test, expect, type Page } from "@playwright/test";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildToStar, dispatchTouch, expectEngineHosted } from "./helpers";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/** A tower with a shaft and someone out walking, the clock stopped so they
 *  hold still, and the camera on them. Answers their id. */
async function towerWithAWalker(page: Page): Promise<number> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game?.sim && (window as any).game?.ui));
  await page.evaluate(buildToStar, 2);
  return page.evaluate(() => {
    const g = (window as any).game;
    document.getElementById("splash")?.remove();
    if (!g.sim.buildTransport("elevatorStandard", 186, 1, 3).ok) throw new Error("shaft placement failed");
    // The fixture freezes the clock, so run it a minute at a time on the
    // engine until someone the render draws is out walking.
    const walker = () => (g.reader.update(), g.engine.sim.crowd.people.find((p: any) => p.state !== "riding"));
    for (let minute = 0; minute < 24 * 60 && !walker(); minute++) g.sim.tick(1);
    const p = walker();
    if (!p) throw new Error("no one walked the tower in a day");
    g.engine.setCamera(p.x, p.fy, 2);
    return p.id as number;
  });
}

/** The point over person `id`'s figure, on the page and on the canvas
 *  (`dispatchTouch` takes canvas points). */
async function figurePoint(page: Page, id: number): Promise<{ x: number; y: number; canvas: { x: number; y: number } }> {
  return page.evaluate((who) => {
    const e = (window as any).game.engine;
    const rec = e.crowdActors.get(who);
    if (!rec) throw new Error(`person ${who} is not drawn`);
    const s = e.engine.worldToScreenCoordinates(rec.actor.pos);
    const box = (document.getElementById("view") as HTMLCanvasElement).getBoundingClientRect();
    // The actor's spot is the figure's feet; aim a little above them.
    const canvas = { x: s.x, y: s.y - 4 * e.cam.zoom };
    return { x: box.left + canvas.x, y: box.top + canvas.y, canvas };
  }, id);
}

test("a click with Inspect opens a walking person's card, and Follow keeps the camera on them (#2092)", async ({ page }) => {
  const id = await towerWithAWalker(page);
  await page.waitForTimeout(300); // a frame draws the figure where the camera now is
  await page.click('.pal-item[data-tool="inspect"]');
  const at = await figurePoint(page, id);
  await page.mouse.click(at.x, at.y);

  const editor = page.locator("#editor");
  await expect(editor).not.toHaveClass(/hidden/);
  // The figure under the pointer, or one overlapping it: someone the view draws.
  const open = await page.evaluate(() => (window as any).game.personCard.openId);
  expect(open).not.toBeNull();
  for (const field of ["why", "from", "to", "now", "waited", "mood"]) {
    await expect(editor.locator(`[data-field="${field}"]`)).not.toHaveText("");
  }
  // The engine's own answer fills the card: the "now" row says what they do.
  await expect(editor.locator('[data-field="now"]')).not.toHaveText("Left the tower");

  // Look away first, so the follow has to find them off screen.
  await page.evaluate(() => (window as any).game.engine.setCamera(20, 20, 2));
  const follow = editor.getByRole("button", { name: "Follow" });
  await follow.click();
  await expect(editor.getByRole("button", { name: "Stop following" })).toBeVisible();

  // The follow brings the camera back: the person is on screen again, and
  // still followed. (The lot's edges can keep them off center.)
  const onScreen = () =>
    page.evaluate((who) => {
      const e = (window as any).game.engine;
      const rec = e.crowdActors.get(who);
      const s = rec && e.engine.worldToScreenCoordinates(rec.actor.pos);
      const box = (document.getElementById("view") as HTMLCanvasElement).getBoundingClientRect();
      const inside = !!s && s.x >= 0 && s.x <= box.width && s.y >= 0 && s.y <= box.height;
      // The spot and the view size ride along, so a failure says where they were.
      return { onScreen: inside, at: s && { x: s.x, y: s.y }, view: { w: box.width, h: box.height } };
    }, open);
  await expect.poll(onScreen).toMatchObject({ onScreen: true });
  await expect(editor.getByRole("button", { name: "Stop following" })).toBeVisible();

  // With the clock running and the person moving, the follow holds.
  await page.evaluate(() => (window as any).game.setSpeed(1));
  await page.waitForTimeout(2000);
  await expect(editor.getByRole("button", { name: "Stop following" })).toBeVisible();
  await page.evaluate(() => (window as any).game.setSpeed(0));

  // Moving the camera by any other means hands it back to the player.
  await page.evaluate(() => (window as any).game.engine.setCamera(20, 20, 2));
  await expect(editor.getByRole("button", { name: "Follow", exact: true })).toBeVisible();

  // The ✕ lets them go: the card closes and the follow ends with it.
  await editor.locator(".ed-close").click();
  await expect(editor).toHaveClass(/hidden/);
  await expect.poll(() => page.evaluate(() => (window as any).game.personCard.openId)).toBeNull();
});

test("a tap with Inspect on a phone opens the person's card (#2092)", async ({ page }) => {
  const id = await towerWithAWalker(page);
  await page.click('.pal-item[data-tool="inspect"]');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate((who) => {
    const g = (window as any).game;
    const p = g.engine.sim.crowd.people.find((q: any) => q.id === who);
    g.engine.setCamera(p.x, p.fy, 2);
  }, id);
  await page.waitForTimeout(300);
  const at = await figurePoint(page, id);
  // A touch whose pointer is not the page's primary one, as on a real phone
  // after a pinch.
  await dispatchTouch(page, "pointerdown", 8101, at.canvas.x, at.canvas.y);
  await dispatchTouch(page, "pointerup", 8101, at.canvas.x, at.canvas.y);
  const editor = page.locator("#editor");
  await expect(editor).not.toHaveClass(/hidden/);
  await expect(editor.locator('[data-field="why"]')).not.toHaveText("");
  expect(await page.evaluate(() => (window as any).game.personCard.openId)).not.toBeNull();
});
