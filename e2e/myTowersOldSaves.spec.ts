/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * A player's towers from before My Towers reach the Open window (#2325). The
 * fixture is the site storage the live 4.2.0 game wrote, as it stood: an
 * Auto-save, slot 1 named "My Old Slot One" with Rename…, and slot 2 with no
 * name. My Towers copies the slots in once and keeps the old keys for a
 * rollback. The Auto-save's tower gets a file of its own under its name
 * (#2380), numbered here since slot 2 holds a "Tower One" already, and the
 * Auto-save stays where it was as the game's crash copy.
 *
 * The second test is the staging report of 2026-11-15: the first time My
 * Towers opened on a phone it took a moment, File > Open… fell back to the
 * phone's own file picker meanwhile, and none of the player's towers showed.
 */
test.setTimeout(90_000);
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });

const OLD: Record<string, string> = JSON.parse(
  readFileSync(new URL("./fixtures/storage-4.2.json", import.meta.url), "utf8"),
);
const SLOT_KEYS = ["simtower-clone-slot-1", "simtower-clone-slot-2"];
/** The Open window's rows, newest first: the Auto-save's own file, then slot
 *  2 (unnamed, under its tower's name, saved after slot 1). */
const LISTED = ["Tower One (2)", "Tower One", "My Old Slot One"];
const AUTO_KEY = "verticopolis-save";

/** Seed the 4.2 storage once, before the page's own scripts. */
async function seed(page: Page): Promise<void> {
  await page.addInitScript((seeded) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [key, value] of Object.entries(seeded)) localStorage.setItem(key, value);
  }, OLD);
}

/** Load the game and wait for the title screen on the Rust engine. */
async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngine?.status?.hosted, undefined, {
    timeout: 30_000,
  });
  await expect(page.locator('[data-splash="continue"]'), "the title screen offers Continue").toBeVisible();
}

async function openWindow(page: Page): Promise<void> {
  await page.locator("#menubar .mb-title", { hasText: "File" }).click();
  await page.getByRole("menuitem", { name: /^Open…/ }).click();
  await expect(page.locator(".fd")).toBeVisible();
}

const rowNames = (page: Page) => page.locator(".fd-row .fd-name-cell").allTextContents();

test("4.2's Auto-save and save slots show in the Open window as files, and the old keys stay", async ({ page }) => {
  await seed(page);
  await boot(page);
  await openWindow(page);
  await expect.poll(() => rowNames(page)).toEqual(LISTED);
  await expect(page.locator(".fd-row", { hasText: "Auto-save" }), "no Auto-save row").toHaveCount(0);
  await expect(page.locator(".fd-usage"), "the header counts the Auto-save's file with the copied slots").toHaveText(
    /^3 towers, /,
  );
  expect(
    await page.evaluate((keys) => keys.map((k) => localStorage.getItem(k)), [...SLOT_KEYS, AUTO_KEY]),
    "the old keys are kept for a rollback",
  ).toEqual([...SLOT_KEYS, AUTO_KEY].map((k) => OLD[k]));

  // The copy runs once: after a reload the list is the same, with no second copies.
  await page.reload();
  await boot(page);
  await openWindow(page);
  await expect.poll(() => rowNames(page)).toEqual(LISTED);

  // A copied slot opens as a tower.
  await page.locator(".fd-row", { hasText: "My Old Slot One" }).dblclick();
  await expect(page.locator(".fd")).toBeHidden();
  await page.waitForFunction(() => (window as any).game.enginePort.towerName() === "Tower One", undefined, {
    timeout: 10_000,
  });
});

test("File > Open… shows the window while My Towers is still opening, and fills it in", async ({ page }) => {
  await seed(page);
  // Hold the first open of My Towers' database until the test lets it go, as
  // a slow phone does. (A fixed delay raced a slow CI boot.)
  await page.addInitScript(() => {
    const real = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((name: string, version?: number) => {
      if (name !== "verticopolis-files") return real(name, version);
      const held: Record<string, unknown> = {};
      let req: IDBOpenDBRequest | null = null;
      (window as any).__releaseMyTowers = () => {
        req = real(name, version);
        for (const event of ["onupgradeneeded", "onsuccess", "onerror", "onblocked"])
          (req as any)[event] = (e: Event) => (held[event] as ((e: Event) => void) | undefined)?.call(req, e);
      };
      return new Proxy(held, {
        get: (t, k) => (k === "result" ? req?.result : k === "error" ? req?.error : t[k as string]),
      }) as unknown as IDBOpenDBRequest;
    }) as typeof indexedDB.open;
  });
  let picker = false;
  page.on("filechooser", () => (picker = true));
  await boot(page);
  await openWindow(page);
  expect(picker, "the device's picker did not open in place of the window").toBe(false);
  await expect(page.locator(".fd-usage")).toHaveText("Opening My Towers…");
  await expect(page.locator(".fd-primary")).toBeDisabled();
  expect(await rowNames(page), "nothing is listed until My Towers opens").toEqual([]);
  await page.evaluate(() => (window as any).__releaseMyTowers());
  await expect.poll(() => rowNames(page), { timeout: 15_000 }).toEqual(LISTED);
  await expect(page.locator(".fd-primary")).toBeEnabled();
});
