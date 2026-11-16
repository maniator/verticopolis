/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * File > Open Recent (owner, 2026-11-16) on the real engine: the towers
 * opened or saved last, newest first, opened through the Open window's own
 * path, kept across a reload, and a gone file handled. The linked folder's
 * picker is stood in for by a folder in the page's private file system, as
 * in `linkedFolder.spec.ts`, and each test runs in its own on-disk profile
 * for the same reason (a kept folder handle crashes an incognito profile).
 */
test.setTimeout(90_000);

const FOLDER = "Verticopolis Towers";
let ctx: BrowserContext;
let dir: string;

test.beforeEach(async ({ baseURL }) => {
  dir = mkdtempSync(join(tmpdir(), "vc-recent-"));
  ctx = await chromium.launchPersistentContext(dir, {
    baseURL,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  });
  await ctx.addInitScript((name) => {
    (window as any).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
  }, FOLDER);
});

test.afterEach(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngine?.status?.hosted, undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    document.getElementById("splash")?.remove();
    document.getElementById("onboard")?.remove();
  });
}

/** Open File > Open Recent and answer the lines it shows. */
async function recentLines(page: Page): Promise<string[]> {
  await page.keyboard.press("Escape");
  await page.locator("#menubar .mb-title", { hasText: "File" }).click();
  await page.locator("#mb-recent").click();
  await expect(page.locator("#mb-recent-menu")).toBeVisible();
  return page.locator("#mb-recent-menu .mb-item:not([hidden])").allTextContents();
}

const generation = (page: Page) => page.evaluate(() => (window as any).game.enginePort.generation() as number);

async function waitForNewTower(page: Page, before: number): Promise<void> {
  await page.waitForFunction((gen) => (window as any).game.enginePort.generation() !== gen, before, { timeout: 10_000 });
}

test("lists the towers saved last, newest first, opens one by mouse or by its number, and keeps the list after a reload", async () => {
  const page = await ctx.newPage();
  await boot(page);
  expect(await recentLines(page)).toEqual(["No recent towers"]);

  await page.evaluate(async () => {
    await (window as any).game.saveFile("Alpha");
    await (window as any).game.saveFile("Beta");
  });
  expect(await recentLines(page)).toEqual(["1Beta", "2Alpha"]);

  // A pick opens the tower as its Open window row would, and puts it on top.
  let before = await generation(page);
  await page.locator("#mb-recent-2").click();
  await waitForNewTower(page, before);
  await expect(page.locator("#mb-file-menu")).toBeHidden();
  expect(await recentLines(page)).toEqual(["1Alpha", "2Beta"]);

  await page.reload();
  await boot(page);
  expect(await recentLines(page), "the list is kept on the device").toEqual(["1Alpha", "2Beta"]);

  // The keyboard: Right opens the list, and a line's number picks it.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+f");
  await page.locator("#mb-recent").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#mb-recent-menu")).toBeVisible();
  before = await generation(page);
  await page.keyboard.press("2");
  await waitForNewTower(page, before);
  expect(await recentLines(page)).toEqual(["1Beta", "2Alpha"]);
});

test("a tower deleted from My Towers drops off the list, and the other towers stay", async () => {
  const page = await ctx.newPage();
  await boot(page);
  await page.evaluate(async () => {
    await (window as any).game.saveFile("Keep");
    await (window as any).game.saveFile("Gone");
  });
  await page.keyboard.press("Escape");
  await page.locator("#menubar .mb-title", { hasText: "File" }).click();
  await page.getByRole("menuitem", { name: /^Open…/ }).click();
  await page.locator(".fd-row", { hasText: "Gone" }).click();
  await page.locator(".fd button", { hasText: "Delete" }).click();
  await page.locator('[data-fd-ask="yes"]').click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".fd")).toBeHidden();
  expect(await recentLines(page)).toEqual(["1Keep"]);
});

test("a linked folder's tower is listed by its file name, and one gone from the folder says so and drops off", async () => {
  const page = await ctx.newPage();
  await boot(page);
  await page.locator("#menubar .mb-title", { hasText: "File" }).click();
  await page.getByRole("menuitem", { name: /^Save As/ }).click();
  await page.locator(".fd-look").click();
  await page.locator(".fd-look-item", { hasText: "Link a folder" }).click();
  await page.locator("#fd-name").fill("Lake");
  await page.locator(".fd-primary").click();
  await expect(page.locator(".fd")).toBeHidden();
  expect(await recentLines(page)).toEqual(["1Lake.vctower"]);

  // Moved away on the player's computer since the list was made.
  await page.keyboard.press("Escape");
  await page.evaluate(async (name) => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    await folder.removeEntry("Lake.vctower");
  }, FOLDER);
  const before = await generation(page);
  await recentLines(page);
  await page.locator("#mb-recent-1").click();
  await expect(page.getByText(/"Lake\.vctower" isn't in the folder any more/)).toBeVisible();
  expect(await generation(page), "no tower was swapped in").toBe(before);
  expect(await recentLines(page)).toEqual(["No recent towers"]);
});
