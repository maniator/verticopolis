import { test, expect, type Locator, type Page } from "@playwright/test";
import { buildToStar, expectEngineHosted } from "./helpers";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * Movable windows in the real browser: the Map, the facility card and the
 * dialogs move by their navy title bars, stay inside the tower view (or the
 * browser window), and go home on a double-click. The Map keeps its spot
 * across a reload; the card stops following its room once moved; a dialog
 * opens centered again.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game));
  await page.evaluate(() => document.getElementById("splash")?.remove());
  await page.evaluate(buildToStar, 2);
  await page.evaluate(() => (window as any).game.engine.setCamera((window as any).game.grid.width / 2, 6, 1));
}

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return b;
}

/** Press the title bar's left part (clear of its close button) and drag by (dx, dy). */
async function dragTitle(page: Page, title: Locator, dx: number, dy: number): Promise<void> {
  const t = await box(title);
  const x = t.x + 12;
  const y = t.y + t.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

/** A real one-finger touch drag (Chrome's own touch input, so the browser
 *  makes the pointer events and their capture). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = (p: { x: number; y: number }) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from) });
  for (let i = 1; i <= 6; i++) {
    const at = { x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(at) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Wait two animation frames, so the per-frame panel anchoring runs. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

const MAP = "#overview-map";
const MAP_TITLE = "#overview-map > .win-title";

test.describe("movable windows", () => {
  test.use({ viewport: DESKTOP });

  test("the Map moves by its title bar, stays in the tower view, keeps its spot and goes home on a double-click", async ({ page }) => {
    await boot(page);
    const map = page.locator(MAP);
    await expect(map).toBeVisible();
    const home = await box(map);
    await dragTitle(page, page.locator(MAP_TITLE), -300, -200);
    const moved = await box(map);
    expect(moved.x).toBeCloseTo(home.x - 300, 0);
    expect(moved.y).toBeCloseTo(home.y - 200, 0);

    // A drag far past the stage's corner stops with the window whole inside.
    await dragTitle(page, page.locator(MAP_TITLE), -5000, -5000);
    const stage = await box(page.locator("#stage"));
    const corner = await box(map);
    expect(corner.x).toBeCloseTo(stage.x, 0);
    expect(corner.y).toBeCloseTo(stage.y, 0);

    // The spot survives a reload.
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).game));
    await page.evaluate(() => document.getElementById("splash")?.remove());
    await expect(map).toBeVisible();
    const restored = await box(map);
    expect(restored.x).toBeCloseTo(corner.x, 0);
    expect(restored.y).toBeCloseTo(corner.y, 0);

    // A double-click on the title bar puts it back in its corner and forgets the spot.
    const t = await box(page.locator(MAP_TITLE));
    await page.mouse.dblclick(t.x + 12, t.y + t.height / 2);
    const back = await box(map);
    expect(back.x).toBeCloseTo(home.x, 0);
    expect(back.y).toBeCloseTo(home.y, 0);
    expect(await page.evaluate(() => localStorage.getItem("vc-map-spot-desktop"))).toBeNull();
  });

  test("a press on the Map's close button closes it and moves nothing", async ({ page }) => {
    await boot(page);
    const home = await box(page.locator(MAP));
    await page.locator("#overview-map .overview-map-close").click();
    await expect(page.locator(MAP)).toBeHidden();
    await page.locator("#btn-map").click();
    const reopened = await box(page.locator(MAP));
    expect(reopened.x).toBeCloseTo(home.x, 0);
    expect(reopened.y).toBeCloseTo(home.y, 0);
  });

  test("the facility card stays where it is dragged while the camera moves, and follows its room again once closed", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const g = (window as any).game;
      const unit = g.sim.tower.units.find((u: { kind: string }) => u.kind === "office");
      g.selectPicked({ type: "unit", id: unit.id, kind: unit.kind });
    });
    const editor = page.locator("#editor");
    await expect(editor).not.toHaveClass(/hidden/);
    await nextFrames(page);
    const before = await box(editor);
    await dragTitle(page, page.locator("#editor > .win-title"), 120, -60);
    const moved = await box(editor);
    expect(moved.x).toBeCloseTo(before.x + 120, 0);
    expect(moved.y).toBeCloseTo(before.y - 60, 0);

    // The camera moves; the card does not.
    await page.evaluate(() => (window as any).game.engine.setCamera((window as any).game.grid.width / 2 + 10, 9, 1));
    await nextFrames(page);
    const after = await box(editor);
    expect(after.x).toBeCloseTo(moved.x, 0);
    expect(after.y).toBeCloseTo(moved.y, 0);

    // Closed and reopened, the card anchors beside its room again.
    await page.locator("#editor .ed-close").click();
    await expect(editor).toHaveClass(/hidden/);
    await page.evaluate(() => (window as any).game.engine.setCamera((window as any).game.grid.width / 2, 6, 1));
    await page.evaluate(() => {
      const g = (window as any).game;
      const unit = g.sim.tower.units.find((u: { kind: string }) => u.kind === "office");
      g.selectPicked({ type: "unit", id: unit.id, kind: unit.kind });
    });
    await nextFrames(page);
    const anchored = await box(editor);
    expect(anchored.x).toBeCloseTo(before.x, 0);
    expect(anchored.y).toBeCloseTo(before.y, 0);
  });

  test("a dialog moves by its title bar, stays in the browser window, and opens centered again", async ({ page }) => {
    await boot(page);
    await page.locator("#btn-stats").click();
    const dialog = page.locator("#modal");
    await expect(dialog).toBeVisible();
    const centered = await box(dialog);
    await dragTitle(page, page.locator("#modal > .modal-box > .win-title"), 2000, 2000);
    const moved = await box(dialog);
    expect(moved.x + moved.width).toBeCloseTo(DESKTOP.width, 0);
    expect(moved.y + moved.height).toBeCloseTo(DESKTOP.height, 0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.locator("#btn-stats").click();
    const reopened = await box(dialog);
    expect(reopened.x).toBeCloseTo(centered.x, 0);
    expect(reopened.y).toBeCloseTo(centered.y, 0);
  });
});

test.describe("movable windows on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("a touch drag on the Map card's title bar moves it", async ({ page }) => {
    await boot(page);
    if (await page.locator(MAP).isHidden()) await page.locator("#btn-map").tap();
    const map = page.locator(MAP);
    const home = await box(map);
    const t = await box(page.locator(MAP_TITLE));
    const from = { x: t.x + 12, y: t.y + t.height / 2 };
    await touchDrag(page, from, { x: from.x + 80, y: from.y + 120 });
    const moved = await box(map);
    expect(moved.x).toBeCloseTo(home.x + 80, 0);
    expect(moved.y).toBeCloseTo(home.y + 120, 0);
  });

  test("a touch drag on the docked facility card's title bar moves it, and it docks again once closed", async ({ page }) => {
    await boot(page);
    const open = () =>
      page.evaluate(() => {
        const g = (window as any).game;
        const unit = g.sim.tower.units.find((u: { kind: string }) => u.kind === "office");
        g.selectPicked({ type: "unit", id: unit.id, kind: unit.kind });
      });
    await open();
    const editor = page.locator("#editor");
    await expect(editor).not.toHaveClass(/hidden/);
    await nextFrames(page);
    const docked = await box(editor);
    const t = await box(page.locator("#editor > .win-title"));
    const from = { x: t.x + 12, y: t.y + t.height / 2 };
    // Frames pass between the press and the first move, as on a real phone:
    // the docked layout must not take the card back while the finger is down.
    await touchDrag(page, from, { x: from.x + 60, y: from.y - 100 });
    await nextFrames(page);
    const moved = await box(editor);
    expect(moved.x).toBeCloseTo(docked.x + 60, 0);
    expect(moved.y).toBeCloseTo(docked.y - 100, 0);

    await page.locator("#editor .ed-close").tap();
    await expect(editor).toHaveClass(/hidden/);
    await open();
    await nextFrames(page);
    const again = await box(editor);
    expect(again.x).toBeCloseTo(docked.x, 0);
    expect(again.y).toBeCloseTo(docked.y, 0);
  });
});
