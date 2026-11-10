import { test, expect, type Page } from "@playwright/test";
import { buildToStar, expectEngineHosted } from "./helpers";
import { SKY_HEADROOM_FLOORS } from "../src/render/cameraBounds";
import { MAP_BAND_FLOORS } from "../src/render/overviewMap/extent";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * The overview MAP window's View dropdown and its Hotel, Eval, Pricing,
 * Traffic and Occupancy views (#343 S6, S8 and S9, #1617 to #1619, #1727) in
 * the real browser: the dropdown on a desktop and a phone, its keys, each
 * view's legend, the Hotel view marking a room the engine turned dirty
 * within a game hour with no tower edit, the Pricing view following a rent
 * command at once, and the Traffic and Occupancy views counting the floors,
 * with the sidebar's Floor heatmap and its main-view tint gone.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
/** A tower whose top floor plus the sky headroom lands right on a band line,
 *  so the crop has no spare sky over it and a legend would cover its top. */
const TALL_FLOORS = 6 * MAP_BAND_FLOORS - SKY_HEADROOM_FLOORS;
/** Hotel singles on floor 2, each this many tiles wide (`hotelSingle`). */
const HOTEL_ROOMS = 12;

/** Boot the game and drop the title screen. */
async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game && (window as any).overviewMap));
  await page.evaluate(() => document.getElementById("splash")?.remove());
}

/**
 * Found a Classic tower (paused) with a lobby, a floor of hotel singles whose
 * guests are asleep, and the clock at 7:30 on day 2, so the engine's 8:00
 * checkout turns every room dirty. No housekeeping, so they stay dirty. The
 * camera sits on the rooms. Runs in the page.
 */
function foundHotelTower(rooms: number): void {
  const g = (window as any).game;
  const Sim = g.sim.constructor;
  const s = Sim.newGame(5, "classic");
  s.money = 1e9;
  s.star = 3;
  const W = g.grid.width;
  const c = Math.floor(W / 2);
  const left = c - rooms * 2;
  for (let x = left - 4; x < left + rooms * 4 + 4; x++) {
    s.tower.place("lobby", 1, x);
    s.tower.place("floor", 2, x);
  }
  for (let i = 0; i < rooms; i++) {
    const r = s.tower.place("hotelSingle", 2, left + i * 4);
    if (!r.ok) throw new Error(`hotel single refused: ${r.reason ?? "unknown"}`);
  }
  for (const u of s.tower.units as any[]) {
    if (u.kind !== "hotelSingle") continue;
    u.state = "asleep";
    u.everOccupied = true;
    u.occupants = 1;
  }
  s.clock.minutes = 24 * 60 + 7 * 60 + 30;
  g.adoptSim(s, true);
  g.speed = 0;
  g.engine.setCamera(c, 2, 1);
}

/** Found a paused Classic tower of plain floors, 40 tiles wide, from the
 *  lobby up to `floors`.
 *  Runs in the page. */
function foundTallTower(floors: number): void {
  const g = (window as any).game;
  const s = g.sim.constructor.newGame(5, "classic");
  s.money = 1e12;
  s.star = 5;
  const c = Math.floor(g.grid.width / 2);
  for (let x = c - 20; x < c + 20; x++) {
    s.tower.place("lobby", 1, x);
    for (let f = 2; f <= floors; f++) s.tower.place("floor", f, x);
  }
  g.adoptSim(s, true);
  g.speed = 0;
  g.engine.setCamera(c, 2, 1);
}

/** How far the shown legend's bottom sits under the top floor's top edge on
 *  the map, in CSS pixels: positive when the legend hides part of a floor. */
async function legendOverTower(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as any).game;
    const map = (window as any).overviewMap;
    const layout = map.model.layout;
    const canvas = document.querySelector("#overview-map .overview-map-tower") as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const scale = box.height / canvas.height;
    const topEdge = box.top + (layout.extent.topLine - g.reader.tower.highestFloor) * layout.pxPerFloor * scale;
    const legend = document.querySelector("#overview-map .overview-map-legend:not([hidden])")!.getBoundingClientRect();
    return legend.bottom - topEdge;
  });
}

