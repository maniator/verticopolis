import { test, expect, type Page } from "@playwright/test";
import { buildToStar, dispatchTouch, expectEngineHosted } from "./helpers";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * The overview MAP window (#343) in the real browser: the camera binding
 * (CAP-3), the keys, focus and layout checks (CAP-5), the defaults (CAP-1),
 * and that the world behind it builds, inspects, pans and pinches the same
 * with the map open.
 * The window is built only behind the `?map` preview flag until S5, so every
 * page here opens with it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

/** Boot the page with the map flag, drop the title screen and grow a 3-star
 *  tower (paused), so the map has rooms to draw and the camera room to move. */
async function boot(page: Page): Promise<void> {
  await page.goto("/?map");
  await page.waitForFunction(() => Boolean((window as any).game));
  await page.evaluate(() => document.getElementById("splash")?.remove());
  await page.evaluate(buildToStar, 3);
  await page.evaluate(() => (window as any).game.engine.setCamera((window as any).game.grid.width / 2, 6, 1));
}

/** The camera's center, in tiles and floors. */
async function camera(page: Page): Promise<{ tile: number; floor: number }> {
  return page.evaluate(() => {
    const v = (window as any).game.engine.viewState();
    return { tile: v.tile, floor: v.floor };
  });
}

/** Wait until the camera's floor passes `test`, for a move the frame loop applies. */
async function cameraFloorSettles(page: Page, test: (floor: number) => boolean): Promise<number> {
  let floor = NaN;
  await expect
    .poll(async () => {
      floor = (await camera(page)).floor;
      return test(floor);
    })
    .toBe(true);
  return floor;
}

/** Wait two animation frames, so a camera move the frame loop applies lands. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/** The camera's floor once a click on the map at `y` has moved it. */
async function floorAfterClickAt(page: Page, x: number, y: number): Promise<number> {
  const before = (await camera(page)).floor;
  await page.mouse.click(x, y);
  await cameraFloorSettles(page, (f) => Math.abs(f - before) > 0.5);
  await nextFrames(page);
  return (await camera(page)).floor;
}

/** The world canvas's pixel height of one floor at the current zoom. */
async function floorPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const e = (window as any).game.engine;
    return Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
  });
}

/** The map's view canvas box, in page coordinates. */
async function mapBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator("#overview-map .overview-map-view").boundingBox();
  if (!box) throw new Error("the map's view canvas has no box");
  return box;
}

