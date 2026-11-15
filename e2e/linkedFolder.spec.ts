/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  test,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * The folder linked on the player's computer, in the Open and Save As windows
 * (`docs/architecture/linked-folder.md`). The browser's folder picker is a
 * native window a test can't click, so it is stood in for by a folder in the
 * page's private file system (OPFS), which hands out the same kind of handle.
 *
 * Each test runs in its own on-disk browser profile: Chromium crashes reading
 * a kept folder handle back from IndexedDB in an incognito profile, which is
 * what Playwright's own contexts are, and a real player's profile is on disk.
 */
test.setTimeout(90_000);

const FOLDER = "Verticopolis Towers";
let ctx: BrowserContext;
let dir: string;

test.beforeEach(async ({ baseURL }) => {
  dir = mkdtempSync(join(tmpdir(), "vc-linked-"));
  ctx = await chromium.launchPersistentContext(dir, {
    baseURL,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
    ...(process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {}),
  });
  await ctx.addInitScript((name) => {
    (window as any).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle(name, {
        create: true,
      });
  }, FOLDER);
});

test.afterEach(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Load the game with a fresh tower on the Rust engine. */
async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    () =>
      !!(window as any).game && !!(window as any).__vcEngine?.status?.hosted,
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() => {
    document.getElementById("splash")?.remove();
    document.getElementById("onboard")?.remove();
  });
}

async function fileMenu(page: Page, item: RegExp): Promise<void> {
  await page.locator("#menubar .mb-title", { hasText: "File" }).click();
  await page.getByRole("menuitem", { name: item }).click();
  await expect(page.locator(".fd")).toBeVisible();
}

/** The files in the stand-in folder on disk, by name. */
const onDisk = (page: Page) =>
  page.evaluate(async (name) => {
    const folder = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle(name);
    const names: string[] = [];
    for await (const entry of (folder as any).values()) names.push(entry.name);
    return names.sort();
  }, FOLDER);

const rowNames = (page: Page) =>
  page.locator(".fd-row .fd-name-cell").allTextContents();

test("links a folder, saves a tower into it, and lists it in Open without Delete or Rename", async () => {
  const page = await ctx.newPage();
  await boot(page);
  await fileMenu(page, /^Save As/);
  await page.locator(".fd-look").click();
  await page.locator(".fd-look-item", { hasText: "Link a folder" }).click();
  await expect(page.locator(".fd-look-now")).toContainText(FOLDER);

  await page.locator("#fd-name").fill("Linked One");
  await page.locator(".fd-primary").click();
  await expect(page.locator(".fd")).toBeHidden();
  expect(
    await onDisk(page),
    "the tower is a .vctower file in the folder",
  ).toEqual(["Linked One.vctower"]);

  // Save As remembered the folder, and the Open window starts there too.
  await fileMenu(page, /^Open/);
  await expect(page.locator(".fd-look-now")).toContainText(FOLDER);
  await expect.poll(() => rowNames(page)).toEqual(["Linked One"]);
  await page.locator(".fd-row").first().click();
  const tools = await page.locator(".fd-tools button").allTextContents();
  expect(tools.map((t) => t.trim())).not.toContain("Delete");
  expect(tools.map((t) => t.trim())).not.toContain("Rename");

  // The Delete key does nothing to a file on the player's computer.
  await page.keyboard.press("Delete");
  await expect(page.locator(".fd-ask-layer")).toHaveCount(0);
  expect(await onDisk(page)).toEqual(["Linked One.vctower"]);

  // My Towers is a separate place and gained nothing.
  await page.locator(".fd-look").click();
  await page.locator(".fd-look-item", { hasText: "My Towers" }).click();
  expect(await rowNames(page)).not.toContain("Linked One");
});

test("after a reload the folder comes back in Look in, and a tower opens from it", async () => {
  const page = await ctx.newPage();
  await boot(page);
  await fileMenu(page, /^Save As/);
  await page.locator(".fd-look").click();
  await page.locator(".fd-look-item", { hasText: "Link a folder" }).click();
  await page.locator("#fd-name").fill("Kept");
  await page.locator(".fd-primary").click();
  await expect(page.locator(".fd")).toBeHidden();

  await page.reload();
  await boot(page);
  const before = await page.evaluate(() =>
    (window as any).game.enginePort.generation(),
  );
  await fileMenu(page, /^Open/);
  await page.locator(".fd-look").click();
  await page
    .getByRole("menuitem", { name: `${FOLDER} on this computer` })
    .click();
  await expect.poll(() => rowNames(page)).toEqual(["Kept"]);
  await page.locator(".fd-row", { hasText: "Kept" }).dblclick();
  await expect(page.locator(".fd")).toBeHidden();
  await page.waitForFunction(
    (gen) => (window as any).game.enginePort.generation() !== gen,
    before,
    { timeout: 10_000 },
  );

  // Unlinking keeps the file on disk.
  await fileMenu(page, /^Open/);
  await page.locator(".fd-look").click();
  await page.locator(".fd-look-item", { hasText: "Unlink" }).click();
  await expect(page.locator(".fd-look-now")).toContainText("My Towers");
  expect(await onDisk(page)).toEqual(["Kept.vctower"]);
});