/** How many tower-layer pixels are the Hotel view's dirty red, #a01010 (160, 16, 16). */
async function redPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector("#overview-map .overview-map-tower") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && Math.abs(d[i] - 160) <= 16 && d[i + 1] < 40 && d[i + 2] < 40) n++;
    return n;
  });
}

/** Wait two animation frames, so the frame loop runs the map. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/** The open map at 768 by 600 and 1280 by 720 overlaps none of the sidebar,
 *  the palette or the hint. */
async function expectMapClear(page: Page): Promise<void> {
  for (const size of [
    { width: 768, height: 600 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await boot(page);
    await expect(picker(page)).toBeVisible();
    const overlapping = await page.evaluate(() => {
      const map = document.getElementById("overview-map")!.getBoundingClientRect();
      const others: Record<string, DOMRect> = {};
      for (const id of ["sidebar", "palette", "hint"]) {
        const r = document.getElementById(id)?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) others[id] = r;
      }
      const hit = (r: DOMRect) => r.right > map.left && r.left < map.right && r.bottom > map.top && r.top < map.bottom;
      return Object.keys(others).filter((k) => hit(others[k]));
    });
    expect(overlapping, `${size.width}x${size.height}`).toEqual([]);
  }
}

/** The Map's View dropdown. */
function picker(page: Page) {
  return page.getByRole("combobox", { name: "View" });
}

/** The legend's counts, summed. */
async function legendTotal(page: Page, view: string): Promise<number> {
  const text = (await page.locator(`#overview-map .overview-map-legend[data-view="${view}"]`).textContent()) ?? "";
  return (text.match(/\d+/g) ?? []).reduce((sum, n) => sum + Number(n), 0);
}

test.describe("the map's View dropdown on the desktop", () => {
  test.use({ viewport: DESKTOP });

  test("sits under the title bar, named View, listing the six views with Edit chosen", async ({ page }) => {
    await boot(page);
    const select = picker(page);
    await expect(select).toBeVisible();
    await expect(select.locator("option")).toHaveText(["Edit", "Eval", "Pricing", "Hotel", "Traffic", "Occupancy"]);
    await expect(select).toHaveValue("edit");
    const layout = await page.evaluate(() => {
      const box = (el: Element | null) => el!.getBoundingClientRect();
      return {
        title: box(document.querySelector("#overview-map .win-title")),
        body: box(document.querySelector("#overview-map .overview-map-body")),
        select: box(document.getElementById("overview-map-picker")),
      };
    });
    expect(layout.select.top).toBeGreaterThanOrEqual(layout.title.bottom);
    expect(layout.select.bottom).toBeLessThanOrEqual(layout.body.top);
    expect(layout.select.right).toBeLessThanOrEqual(layout.body.right + 1);
    // The sidebar's Floor heatmap is gone: the Map has its views now.
    await expect(page.locator("#overlay-mode")).toHaveCount(0);
  });

  test("changes view from the keyboard, keeps the game's keys, and hands a focused map its keys back", async ({ page }) => {
    await boot(page);
    await page.evaluate(buildToStar, 2);
    const select = picker(page);
    const legend = (view: string) => page.locator(`#overview-map .overview-map-legend[data-view="${view}"]`);
    await select.focus();
    await page.keyboard.press("ArrowDown");
    await expect(select).toHaveValue("eval");
    // Each view shows its own legend over the map.
    await expect(legend("eval")).toBeVisible();
    await expect(legend("hotel")).toBeHidden();
    await page.keyboard.press("ArrowDown");
    await expect(legend("pricing")).toBeVisible();
    await expect(legend("eval")).toBeHidden();
    await page.keyboard.press("End");
    await expect(select).toHaveValue("occupancy");
    await expect(legend("occupancy")).toBeVisible();
    await expect(select).toBeFocused();
    // The focus ring shows on the keyboard-focused dropdown.
    expect(await select.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Home");
    await expect(select).toHaveValue("edit");
    await expect(page.locator("#overview-map .overview-map-legend:visible")).toHaveCount(0);
    // A build key on the focused dropdown stays out of the world.
    const cursor = () => page.evaluate(() => (window as any).game.keyboard.cursor());
    await page.click('.pal-item[data-kind="office"]');
    await select.focus();
    await page.keyboard.press("d");
    await nextFrames(page);
    expect(await cursor()).toBeNull();
    // A choice made with a pointer gives focus back to a focused map, so its
    // arrow keys still move the view.
    const map = page.locator("#overview-map .overview-map-view");
    await map.focus();
    await select.dispatchEvent("pointerdown");
    await select.selectOption("hotel");
    await expect(legend("hotel")).toBeVisible();
    await expect(map).toBeFocused();
    const before = await page.evaluate(() => (window as any).game.engine.viewState().floor);
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => page.evaluate(() => (window as any).game.engine.viewState().floor)).toBeGreaterThan(before);
  });

  test("with the dropdown, the open map still clears the sidebar, the palette and the hint", async ({ page }) => {
    await expectMapClear(page);
  });

  test("the Hotel view marks the rooms the engine turned dirty within a game hour", async ({ page }) => {
    await boot(page);
    await page.evaluate(foundHotelTower, HOTEL_ROOMS);
    await picker(page).selectOption("hotel");
    await nextFrames(page);
    const legend = page.locator('#overview-map .overview-map-legend[data-view="hotel"]');
    await expect(legend).toHaveText("Dirty: 0Infested: 0");
    expect(await redPixels(page)).toBe(0);
    const revision = await page.evaluate(() => (window as any).game.reader.header.revision);
    // Half an hour on: the 8:00 checkout turns every room dirty. Only the
    // rooms' states move, never the tower's revision.
    await page.evaluate(() => {
      const g = (window as any).game;
      g.enginePort.tick(31);
      g.reader.update();
    });
    expect(await page.evaluate(() => (window as any).game.reader.rooms.filter((r: any) => r.state === "dirty").length)).toBe(HOTEL_ROOMS);
    expect(await page.evaluate(() => (window as any).game.reader.header.revision)).toBe(revision);
    await expect(legend).toHaveText(`Dirty: ${HOTEL_ROOMS}Infested: 0`);
    await expect.poll(() => redPixels(page)).toBeGreaterThan(HOTEL_ROOMS);
    // The Edit view draws no red rooms (the tower has no service elevator).
    await picker(page).selectOption("edit");
    await expect.poll(() => redPixels(page)).toBe(0);
  });

  test("the Pricing view colors the rooms by the engine's rent tiers and follows a rent command at once", async ({ page }) => {
    await boot(page);
    await page.evaluate(foundHotelTower, HOTEL_ROOMS);
    await picker(page).selectOption("pricing");
    await nextFrames(page);
    const legend = page.locator('#overview-map .overview-map-legend[data-view="pricing"]');
    // Default prices read Average.
    await expect(legend).toHaveText(`High: 0Average: ${HOTEL_ROOMS}Low: 0Very Low: 0`);
    // Raise one room's rate from the inspector, with the game paused: no
    // revision moves and no game hour turns, yet the view follows.
    await page.evaluate(() => {
      const g = (window as any).game;
      const room = (g.reader.rooms as any[]).find((r) => r.kind === "hotelSingle");
      g.selected = { type: "unit", id: room.id };
      return g.editor.handleEditAction("rentUp", document.body);
    });
    await expect(legend).toHaveText(`High: 1Average: ${HOTEL_ROOMS - 1}Low: 0Very Low: 0`);
    // The guests asleep in their rooms rate them on the Eval view.
    await picker(page).selectOption("eval");
    const evalLegend = page.locator('#overview-map .overview-map-legend[data-view="eval"]');
    await expect(evalLegend).toBeVisible();
    await expect(evalLegend).toHaveText(/^Excellent: \d+Good: \d+Terrible: \d+$/);
    expect(await legendTotal(page, "eval")).toBeGreaterThan(0);
  });

  test("the Traffic and Occupancy views count the floors from the engine's heat cells", async ({ page }) => {
    await boot(page);
    await page.evaluate(foundHotelTower, HOTEL_ROOMS);
    await picker(page).selectOption("traffic");
    await nextFrames(page);
    const traffic = page.locator('#overview-map .overview-map-legend[data-view="traffic"]');
    await expect(traffic).toHaveText(/^Clear: \d+Busy: \d+Jammed: \d+$/);
    // The lobby and the hotel floor are built, so both get a band.
    await expect.poll(() => legendTotal(page, "traffic")).toBe(2);
    await picker(page).selectOption("occupancy");
    const occupancy = page.locator('#overview-map .overview-map-legend[data-view="occupancy"]');
    await expect(occupancy).toBeVisible();
    await expect(traffic).toBeHidden();
    // Every guest is in: the one floor with rooms reads mostly full.
    await expect(occupancy).toHaveText("Mostly full: 1Half full: 0Mostly empty: 0");
  });
});

test.describe("the map's View dropdown on a touch screen at desktop sizes", () => {
  test.use({ viewport: DESKTOP, hasTouch: true });

  test("with a coarse pointer's taller dropdown, the open map still clears the sidebar, the palette and the hint (#1769)", async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await expectMapClear(page);
  });
});