test.describe("overview map on the desktop", () => {
  test.use({ viewport: DESKTOP });

  test("is built only with the preview flag, and opens by default", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).game));
    await expect(page.locator("#overview-map")).toHaveCount(0);
    await boot(page);
    await expect(page.locator("#overview-map")).toBeVisible();
    await expect(page.locator("#btn-map")).toBeHidden();
  });

  test("a click centers the camera where it lands, and a drag on the view mark pans", async ({ page }) => {
    await boot(page);
    const box = await mapBox(page);
    const x = box.x + box.width / 2;
    // Two clicks a known distance apart give the map's scale in px per floor
    // (a click centers the camera where it lands, higher on the map is higher
    // in the tower).
    const yHigh = box.y + box.height * 0.4;
    const yLow = box.y + box.height * 0.6;
    const high = await floorAfterClickAt(page, x, yHigh);
    const low = await floorAfterClickAt(page, x, yLow);
    expect(high).toBeGreaterThan(low);
    const pxPerFloor = (yLow - yHigh) / (high - low);
    // The view mark is now centered on yLow. Grab it 4 px below its center and
    // drag it 30 px up: the camera follows the pointer's travel, so it rises by
    // 30 px worth of floors. A mark that jumped to the pointer would land 4 px
    // short of that.
    const grab = yLow + 4;
    const travel = 30;
    await page.mouse.move(x, grab);
    await page.mouse.down();
    await page.mouse.move(x, grab - travel, { steps: 6 });
    await page.mouse.up();
    await cameraFloorSettles(page, (f) => f > low + 1);
    await nextFrames(page);
    const moved = ((await camera(page)).floor - low) * pxPerFloor;
    expect(Math.abs(moved - travel)).toBeLessThan(2);
    // A mouse press never takes keyboard focus off the world.
    expect(await page.evaluate(() => document.activeElement?.closest("#overview-map") ?? null)).toBeNull();
  });

  test("keys move the view while the map has focus, and Escape closes it", async ({ page }) => {
    await boot(page);
    await page.locator("#overview-map .overview-map-view").focus();
    const start = await camera(page);
    await page.keyboard.press("ArrowUp");
    await cameraFloorSettles(page, (f) => f > start.floor);
    await page.keyboard.press("End");
    const bottom = await cameraFloorSettles(page, (f) => f < start.floor);
    await page.keyboard.press("Home");
    await cameraFloorSettles(page, (f) => f > bottom + 5);
    await page.keyboard.press("Escape");
    await expect(page.locator("#overview-map")).toBeHidden();
    await expect(page.locator("#btn-map")).toBeFocused();
    // Enter on the focused button opens it again, with focus on the map.
    await page.keyboard.press("Enter");
    await expect(page.locator("#overview-map")).toBeVisible();
    await expect(page.locator("#overview-map .overview-map-view")).toBeFocused();
  });

  test("a focused map keeps the game's build keys out of the world", async ({ page }) => {
    await boot(page);
    await page.click('.pal-item[data-kind="office"]');
    const units = () => page.evaluate(() => (window as any).game.sim.tower.units.length);
    const cursor = () => page.evaluate(() => (window as any).game.keyboard.cursor());
    const before = await units();
    await page.locator("#overview-map .overview-map-view").focus();
    // The build cursor's move, commit and bulldoze keys.
    for (const key of ["d", "w", "Enter", "Enter", "x"]) await page.keyboard.press(key);
    await nextFrames(page);
    expect(await cursor()).toBeNull();
    expect(await units()).toBe(before);
    // With focus off the map, the same move key reaches the build cursor.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("d");
    await expect.poll(cursor).not.toBeNull();
  });

  test("the open map clears the sidebar, the palette and the heatmap control and legend", async ({ page }) => {
    // The smallest desktop layout (narrower is the phone layout) and 1280 by 720.
    for (const size of [
      { width: 768, height: 600 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(size);
      await boot(page);
      await expect(page.locator("#overview-map")).toBeVisible();
      const overlaps = await page.evaluate(() => {
        const map = document.getElementById("overview-map")!.getBoundingClientRect();
        const view = document.getElementById("view")!.getBoundingClientRect();
        // The heatmap legend is drawn on the world canvas at a fixed 12 px
        // inset, 150 by up to 62 px (towerOverlay.ts, drawHeatLegend).
        const legend = new DOMRect(view.left + 12, view.top + 12, 150, 62);
        const others: Record<string, DOMRect> = { legend };
        for (const id of ["sidebar", "palette", "overlay-mode"]) {
          const r = document.getElementById(id)?.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) others[id] = r;
        }
        const hit = (r: DOMRect) => r.right > map.left && r.left < map.right && r.bottom > map.top && r.top < map.bottom;
        return { checked: Object.keys(others), overlapping: Object.keys(others).filter((k) => hit(others[k])) };
      });
      expect(overlaps.checked, `${size.width}x${size.height}`).toEqual(expect.arrayContaining(["legend", "sidebar", "palette"]));
      expect(overlaps.overlapping, `${size.width}x${size.height}`).toEqual([]);
    }
  });

  test("a mouse drag on the world pans, and a click inspects, with the map open", async ({ page }) => {
    await boot(page);
    await expect(page.locator("#overview-map")).toBeVisible();
    const view = await page.locator("#view").boundingBox();
    if (!view) throw new Error("the world canvas has no box");
    // The Inspect tool is the default: a drag on the world pans it.
    const start = await camera(page);
    const px = await floorPx(page);
    const cx = view.x + view.width / 2;
    const cy = view.y + view.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + px * 4, { steps: 8 });
    await page.mouse.up();
    await cameraFloorSettles(page, (f) => f > start.floor + 2);
    // A click on an office opens its editor.
    await page.evaluate(() => (window as any).game.engine.setCamera((window as any).game.grid.width / 2, 6, 1));
    await nextFrames(page);
    const at = await page.evaluate(() => {
      const g = (window as any).game;
      const e = g.engine;
      // The office on floor 6 nearest the camera's center.
      const mid = g.grid.width / 2;
      const office = g.sim.tower.units
        .filter((u: { kind: string; floor: number }) => u.kind === "office" && u.floor === 6)
        .sort((a: any, b: any) => Math.abs(a.x + a.width / 2 - mid) - Math.abs(b.x + b.width / 2 - mid))[0];
      const r = (document.getElementById("view") as HTMLCanvasElement).getBoundingClientRect();
      const fpx = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
      return { x: r.left + e.worldToScreenX(office.x + office.width / 2), y: r.top + e.worldToScreenY(6) + fpx / 2 };
    });
    await page.mouse.click(at.x, at.y);
    await expect(page.locator("#editor")).not.toHaveClass(/hidden/);
  });

  test("the world still builds with the map open", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const g = (window as any).game;
      g.sim.money = 1e9;
      g.syncSim();
    });
    await page.click('.pal-item[data-kind="office"]');
    const before = await page.evaluate(() => (window as any).game.sim.tower.units.length);
    // Bare floor on floor 4, left of the offices (which start at tile 34) and
    // clear of the map window.
    await page.evaluate(() => (window as any).game.engine.setCamera(20, 4, 1));
    // The camera moves on the next frame.
    await nextFrames(page);
    const at = await page.evaluate(() => {
      const g = (window as any).game;
      const e = g.engine;
      const r = (document.getElementById("view") as HTMLCanvasElement).getBoundingClientRect();
      const floorPx = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
      return { x: r.left + e.worldToScreenX(20), y: r.top + e.worldToScreenY(4) + floorPx / 2 };
    });
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => page.evaluate(() => (window as any).game.sim.tower.units.length)).toBeGreaterThan(before);
  });

  test("a closed map stays closed on the next visit", async ({ page }) => {
    await boot(page);
    await page.click("#overview-map .overview-map-close");
    await expect(page.locator("#overview-map")).toBeHidden();
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).game));
    await expect(page.locator("#btn-map")).toBeVisible();
    await expect(page.locator("#overview-map")).toBeHidden();
  });
});

