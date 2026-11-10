import { test, expect, type Page } from "@playwright/test";
import { buildToStar, dispatchTouch, expectEngineHosted } from "./helpers";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * The overview MAP window (#343) in the real browser: the camera binding
 * (CAP-3), the keys, focus and layout checks (CAP-5), the defaults (CAP-1),
 * and that the world behind it builds, inspects, pans and pinches the same
 * with the map open.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

/** Boot the page, drop the title screen and grow a 3-star tower (paused), so
 *  the map has rooms to draw and the camera room to move. */
async function boot(page: Page): Promise<void> {
  await page.goto("/");
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

  test("is on every page, and opens by default", async ({ page }) => {
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

  test("a drag that starts away from the view mark brings the view to the pointer", async ({ page }) => {
    await boot(page);
    const box = await mapBox(page);
    const x = box.x + box.width / 2;
    const target = box.y + box.height * 0.75;
    // Learn the floor at the drag's end, then move the view well away from it.
    const there = await floorAfterClickAt(page, x, target);
    const away = await floorAfterClickAt(page, x, box.y + box.height * 0.3);
    expect(away).toBeGreaterThan(there + 5);
    // Press far from the view mark and drag to the target: the view follows the pointer there.
    await page.mouse.move(x, box.y + box.height * 0.9);
    await page.mouse.down();
    await page.mouse.move(x, target, { steps: 6 });
    await page.mouse.up();
    const floor = await cameraFloorSettles(page, (f) => Math.abs(f - there) < 1);
    expect(Math.abs(floor - there)).toBeLessThan(1);
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

  test("on a narrow desktop the hint sits above the open map, clear of the Getting Started card (#1735)", async ({ page }) => {
    for (const size of [
      { width: 768, height: 600 },
      { width: 1050, height: 700 },
      // Wider, the hint moves only while the card is up, where a long step
      // still wraps to two lines.
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(size);
      await boot(page);
      await page.evaluate(() => {
        const g = (window as any).game;
        g.onboarding.arm(g.enginePort);
        // The longest step's hint, so the check covers the most lines.
        document.getElementById("hint")!.textContent = "x ".repeat(82);
      });
      await expect(page.locator("#onboard")).toBeVisible();
      await expect(page.locator("#overview-map")).toBeVisible();
      const box = await page.evaluate(() => {
        const r = (id: string) => document.getElementById(id)!.getBoundingClientRect().toJSON();
        return { hint: r("hint"), map: r("overview-map"), card: r("onboard"), stage: r("stage") };
      });
      const at = `${size.width}x${size.height}`;
      const hit = (a: DOMRect, b: DOMRect) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
      expect(box.hint.height, at).toBeGreaterThan(0);
      expect(hit(box.hint, box.card), at).toBe(false);
      expect(hit(box.hint, box.map), at).toBe(false);
      // Just above the map and lined up with it, inside the world view.
      expect(box.hint.bottom, at).toBeLessThanOrEqual(box.map.top);
      expect(box.map.top - box.hint.bottom, at).toBeLessThan(16);
      expect(Math.abs(box.hint.right - box.map.right), at).toBeLessThan(2);
      expect(box.hint.top, at).toBeGreaterThan(box.stage.top);
    }
  });

  test("on a short desktop window the hint stays at the bottom, inside the world view", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 450 });
    await boot(page);
    await expect(page.locator("#overview-map")).toBeVisible();
    const box = await page.evaluate(() => {
      const r = (id: string) => document.getElementById(id)!.getBoundingClientRect().toJSON();
      return { hint: r("hint"), stage: r("stage") };
    });
    expect(box.hint.top).toBeGreaterThanOrEqual(box.stage.top);
    expect(box.stage.bottom - box.hint.bottom).toBeLessThan(16);
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
        const others: Record<string, DOMRect> = {};
        for (const id of ["sidebar", "palette", "hint"]) {
          const r = document.getElementById(id)?.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) others[id] = r;
        }
        const hit = (r: DOMRect) => r.right > map.left && r.left < map.right && r.bottom > map.top && r.top < map.bottom;
        return { checked: Object.keys(others), overlapping: Object.keys(others).filter((k) => hit(others[k])) };
      });
      expect(overlaps.checked, `${size.width}x${size.height}`).toEqual(expect.arrayContaining(["sidebar", "palette", "hint"]));
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
    // setCamera moves the camera at once; the frames let the renderer draw
    // the new view before the click below lands on it.
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

  test("a closed map stays closed on a new tower", async ({ page }) => {
    await boot(page);
    await page.click("#overview-map .overview-map-close");
    await expect(page.locator("#overview-map")).toBeHidden();
    await page.evaluate(() => (window as any).game.saveLoad.newGame("modern"));
    await page.waitForFunction(() => (window as any).game.reader.header.mode === "modern");
    await nextFrames(page);
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
    // Portrait. A phone held sideways has its own sizing (the next test).
    const size = PHONE;
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
  });

  test("held sideways, the card keeps the map's 150:216 shape and takes at most two thirds of the view", async ({ page }) => {
    // A short screen counts as a phone too, but half its height would leave
    // a map too thin to read, so the landscape block sizes it by shape.
    await page.setViewportSize({ width: PHONE.height, height: PHONE.width });
    await boot(page);
    if (await page.locator("#overview-map").isHidden()) await page.locator("#btn-map").tap();
    await expect(page.locator("#overview-map")).toBeVisible();
    const card = await page.evaluate(() => {
      const map = document.getElementById("overview-map")!.getBoundingClientRect();
      const body = document.querySelector(".overview-map-body")!.getBoundingClientRect();
      const stage = document.getElementById("stage")!.getBoundingClientRect();
      return { left: map.left - stage.left, top: map.top - stage.top, height: map.height, bodyWidth: body.width, bodyHeight: body.height, stageHeight: stage.height };
    });
    expect(card.left).toBeGreaterThanOrEqual(8);
    expect(card.left).toBeLessThan(16);
    expect(card.top).toBeGreaterThanOrEqual(8);
    expect(card.top).toBeLessThan(16);
    expect(card.height).toBeLessThanOrEqual(card.stageHeight * 0.66 + 1);
    expect(card.bodyHeight).toBeGreaterThan(card.stageHeight / 2 - 30);
    expect(card.bodyWidth / card.bodyHeight).toBeCloseTo(150 / 216, 2);
    // Never wider than the map's native 150 px.
    expect(card.bodyWidth).toBeLessThanOrEqual(150.5);
  });

  test("held sideways, the stat chips show every value whole and keep their size", async ({ page }) => {
    // The Pixel 11 Pro held sideways. Each changing chip has a fixed width,
    // so a value that grows (the traffic floor, the funds) never moves the
    // chips after it or rewraps the bar, which would resize the view and
    // rebuild an open Map. The widths fit the longest values whole.
    await page.setViewportSize({ width: 852, height: 352 });
    await boot(page);
    const values = {
      shortest: ["Smooth", "", "Mon 07:00", "1st WD/1Q/1st Year", "$0", "0"],
      typical: ["Busy", " · 12F", "Mon 07:00", "3rd WD/2Q/4th Year", "$2,000,000", "12,345"],
      longest: ["Backed up", " · 100F", "WD2 00:00", "2nd WD/4Q/122nd Year", "$-999,999,999", "99,999"],
    };
    await page.evaluate(() => document.fonts.ready);
    // Whether DejaVu Sans is installed: a face that is missing falls back to
    // monospace here and measures the same.
    const hasDejaVu = await page.evaluate(() => {
      const c = document.createElement("canvas").getContext("2d")!;
      c.font = "12px monospace";
      const fallback = c.measureText("WD2 00:00").width;
      c.font = '12px "DejaVu Sans", monospace';
      return c.measureText("WD2 00:00").width !== fallback;
    });
    // In the page's own font, then in DejaVu Sans, the widest common UI font.
    // The pinned CI image has no DejaVu Sans (and adding it would change the
    // default sans font under the visual baselines), so CI skips that pass;
    // src/tests/landscapeChipWidths.test.ts pins its measured widths instead.
    for (const font of ["", '"DejaVu Sans"']) {
      if (font && !hasDejaVu) {
        test.info().annotations.push({ type: "skipped pass", description: "DejaVu Sans is not installed" });
        continue;
      }
      const sizes = await page.evaluate(({ values, font }) => {
        if (font) {
          const style = document.createElement("style");
          style.textContent = `#status .stat .value, #status .stat .label { font-family: ${font}; }`;
          document.head.appendChild(style);
        }
        const ids = ["traffic-label", "traffic-floor", "stat-time", "stat-date", "stat-money", "stat-pop"];
        const show = (texts: string[]) => {
          ids.forEach((id, i) => (document.getElementById(id)!.textContent = texts[i]));
          const bar = document.getElementById("topbar")!.getBoundingClientRect();
          const stage = document.getElementById("stage")!.getBoundingClientRect();
          const chips = ["traffic", "stat-time", "stat-date", "stat-money", "stat-pop"].map(
            (id) => document.getElementById(id)!.closest(".stat")!.getBoundingClientRect().width,
          );
          // A value cut short by its chip scrolls wider than it shows. The
          // floor never shrinks, so the traffic chip itself stands in for it.
          const clipped = [...ids.filter((id) => id !== "traffic-floor"), "traffic"].filter((id) => {
            const el = document.getElementById(id)!;
            return el.scrollWidth > el.clientWidth;
          });
          return { bar: bar.height, stageWidth: stage.width, stageHeight: stage.height, chips, clipped };
        };
        return { shortest: show(values.shortest), typical: show(values.typical), longest: show(values.longest) };
      }, { values, font });
      expect(sizes.typical, font).toEqual(sizes.shortest);
      expect(sizes.longest, font).toEqual(sizes.shortest);
      expect(sizes.shortest.clipped, font).toEqual([]);
      // Two rows: the buttons, then the chips.
      expect(sizes.shortest.bar, font).toBeLessThan(60);
    }
    // A tier word too wide for its chip is trimmed on its one line, and the
    // floor still shows whole.
    const trimmed = await page.evaluate(() => {
      const label = document.getElementById("traffic-label")!;
      const floor = document.getElementById("traffic-floor")!;
      const chip = document.getElementById("traffic")!;
      label.textContent = "Backed up";
      floor.textContent = " · 100F";
      const bar = () => document.getElementById("topbar")!.getBoundingClientRect().height;
      const before = { bar: bar(), line: label.getBoundingClientRect().height };
      label.style.letterSpacing = "0.3em";
      return {
        before,
        after: { bar: bar(), line: label.getBoundingClientRect().height },
        labelClipped: label.scrollWidth > label.clientWidth,
        // Trimmed by its own box, so the cut text cannot spill over the floor.
        labelHidden: getComputedStyle(label).overflowX === "hidden",
        // The floor never shrinks, so only the chip can cut it: it must end
        // inside the chip, and the chip must not overflow.
        floorWhole:
          floor.getBoundingClientRect().right <= chip.getBoundingClientRect().right + 0.5 && chip.scrollWidth <= chip.clientWidth,
      };
    });
    expect(trimmed.labelClipped).toBe(true);
    expect(trimmed.labelHidden).toBe(true);
    expect(trimmed.floorWhole).toBe(true);
    expect(trimmed.after).toEqual(trimmed.before);
  });

  // Under 340px tall, or under 540px wide where the top bar wraps to more
  // lines, the tabs go to one sideways row, so the open category keeps room
  // to scroll. Each bound is checked just inside and just outside.
  for (const size of [
    { width: 568, height: 320 },
    { width: 700, height: 250 },
    { width: 480, height: 340 },
    { width: 420, height: 340 },
    { width: 568, height: 339 },
    { width: 539, height: 340 },
    // Just outside both bounds, the tabs sit two wide again.
    { width: 568, height: 340 },
    { width: 540, height: 340 },
  ]) {
    const at = `${size.width}x${size.height}`;
    test(`on a ${at} sideways window, every category opens in view and its last tool can be reached`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(size);
      await boot(page);
      // Every category unlocked, so all seven tabs show.
      await page.evaluate(buildToStar, 5);
      // One sideways row inside the bounds, two wide just outside them.
      const oneRow = size.height < 340 || size.width < 540;
      expect(await page.locator("#palette-tabs").evaluate((t) => getComputedStyle(t).flexWrap), at).toBe(oneRow ? "nowrap" : "wrap");
      const groups = await page.$$eval(".pal-tab:not([hidden])", (tabs) => tabs.map((t) => (t as HTMLElement).dataset.group!));
      expect(groups.length, at).toBeGreaterThan(4);
      for (const group of groups) {
        const list = await page.evaluate((group) => {
          // A click from the page itself, so the browser does not scroll the
          // tab into view first: opening a tab must bring it into the row.
          const tab = document.querySelector<HTMLElement>(`.pal-tab[data-group="${group}"]`)!;
          tab.click();
          const row = document.getElementById("palette-tabs")!.getBoundingClientRect();
          const box = tab.getBoundingClientRect();
          const tabInView = box.left >= row.left - 0.5 && box.right <= row.right + 0.5;
          const tiles = [...document.querySelectorAll<HTMLElement>(".pal-group.tab-active .pal-item")].filter((t) => t.getClientRects().length > 0);
          const last = tiles[tiles.length - 1];
          last.scrollIntoView({ block: "end" });
          const tile = last.getBoundingClientRect();
          return {
            tabInView,
            height: document.querySelector(".pal-groups")!.clientHeight,
            reached: document.elementFromPoint(tile.left + tile.width / 2, tile.top + tile.height / 2)?.closest(".pal-item") === last,
          };
        }, group);
        expect(list.tabInView, `${at} ${group}`).toBe(true);
        // Room for at least two 32px tiles at a time.
        expect(list.height, `${at} ${group}`).toBeGreaterThanOrEqual(64);
        expect(list.reached, `${at} ${group}`).toBe(true);
      }
    });
  }

  test("held sideways with the Map open and no Getting Started card, a toast shows over the editor's title", async ({ page }) => {
    // The editor's sticky title has a z-index. With no card up the editor has
    // none of its own, and with the Map open (so no pill) neither do the
    // toasts, so without the editor's own stacking context the title would
    // paint over a toast that sits above it.
    await page.setViewportSize({ width: PHONE.height, height: PHONE.width });
    await boot(page);
    if (await page.locator("#overview-map").isHidden()) await page.locator("#btn-map").tap();
    await expect(page.locator("#btn-map")).toBeHidden();
    await page.evaluate(() => {
      const g = (window as any).game;
      const unit = g.sim.tower.units.find((u: { kind: string }) => u.kind === "office");
      g.selectPicked({ type: "unit", id: unit.id, kind: unit.kind });
    });
    await expect(page.locator("#editor .win-title")).toBeVisible();
    const onTop = await page.evaluate(() => {
      // The title screen is gone in play, and with it the toasts' raised layer.
      document.body.classList.remove("splash-up");
      const title = document.querySelector("#editor > .win-title")!.getBoundingClientRect();
      const wrap = document.getElementById("toast-wrap")!;
      const toast = document.createElement("div");
      toast.className = "toast";
      toast.textContent = "Test toast";
      wrap.appendChild(toast);
      // Move the toasts over the title, in the stage's own coordinates.
      const stage = (wrap.offsetParent ?? document.body).getBoundingClientRect();
      Object.assign(wrap.style, { left: `${title.left - stage.left}px`, top: `${title.top - stage.top}px`, right: "auto", bottom: "auto", width: `${title.width}px`, transform: "none" });
      const box = toast.getBoundingClientRect();
      const x = Math.max(box.left, title.left) + 4;
      const y = (Math.max(box.top, title.top) + Math.min(box.bottom, title.bottom)) / 2;
      return {
        layer: getComputedStyle(wrap).zIndex,
        overlap: box.top < title.bottom && box.bottom > title.top && box.left < title.right && box.right > title.left && x < Math.min(box.right, title.right),
        hit: !!document.elementFromPoint(x, y)?.closest(".toast"),
      };
    });
    expect(onTop.layer).toBe("auto");
    expect(onTop.overlap).toBe(true);
    expect(onTop.hit).toBe(true);
  });

  test("on every view the card keeps the top-left corner and stays clear of the build controls", async ({ page }) => {
    // Two boots, each growing a 3-star tower.
    test.setTimeout(90_000);
    const pick = (view: string) => page.locator("#overview-map-picker").selectOption(view);
    const place = () =>
      page.evaluate(() => {
        const map = document.getElementById("overview-map")!.getBoundingClientRect();
        const view = document.getElementById("view")!.getBoundingClientRect();
        const stage = document.getElementById("stage")!.getBoundingClientRect();
        const palette = document.getElementById("palette")!.getBoundingClientRect();
        const overlapsPalette = palette.width > 0 && map.left < palette.right && map.right > palette.left && map.top < palette.bottom && map.bottom > palette.top;
        return { top: map.top - view.top, bottom: map.bottom, stageBottom: stage.bottom, overlapsPalette };
      });
    // Portrait, and landscape (a short screen counts as a phone too).
    for (const size of [PHONE, { width: PHONE.height, height: PHONE.width }]) {
      await page.setViewportSize(size);
      await boot(page);
      if (await page.locator("#overview-map").isHidden()) await page.locator("#btn-map").tap();
      await expect(page.locator("#overview-map")).toBeVisible();
      const at = `${size.width}x${size.height}`;
      for (const view of ["edit", "traffic", "occupancy"]) {
        await pick(view);
        const on = await place();
        expect(on.top, `${at} ${view}`).toBeLessThan(16);
        expect(on.bottom, `${at} ${view}`).toBeLessThanOrEqual(on.stageBottom);
        expect(on.overlapsPalette, `${at} ${view}`).toBe(false);
      }
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

  test("a Map opened during onboarding sits above the Getting Started card and still closes", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const g = (window as any).game;
      g.onboarding.arm(g.enginePort);
    });
    await expect(page.locator("#onboard")).toBeVisible();
    await page.locator("#btn-map").tap();
    await expect(page.locator("#overview-map")).toBeVisible();
    const close = page.locator("#overview-map .overview-map-close");
    const box = (await close.boundingBox())!;
    // The close button lies inside the Getting Started card's box, so only the stacking keeps it reachable.
    const card = (await page.locator("#onboard").boundingBox())!;
    expect(box.y + box.height / 2).toBeGreaterThan(card.y);
    expect(box.y + box.height / 2).toBeLessThan(card.y + card.height);
    const onTop = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".overview-map-close"),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(onTop).toBe(true);
    await close.tap();
    await expect(page.locator("#overview-map")).toBeHidden();
  });

  test("held sideways, the Getting Started card clears the tools column, and the Map when it opens", async ({ page }) => {
    await page.setViewportSize({ width: PHONE.height, height: PHONE.width });
    await boot(page);
    await page.evaluate(() => {
      const g = (window as any).game;
      g.onboarding.arm(g.enginePort);
    });
    await expect(page.locator("#onboard")).toBeVisible();
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const palette = (await page.locator("#palette").boundingBox())!;
    if (await page.locator("#overview-map").isVisible()) await page.locator("#overview-map .overview-map-close").tap();
    await expect(page.locator("#overview-map")).toBeHidden();
    const closed = (await page.locator("#onboard").boundingBox())!;
    expect(overlaps(closed, palette)).toBe(false);
    // It leaves most of the world view clear.
    expect(closed.width).toBeLessThanOrEqual(300);
    // An editor card opened under it keeps its close button on top.
    await page.evaluate(() => {
      const g = (window as any).game;
      const office = g.sim.tower.units.find((u: { kind: string }) => u.kind === "office");
      g.selectPicked({ type: "unit", id: office.id, kind: office.kind });
    });
    await expect(page.locator("#editor")).toBeVisible();
    const editorClose = page.locator("#editor .ed-close");
    const closeBox = (await editorClose.boundingBox())!;
    expect(overlaps(closeBox, (await page.locator("#onboard").boundingBox())!)).toBe(true);
    const closeOnTop = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest("#editor"),
      { x: closeBox.x + closeBox.width / 2, y: closeBox.y + closeBox.height / 2 },
    );
    expect(closeOnTop).toBe(true);
    // With the Map pill showing beside the open editor, the inspector, the
    // toasts and the pill stay above the card too.
    await expect(page.locator("#btn-map")).toBeVisible();
    const layers = await page.evaluate(() => {
      const z = (id: string) => Number(getComputedStyle(document.getElementById(id)!).zIndex);
      return { card: z("onboard"), editor: z("editor"), inspector: z("inspector"), toasts: z("toast-wrap"), pill: z("btn-map") };
    });
    expect(layers.inspector).toBeGreaterThan(layers.card);
    expect(layers.toasts).toBeGreaterThan(layers.card);
    expect(layers.pill).toBeGreaterThan(layers.card);
    // The pill comes first in the stage, so it needs a higher layer than the
    // editor to paint above it.
    expect(layers.pill).toBeGreaterThan(layers.editor);
    await editorClose.tap();
    await expect(page.locator("#editor")).toBeHidden();
    await page.locator("#btn-map").tap();
    await expect(page.locator("#overview-map")).toBeVisible();
    const card = (await page.locator("#onboard").boundingBox())!;
    expect(overlaps(card, palette)).toBe(false);
    expect(overlaps(card, (await page.locator("#overview-map").boundingBox())!)).toBe(false);
  });
});