test.describe("the map's View dropdown on a phone", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("is one slim dropdown, so the map keeps its size, upright and on its side", async ({ page }) => {
    for (const size of [PHONE, { width: PHONE.height, height: PHONE.width }]) {
      await page.setViewportSize(size);
      await boot(page);
      if (await page.locator("#overview-map").isHidden()) await page.locator("#btn-map").tap();
      await expect(picker(page)).toBeVisible();
      const got = await page.evaluate(() => ({
        select: document.getElementById("overview-map-picker")!.getBoundingClientRect().toJSON(),
        body: document.querySelector("#overview-map .overview-map-body")!.getBoundingClientRect().toJSON(),
        map: document.getElementById("overview-map")!.getBoundingClientRect().height,
        stageHeight: document.getElementById("stage")!.getBoundingClientRect().height,
      }));
      const at = `${size.width}x${size.height}`;
      // A target past WCAG 2.5.8's 24 px minimum, and no taller.
      expect(got.select.height, at).toBeGreaterThanOrEqual(28);
      expect(got.select.height, at).toBeLessThan(34);
      expect(got.select.width, at).toBeGreaterThanOrEqual(24);
      // The landscape Map keeps its S5 two-thirds allowance; upright it stays within half the view.
      const maxHeight = size.width > size.height ? got.stageHeight * 0.66 : got.stageHeight / 2;
      expect(got.map, at).toBeLessThanOrEqual(maxHeight + 1);
      // Upright, the map body keeps its full 150 by 216 card.
      if (size.height > size.width) expect(got.body.height, at).toBeGreaterThanOrEqual(214);
      // On its side, the body is far more than a strip under the dropdown (#1769).
      else expect(got.body.height, at).toBeGreaterThanOrEqual(100);
    }
    await picker(page).selectOption("hotel");
    await expect(page.locator('#overview-map .overview-map-legend[data-view="hotel"]')).toBeVisible();
  });

  test("a view's legend hides no floor of a tower that fills the map, upright and on its side (#1769)", async ({ page }) => {
    for (const size of [PHONE, { width: PHONE.height, height: PHONE.width }]) {
      await page.setViewportSize(size);
      await boot(page);
      await page.evaluate(foundTallTower, TALL_FLOORS);
      if (await page.locator("#overview-map").isHidden()) await page.locator("#btn-map").tap();
      for (const view of ["eval", "pricing", "hotel", "traffic", "occupancy"]) {
        await picker(page).selectOption(view);
        await nextFrames(page);
        await nextFrames(page);
        expect(await legendOverTower(page), `${view} at ${size.width}x${size.height}`).toBeLessThanOrEqual(0.5);
      }
    }
  });
});
