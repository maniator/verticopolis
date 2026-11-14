/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

/**
 * Buying a car on a shaft with a schedule, end to end (#1546). The unmodified `split-tower` fixture
 * holds a standard elevator with 5 cars and 3 on shift every hour. A car bought there joins no hour
 * (each is cut back), the Schedule dialog says how many cars are on shift apart from how many are
 * installed, and on a phone-sized screen its "all cars, all hours" button is on screen and puts the
 * whole fleet on every hour of both day types.
 */
const TOWER = readFileSync(new URL("../conformance/fixtures/split-tower.vctower", import.meta.url), "utf8");
const SHAFT = 1139;
const PHONE = { width: 390, height: 844 };

/** A day's hours of a shaft's schedule: the port's slots hold a row flag, then 24 weekday counts, a flag, then 24 weekend counts. */
const hours = (page: Page, id: number, day: "weekday" | "weekend") =>
  page.evaluate(
    ({ shaft, from }) => Array.from((window as any).game.enginePort.shaftSchedule(shaft) as Float64Array).slice(from, from + 24),
    { shaft: id, from: day === "weekday" ? 1 : 26 },
  );

test.setTimeout(120_000);

test("a car bought on a scheduled shaft keeps the cut-back hours, and the dialog runs every car on a phone", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).game, undefined, { timeout: 30_000 });
  await page.evaluate((text) => {
    const g = (window as any).game;
    g.onboarding.dismissSplash();
    g.setSpeed(0);
    return g.saveLoad.importGame(text);
  }, TOWER);
  await expect(page.getByText("Tower imported.")).toBeVisible();
  expect(await hours(page, SHAFT, "weekday")).toEqual(Array(24).fill(3));

  // Select the shaft and buy a car from its card.
  await page.evaluate((id) => {
    const g = (window as any).game;
    g.selected = { type: "transport", id };
    g.engine.selectedId = id;
    g.refreshEditor();
  }, SHAFT);
  await page.click('#editor [data-edit="addcar"]');
  await expect(page.locator('#editor [data-field="cars"]')).toContainText("6 / 8 max");
  // Every hour was cut back to 3, so the new car joins none of them.
  expect(await hours(page, SHAFT, "weekday")).toEqual(Array(24).fill(3));
  expect(await hours(page, SHAFT, "weekend")).toEqual(Array(24).fill(3));

  // The dialog tells the cars on shift at the hour apart from the installed fleet.
  await page.click('#editor [data-edit="schedule"]');
  await page.waitForSelector("#modal .es-body");
  await page.setViewportSize(PHONE);
  // Modern folds the hourly strip behind Advanced.
  await page.click("#modal .es-adv summary");
  await expect(page.locator("#modal .es-fleet")).toHaveText(/^3 on shift at \d\d:00, 6 installed$/);

  // On a phone, the all-cars button is on screen without a sideways scroll, and it runs every car.
  const modal = page.locator("#modal");
  expect(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const allCars = page.locator("#modal .es-allcars");
  await expect(allCars).toHaveText("All 6 cars, all hours");
  await allCars.scrollIntoViewIfNeeded();
  const box = (await allCars.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  await allCars.click();
  await expect(page.locator("#modal .es-fleet")).toHaveText(/^6 on shift at \d\d:00, 6 installed$/);
  await page.locator('#modal [data-act="apply"]').click();
  await expect(page.locator("#modal .es-body")).toBeHidden();
  expect(await hours(page, SHAFT, "weekday")).toEqual(Array(24).fill(6));
  expect(await hours(page, SHAFT, "weekend")).toEqual(Array(24).fill(6));
  await expectEngineHosted(page);
});

test("a car sold and bought back leaves a cut-back hour as it was and fills the whole-fleet hours, each day type on its own", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).game, undefined, { timeout: 30_000 });
  await page.evaluate((text) => {
    const g = (window as any).game;
    g.onboarding.dismissSplash();
    g.setSpeed(0);
    return g.saveLoad.importGame(text);
  }, TOWER);
  await expect(page.getByText("Tower imported.")).toBeVisible();
  // Weekdays: 17:00 runs all 5 cars and the rest 3. Weekends: 09:00 is cut back to 4 and the rest run all 5.
  await page.evaluate((id) => {
    const port = (window as any).game.enginePort;
    const slots = Float64Array.from(port.shaftSchedule(id) as Float64Array);
    for (let h = 0; h < 24; h++) {
      slots[1 + h] = h === 17 ? 5 : 3;
      slots[26 + h] = h === 9 ? 4 : 5;
    }
    port.scheduleShaft(id, slots);
    const g = (window as any).game;
    g.selected = { type: "transport", id };
    g.engine.selectedId = id;
    g.refreshEditor();
  }, SHAFT);
  const weekday = Array.from({ length: 24 }, (_, h) => (h === 17 ? 5 : 3));
  const weekend = Array.from({ length: 24 }, (_, h) => (h === 9 ? 4 : 5));
  expect(await hours(page, SHAFT, "weekday")).toEqual(weekday);
  expect(await hours(page, SHAFT, "weekend")).toEqual(weekend);

  await page.click('#editor [data-edit="removecar"]');
  await expect(page.locator('#editor [data-field="cars"]')).toContainText("4 / 8 max");
  expect(await hours(page, SHAFT, "weekend")).toEqual(Array(24).fill(4));
  // Opening the Schedule window and pressing OK changes no hour, so it keeps the held one held.
  await page.click('#editor [data-edit="schedule"]');
  await page.click('#modal [data-act="apply"]');
  await expect(page.locator("#modal .es-body")).toHaveCount(0);

  // Weekend 09:00 now runs the fleet of 4 only because of the sale, so the car bought back skips it.
  await page.click('#editor [data-edit="addcar"]');
  await expect(page.locator('#editor [data-field="cars"]')).toContainText("5 / 8 max");
  expect(await hours(page, SHAFT, "weekday")).toEqual(weekday);
  expect(await hours(page, SHAFT, "weekend")).toEqual(weekend);
});
