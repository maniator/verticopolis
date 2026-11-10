import { test, expect, type Page } from "@playwright/test";
import { buildToStar, expectEngineHosted } from "./helpers";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * The overview MAP window's view tabs and its Hotel, Eval and Pricing views
 * (#343 S6 and S8, #1617 to #1619) in the real browser: the tab row on a
 * desktop and a phone, the tab keys, each view's legend, the Hotel view
 * marking a room the engine turned dirty within a game hour with no tower
 * edit, and the Pricing view following a rent command at once.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
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

test.describe("map view tabs on the desktop", () => {
  test.use({ viewport: DESKTOP });

  test("sit in one row under the title bar, a real tab control", async ({ page }) => {
    await boot(page);
    const list = page.getByRole("tablist", { name: "Map views" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("tab")).toHaveText(["Edit", "Eval", "Pricing", "Hotel"]);
    const edit = list.getByRole("tab", { name: "Edit" });
    const hotel = list.getByRole("tab", { name: "Hotel" });
    await expect(edit).toHaveAttribute("aria-selected", "true");
    await expect(hotel).toHaveAttribute("aria-selected", "false");
    const layout = await page.evaluate(() => {
      const box = (el: Element | null) => el!.getBoundingClientRect();
      const tabs = [...document.querySelectorAll("#overview-map [role=tab]")].map(box);
      return {
        title: box(document.querySelector("#overview-map .win-title")),
        body: box(document.querySelector("#overview-map .overview-map-body")),
        tabs: tabs.map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })),
      };
    });
    // One row: every tab on the same line, between the title bar and the body.
    expect(layout.tabs).toHaveLength(4);
    for (const [i, t] of layout.tabs.entries()) {
      expect(t.top).toBe(layout.tabs[0].top);
      expect(t.top).toBeGreaterThanOrEqual(layout.title.bottom);
      expect(t.bottom).toBeLessThanOrEqual(layout.body.top);
      if (i > 0) expect(t.left).toBeGreaterThan(layout.tabs[i - 1].right - 1);
    }
    // The panel is the map body, named by the selected tab.
    const panel = page.getByRole("tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", (await edit.getAttribute("id"))!);
  });

  test("move with the arrow keys, keep the game's keys, and leave a focused map's keys alone", async ({ page }) => {
    await boot(page);
    await page.evaluate(buildToStar, 2);
    const edit = page.getByRole("tab", { name: "Edit" });
    const hotel = page.getByRole("tab", { name: "Hotel" });
    const evalTab = page.getByRole("tab", { name: "Eval" });
    const legend = page.locator('#overview-map .overview-map-legend[data-view="hotel"]');
    const evalLegend = page.locator('#overview-map .overview-map-legend[data-view="eval"]');
    const pricingLegend = page.locator('#overview-map .overview-map-legend[data-view="pricing"]');
    await edit.focus();
    await page.keyboard.press("ArrowRight");
    await expect(evalTab).toBeFocused();
    await expect(evalTab).toHaveAttribute("aria-selected", "true");
    // Each view shows its own legend over the map.
    await expect(evalLegend).toBeVisible();
    await expect(legend).toBeHidden();
    await page.keyboard.press("ArrowRight");
    await expect(pricingLegend).toBeVisible();
    await expect(evalLegend).toBeHidden();
    await page.keyboard.press("End");
    await expect(hotel).toBeFocused();
    await expect(hotel).toHaveAttribute("aria-selected", "true");
    await expect(legend).toBeVisible();
    await expect(pricingLegend).toBeHidden();
    // The focus ring shows on a keyboard-focused tab.
    expect(await hotel.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Home");
    await expect(edit).toBeFocused();
    await expect(legend).toBeHidden();
    await expect(page.locator("#overview-map .overview-map-legend:visible")).toHaveCount(0);
    // A build key on a focused tab stays out of the world.
    const cursor = () => page.evaluate(() => (window as any).game.keyboard.cursor());
    await page.click('.pal-item[data-kind="office"]');
    await edit.focus();
    await page.keyboard.press("d");
    await nextFrames(page);
    expect(await cursor()).toBeNull();
    // A click on a tab leaves a focused map focused, so its arrow keys still
    // move the view.
    const map = page.locator("#overview-map .overview-map-view");
    await map.focus();
    await hotel.click();
    await expect(hotel).toHaveAttribute("aria-selected", "true");
    await expect(map).toBeFocused();
    const before = await page.evaluate(() => (window as any).game.engine.viewState().floor);
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => page.evaluate(() => (window as any).game.engine.viewState().floor)).toBeGreaterThan(before);
  });

  test("with the tabs, the open map still clears the sidebar, the palette and the heatmap legend", async ({ page }) => {
    for (const size of [
      { width: 768, height: 600 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(size);
      await boot(page);
      await expect(page.getByRole("tablist", { name: "Map views" })).toBeVisible();
      const overlapping = await page.evaluate(() => {
        const map = document.getElementById("overview-map")!.getBoundingClientRect();
        const view = document.getElementById("view")!.getBoundingClientRect();
        const others: Record<string, DOMRect> = { legend: new DOMRect(view.left + 12, view.top + 12, 150, 62) };
        for (const id of ["sidebar", "palette", "overlay-mode", "hint"]) {
          const r = document.getElementById(id)?.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) others[id] = r;
        }
        const hit = (r: DOMRect) => r.right > map.left && r.left < map.right && r.bottom > map.top && r.top < map.bottom;
        return Object.keys(others).filter((k) => hit(others[k]));
      });
      expect(overlapping, `${size.width}x${size.height}`).toEqual([]);
    }
  });

  test("the Hotel view marks the rooms the engine turned dirty within a game hour", async ({ page }) => {
    await boot(page);
    await page.evaluate(foundHotelTower, HOTEL_ROOMS);
    await page.getByRole("tab", { name: "Hotel" }).click();
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
    await page.getByRole("tab", { name: "Edit" }).click();
    await expect.poll(() => redPixels(page)).toBe(0);
  });
  test("the Pricing view colors the rooms by the engine's rent tiers and follows a rent command at once", async ({ page }) => {
    await boot(page);
    await page.evaluate(foundHotelTower, HOTEL_ROOMS);
    await page.getByRole("tab", { name: "Pricing" }).click();
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
    await page.getByRole("tab", { name: "Eval" }).click();
    const evalLegend = page.locator('#overview-map .overview-map-legend[data-view="eval"]');
    await expect(evalLegend).toBeVisible();
    await expect(evalLegend).toHaveText(/^Excellent: \d+Good: \d+Terrible: \d+$/);
    const rated = (await evalLegend.textContent())!.match(/\d+/g)!.reduce((sum, n) => sum + Number(n), 0);
    expect(rated).toBeGreaterThan(0);
  });
});

