/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

/**
 * The elevator schedule review (#1548), end to end on a phone-sized screen. An older tower (the
 * unmodified `split-tower-4` fixture) holds three elevators whose flat schedule keeps most installed
 * cars off shift. The player imports it, is told once, opens the review from Tower Statistics, sets
 * one elevator to use all its cars, and undoes that. Nothing changes until the player chooses it.
 */
const TOWER = readFileSync(new URL("../conformance/fixtures/split-tower-4.vctower", import.meta.url), "utf8");
const SHAFT = 1139; // a standard elevator with 8 cars and a flat schedule of 3
const PHONE = { width: 390, height: 844 };

/** The weekday hours of a shaft's schedule: the port's slots hold a row flag, then 24 hourly car counts. */
const weekday = (page: Page, id: number) =>
  page.evaluate((shaft) => Array.from((window as any).game.enginePort.shaftSchedule(shaft) as Float64Array).slice(1, 25), id);

// A 75-floor tower on a software-rendered phone-sized page draws slowly, and each click waits on frames.
test.setTimeout(120_000);

test("an older tower's idle elevator cars are reviewed, recovered and undone on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).game, undefined, {
    timeout: 30_000,
  });
  await page.evaluate((text) => {
    const g = (window as any).game;
    g.onboarding.dismissSplash();
    g.setSpeed(0);
    return g.saveLoad.importGame(text);
  }, TOWER);
  await expect(page.getByText("Tower imported.")).toBeVisible();

  // The tower is mentioned once, and nothing has been rewritten.
  await expect(page.getByText(/have more cars than their schedules put on shift/)).toBeVisible();
  expect(await weekday(page, SHAFT)).toEqual(Array(24).fill(3));

  // Tower Statistics offers the review; the dialog lists the three elevators.
  await page.evaluate(() => (window as any).game.showStats());
  await page.getByRole("button", { name: /Review elevator schedules/ }).click();
  const rows = page.locator(".sched-review-row");
  await expect(rows).toHaveCount(3);

  // Every control is on screen and reachable on a phone: no sideways scroll, and each button is inside the viewport.
  const modal = page.locator("#modal");
  expect(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const button of await rows.first().getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    expect(box.height).toBeGreaterThanOrEqual(40);
  }

  // Use all installed cars on the first elevator: it runs the full fleet, and the others are untouched.
  await rows.first().getByRole("button", { name: "Use all installed cars" }).click();
  expect(await weekday(page, SHAFT)).toEqual(Array(24).fill(8));
  expect(await weekday(page, 1735)).toEqual(Array(24).fill(3));
  await expect(rows).toHaveCount(2);

  // Undo puts the schedule back exactly, and the review lists the elevator again.
  await page.evaluate(() => (window as any).game.undo());
  expect(await weekday(page, SHAFT)).toEqual(Array(24).fill(3));
  await modal.locator('[data-act="close"]').click();
  await page.evaluate(() => (window as any).game.showStats());
  await page.getByRole("button", { name: /Review elevator schedules/ }).click();
  await expect(page.locator(".sched-review-row")).toHaveCount(3);
  await expectEngineHosted(page);
});
