/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Opening another tower never loses the one being left (owner, 2026-11-16,
 * NO LOST SAVES). Before, the swap's autosave wrote the new tower over the
 * only copy of the old one: "Harmony Tower 2.0" was lost that way.
 *
 * Real saves only: the site storage the live 4.2.0 game wrote (an Auto-save
 * and two slots that My Towers copies in), and a player's tower file from the
 * conformance fixtures. Each test leaves a tower by a real path, opens the
 * kept file from My Towers and checks it is the identical game.
 */
test.setTimeout(120_000);
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });

const OLD: Record<string, string> = JSON.parse(readFileSync(new URL("./fixtures/storage-4.2.json", import.meta.url), "utf8"));
/** A player's tower, as a `.vctower` file. */
const SPLIT_TOWER = readFileSync(new URL("../conformance/fixtures/split-tower.vctower", import.meta.url), "utf8");

async function seed(page: Page): Promise<void> {
  await page.addInitScript((seeded) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [key, value] of Object.entries(seeded)) localStorage.setItem(key, value);
  }, OLD);
}

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngine?.status?.hosted, undefined, { timeout: 30_000 });
  await expect(page.locator('[data-splash="continue"]'), "the title screen offers Continue").toBeVisible();
}

async function openWindow(page: Page): Promise<void> {
  await page.locator("#menubar .mb-title", { hasText: "File" }).click();
  await page.getByRole("menuitem", { name: /^Open…/ }).click();
  await expect(page.locator(".fd")).toBeVisible();
}

const rowNames = (page: Page) => page.locator(".fd-row .fd-name-cell").allTextContents();

/** Open the row called `name` in the Open window, and wait for its tower. */
async function openRow(page: Page, name: string): Promise<void> {
  const before = await page.evaluate(() => (window as any).game.enginePort.generation());
  await openWindow(page);
  await expect.poll(() => rowNames(page), { timeout: 15_000 }).toContain(name);
  await page.locator(".fd-row", { has: page.locator(".fd-name-cell", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) }).dblclick();
  await expect(page.locator(".fd")).toBeHidden();
  await page.waitForFunction((g) => (window as any).game.enginePort.generation() !== g, before, { timeout: 15_000 });
}

/** The live tower as the engine saves it, without the write's own stamp. */
async function towerState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const g = (window as any).game;
    g.setSpeed(0);
    const save = JSON.parse(g.enginePort.serialize());
    delete save.savedAt;
    delete save.appVersion;
    return save;
  });
}

/** Play the live tower on until its clock passes a few more minutes, then pause. */
async function play(page: Page): Promise<void> {
  const start = await page.evaluate(() => {
    const g = (window as any).game;
    g.setSpeed(3);
    return g.reader.header.minutes as number;
  });
  await page.waitForFunction((m) => (window as any).game.reader.header.minutes > m + 30, start, { timeout: 45_000 });
  await page.evaluate(() => (window as any).game.setSpeed(0));
}

test("opening a file keeps the tower being played, unsaved minutes and all, and it opens back the same", async ({ page }) => {
  await seed(page);
  await boot(page);
  await page.locator('[data-splash="continue"]').click();
  await page.waitForFunction(() => (window as any).game.enginePort.towerName() === "Tower One", undefined, { timeout: 15_000 });
  // Minutes no save holds: before the fix they were lost with the Auto-save.
  await play(page);
  const left = await towerState(page);

  await openRow(page, "My Old Slot One");
  // My Towers already holds a "Tower One" (4.2's second slot), so the kept tower is numbered.
  await expect(page.locator(".toast", { hasText: 'Kept your last tower in My Towers as "Tower One (2)".' })).toBeVisible();

  await openRow(page, "Tower One (2)");
  expect(await towerState(page), "the kept file is the tower that was left, to the minute").toEqual(left);
});

test("starting a new tower keeps a player's opened tower in its own file, played on since", async ({ page }) => {
  await seed(page);
  await boot(page);
  await page.locator('[data-splash="continue"]').click();
  await page.waitForFunction(() => (window as any).game.enginePort.towerName() === "Tower One", undefined, { timeout: 15_000 });
  // Bring in a player's tower from a file, as From a file on your computer… does; it is kept in My Towers.
  await page.evaluate((text) => (window as any).game.saveLoad.importGame(text), SPLIT_TOWER);
  const name = await page.evaluate(() => (window as any).game.enginePort.towerName() as string);
  await page.evaluate(() => (window as any).game.saveFile((window as any).game.enginePort.towerName()));
  await play(page);
  const left = await towerState(page);

  await page.evaluate(() => (window as any).game.saveLoad.newGame("modern"));
  await expect(page.locator(".toast", { hasText: `Saved "${name}" in My Towers.` })).toBeVisible();

  await openRow(page, name);
  expect(await towerState(page), "its own file now holds the minutes played since it was saved").toEqual(left);
});

test("opening a file from the title screen keeps the Auto-save's tower, the one Continue brings back", async ({ browser }) => {
  // What Continue loads, read in a page of its own.
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });
  const first = await ctx.newPage();
  await seed(first);
  await boot(first);
  await first.locator('[data-splash="continue"]').click();
  await first.waitForFunction(() => (window as any).game.enginePort.towerName() === "Tower One", undefined, { timeout: 15_000 });
  const continued = await towerState(first);
  await ctx.close();

  const ctx2 = await browser.newContext({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });
  const page = await ctx2.newPage();
  await seed(page);
  await boot(page);
  await openRow(page, "My Old Slot One");
  await expect(page.locator(".toast", { hasText: 'Kept your last tower in My Towers as "Tower One (2)".' })).toBeVisible();
  await openRow(page, "Tower One (2)");
  expect(await towerState(page), "the kept file is the Auto-save's tower").toEqual(continued);
  await ctx2.close();
});