test.describe("map view tabs on a phone", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("are one slim row of tabs, so the map keeps its size, upright and on its side", async ({ page }) => {
    for (const size of [PHONE, { width: PHONE.height, height: PHONE.width }]) {
      await page.setViewportSize(size);
      await boot(page);
      if (await page.locator("#overview-map").isHidden()) await page.locator("#btn-map").tap();
      const list = page.getByRole("tablist", { name: "Map views" });
      await expect(list).toBeVisible();
      const got = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll("#overview-map [role=tab]")].map((el) => el.getBoundingClientRect().toJSON()),
        body: document.querySelector("#overview-map .overview-map-body")!.getBoundingClientRect().toJSON(),
        map: document.getElementById("overview-map")!.getBoundingClientRect().height,
        stageHeight: document.getElementById("stage")!.getBoundingClientRect().height,
      }));
      const at = `${size.width}x${size.height}`;
      expect(got.tabs, at).toHaveLength(4);
      for (const b of got.tabs) {
        // One row of targets past WCAG 2.5.8's 24 px minimum, and no taller.
        expect(b.top, at).toBe(got.tabs[0].top);
        expect(b.height, at).toBeGreaterThanOrEqual(28);
        expect(b.height, at).toBeLessThan(34);
        expect(b.width, at).toBeGreaterThanOrEqual(24);
      }
      // The landscape Map keeps its S5 two-thirds allowance; upright it stays within half the view.
      const maxHeight = size.width > size.height ? got.stageHeight * 0.66 : got.stageHeight / 2;
      expect(got.map, at).toBeLessThanOrEqual(maxHeight + 1);
      // Upright, the map body keeps its full 150 by 216 card.
      if (size.height > size.width) expect(got.body.height, at).toBeGreaterThanOrEqual(214);
    }
    await page.getByRole("tab", { name: "Hotel" }).tap();
    await expect(page.getByRole("tab", { name: "Hotel" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('#overview-map .overview-map-legend[data-view="hotel"]')).toBeVisible();
  });
});