test.describe("overview map on a phone", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("starts closed behind the pill, and a tap on the map moves the camera", async ({ page }) => {
    await boot(page);
    await expect(page.locator("#overview-map")).toBeHidden();
    await page.locator("#btn-map").tap();
    await expect(page.locator("#overview-map")).toBeVisible();
    const box = await mapBox(page);
    const start = await camera(page);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 8);
    await cameraFloorSettles(page, (f) => f > start.floor + 5);
  });

  test("the open card sits at the world's top-left, about 150 px wide and at most half its height", async ({ page }) => {
    // Portrait, and landscape (a short screen counts as a phone too).
    for (const size of [PHONE, { width: PHONE.height, height: PHONE.width }]) {
      await page.setViewportSize(size);
      await boot(page);
      // The phone layout remembers the open card across the reload.
      if (await page.locator("#overview-map").isHidden()) await page.locator("#btn-map").tap();
      await expect(page.locator("#overview-map")).toBeVisible();
      const card = await page.evaluate(() => {
        const map = document.getElementById("overview-map")!.getBoundingClientRect();
        const stage = document.getElementById("stage")!.getBoundingClientRect();
        return { left: map.left - stage.left, top: map.top - stage.top, width: map.width, height: map.height, stageHeight: stage.height };
      });
      const at = `${size.width}x${size.height}`;
      // The 8 px inset (no safe-area insets in the test browser).
      expect(card.left, at).toBeGreaterThanOrEqual(8);
      expect(card.left, at).toBeLessThan(16);
      expect(card.top, at).toBeGreaterThanOrEqual(8);
      expect(card.top, at).toBeLessThan(16);
      expect(card.width, at).toBeGreaterThan(140);
      expect(card.width, at).toBeLessThan(170);
      expect(card.height, at).toBeLessThanOrEqual(card.stageHeight / 2 + 1);
    }
  });

  test("a tap on a room below the card inspects it", async ({ page }) => {
    await boot(page);
    await page.locator("#btn-map").tap();
    await expect(page.locator("#overview-map")).toBeVisible();
    await expect(page.locator("#editor")).toHaveClass(/hidden/);
    // The office on floor 6 nearest the camera's center, which the camera
    // keeps in the middle of the world view, below the card.
    const at = await page.evaluate(() => {
      const g = (window as any).game;
      const e = g.engine;
      const mid = g.grid.width / 2;
      const office = g.sim.tower.units
        .filter((u: { kind: string; floor: number }) => u.kind === "office" && u.floor === 6)
        .sort((a: any, b: any) => Math.abs(a.x + a.width / 2 - mid) - Math.abs(b.x + b.width / 2 - mid))[0];
      const r = (document.getElementById("view") as HTMLCanvasElement).getBoundingClientRect();
      const fpx = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
      return { x: r.left + e.worldToScreenX(office.x + office.width / 2), y: r.top + e.worldToScreenY(6) + fpx / 2 };
    });
    const card = await mapBox(page);
    expect(at.y).toBeGreaterThan(card.y + card.height);
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.locator("#editor")).not.toHaveClass(/hidden/);
  });

  test("a pinch and a one-finger drag on the world still work with the map open", async ({ page }) => {
    await boot(page);
    await page.locator("#btn-map").tap();
    await expect(page.locator("#overview-map")).toBeVisible();
    // Fingers on the world below the map card (canvas coordinates).
    const cy = await page.evaluate(() => (document.getElementById("view") as HTMLCanvasElement).clientHeight * 0.75);
    // The Inspect tool is the default: one finger drags the world.
    const start = await camera(page);
    const px = await floorPx(page);
    await dispatchTouch(page, "pointerdown", 8001, 190, cy - px * 4);
    await dispatchTouch(page, "pointermove", 8001, 190, cy - px * 2);
    await dispatchTouch(page, "pointermove", 8001, 190, cy);
    await dispatchTouch(page, "pointerup", 8001, 190, cy);
    await cameraFloorSettles(page, (f) => f > start.floor + 2);
    // Two fingers spreading apart zoom in.
    const before = await floorPx(page);
    await dispatchTouch(page, "pointerdown", 8002, 150, cy);
    await dispatchTouch(page, "pointerdown", 8003, 230, cy);
    await dispatchTouch(page, "pointermove", 8002, 110, cy);
    await dispatchTouch(page, "pointermove", 8003, 270, cy);
    await dispatchTouch(page, "pointermove", 8002, 70, cy);
    await dispatchTouch(page, "pointermove", 8003, 310, cy);
    await dispatchTouch(page, "pointerup", 8002, 70, cy);
    await dispatchTouch(page, "pointerup", 8003, 310, cy);
    await expect.poll(() => floorPx(page)).toBeGreaterThan(before * 1.5);
  });

  test("on a 320 px phone the pill stays whole beside the open editor card", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await boot(page);
    await page.evaluate(() => {
      const g = (window as any).game;
      const office = g.sim.tower.units.find((u: { kind: string }) => u.kind === "office");
      g.selectPicked({ type: "unit", id: office.id, kind: office.kind });
    });
    await expect(page.locator("#editor")).toBeVisible();
    const layout = await page.evaluate(() => {
      const pill = document.getElementById("btn-map")!.getBoundingClientRect();
      const controls = [...document.querySelectorAll("#editor button, #editor select, #editor input")]
        .map((c) => c.getBoundingClientRect())
        .filter((c) => c.width > 0 && c.height > 0);
      const editor = document.getElementById("editor")!.getBoundingClientRect();
      const midY = pill.top + pill.height / 2;
      return {
        // The card spans the pill's column, so this checks a real collision.
        editorSpansPill: editor.left < pill.right && editor.right > pill.left,
        width: pill.width,
        height: pill.height,
        leftEdge: document.elementFromPoint(pill.left + 2, midY)?.id ?? null,
        rightEdge: document.elementFromPoint(pill.right - 2, midY)?.id ?? null,
        coveredControls: controls.filter((c) => c.right > pill.left && c.left < pill.right && c.bottom > pill.top && c.top < pill.bottom).length,
      };
    });
    expect(layout.editorSpansPill).toBe(true);
    expect(layout.width).toBeGreaterThanOrEqual(44);
    expect(layout.height).toBeGreaterThanOrEqual(44);
    expect(layout.leftEdge).toBe("btn-map");
    expect(layout.rightEdge).toBe("btn-map");
    expect(layout.coveredControls).toBe(0);
  });
});
