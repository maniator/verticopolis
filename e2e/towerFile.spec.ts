import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * A tower is a document (#2380, NO LOST SAVES): the tower being played lives
 * in its own My Towers file, the autosave and File > Save write that file,
 * and My Towers keeps its earlier versions.
 *
 * Real saves only: the site storage the live 4.2.0 game wrote (an Auto-save
 * and two slots that My Towers copies in). Each test checks the file opens
 * to the identical game the player left.
 */
test.setTimeout(120_000);
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });

const OLD: Record<string, string> = JSON.parse(
  readFileSync(new URL("./fixtures/storage-4.2.json", import.meta.url), "utf8"),
);
/** The Auto-save's own file: My Towers holds a "Tower One" already (4.2's second slot). */
const OWN = "Tower One (2)";

async function seed(page: Page): Promise<void> {
  await page.addInitScript((seeded) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [key, value] of Object.entries(seeded)) localStorage.setItem(key, value);
  }, OLD);
}

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => !!window.game && !!window.__vcEngine?.status?.hosted, undefined, {
    timeout: 30_000,
  });
  await expect(page.locator('[data-splash="continue"]'), "the title screen offers Continue").toBeVisible();
}

async function continueTower(page: Page): Promise<void> {
  await page.locator('[data-splash="continue"]').click();
  await page.waitForFunction(() => window.game.enginePort.towerName() === "Tower One", undefined, {
    timeout: 15_000,
  });
}

async function fileMenu(page: Page, item: RegExp): Promise<void> {
  await page.locator("#menubar .mb-title", { hasText: "File" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function openWindow(page: Page): Promise<void> {
  await fileMenu(page, /^Open…/);
  await expect(page.locator(".fd")).toBeVisible();
}

const rowNames = (page: Page) => page.locator(".fd-row .fd-name-cell").allTextContents();
const row = (page: Page, name: string) =>
  page.locator(".fd-row", {
    has: page.locator(".fd-name-cell", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }),
  });

/** Open the row called `name` in the Open window, and wait for its tower. */
async function openRow(page: Page, name: string): Promise<void> {
  const before = await page.evaluate(() => window.game.enginePort.generation());
  await openWindow(page);
  await expect.poll(() => rowNames(page), { timeout: 15_000 }).toContain(name);
  await row(page, name).dblclick();
  await expect(page.locator(".fd")).toBeHidden();
  await page.waitForFunction((g) => window.game.enginePort.generation() !== g, before, { timeout: 15_000 });
}

/** The live tower as the engine saves it, without the write's own stamp. */
async function towerState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const g = window.game;
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
    const g = window.game;
    g.setSpeed(3);
    return g.reader.header.minutes as number;
  });
  await page.waitForFunction((m) => window.game.reader.header.minutes > m + 30, start, { timeout: 45_000 });
  await page.evaluate(() => window.game.setSpeed(0));
}

/** Right-click `name` in the Open window and open its Previous Versions window. */
async function previousVersions(page: Page, name: string): Promise<void> {
  await openWindow(page);
  await expect.poll(() => rowNames(page), { timeout: 15_000 }).toContain(name);
  await row(page, name).click({ button: "right" });
  await page.locator(".fd-menu").getByRole("menuitem", { name: "Previous versions…" }).click();
  await expect(page.locator("#modal .modal-box > .pv")).toBeVisible();
}

test("the autosave writes the tower's own file, and after a reload it opens to the identical game", async ({
  page,
}) => {
  await seed(page);
  await boot(page);
  await continueTower(page);
  await play(page);
  await page.evaluate(() => window.game.saveLoad.autosave());
  const left = await towerState(page);
  await previousVersions(page, OWN);
  await expect(
    page.locator(".pv-row .pv-how"),
    "the autosave reached the file and kept a version, after the file as it first was",
  ).toHaveText(["Autosaved", "Original"]);

  await page.reload();
  await boot(page);
  await openWindow(page);
  await expect.poll(() => rowNames(page), { timeout: 15_000 }).toEqual([OWN, "Tower One", "My Old Slot One"]);
  await page.locator(".fd .btn", { hasText: "Cancel" }).click();
  await openRow(page, "My Old Slot One");
  await openRow(page, OWN);
  expect(await towerState(page), "the tower's file is the tower that was left, to the minute").toEqual(left);
});

test("File > Save keeps a version by hand, and Previous versions… opens it as a new file", async ({ page }) => {
  await seed(page);
  await boot(page);
  await continueTower(page);
  await play(page);
  await fileMenu(page, /^Save(?! As)/);
  await expect(page.locator(".toast", { hasText: `Saved "${OWN}" in My Towers.` })).toBeVisible();
  const saved = await towerState(page);
  await play(page);

  await previousVersions(page, OWN);
  await expect(page.locator(".pv-row .pv-how").first(), "the newest version is the one saved by hand").toHaveText(
    "Saved by you",
  );
  await page.locator(".pv-row").first().click();
  const before = await page.evaluate(() => window.game.enginePort.generation());
  await page.locator(".pv-buttons .btn", { hasText: "Open" }).click();
  await page.waitForFunction((g) => window.game.enginePort.generation() !== g, before, { timeout: 15_000 });
  expect(await towerState(page), "the version is the tower as it was saved").toEqual(saved);
  await openWindow(page);
  await expect.poll(() => rowNames(page), { timeout: 15_000 }).toContain(OWN);
  expect(
    (await rowNames(page)).some((n) => n.startsWith(`${OWN} (`)),
    "the version is a new file beside the tower",
  ).toBe(true);
});

test("opening a 4.2 save slot's file keeps it as it was, and Previous versions… brings that original back", async ({
  page,
}) => {
  await seed(page);
  await boot(page);
  await openRow(page, "My Old Slot One");
  const opened = await towerState(page);
  // Play on and save, so the file now holds a later game than the 4.2 slot.
  await play(page);
  await fileMenu(page, /^Save(?! As)/);
  await expect(page.locator(".toast", { hasText: 'Saved "My Old Slot One" in My Towers.' })).toBeVisible();

  await previousVersions(page, "My Old Slot One");
  const original = page.locator(".pv-row", { has: page.locator(".pv-how", { hasText: "Original" }) });
  await expect(original, "the file as 4.2 left it is kept").toHaveCount(1);
  await original.click();
  const before = await page.evaluate(() => window.game.enginePort.generation());
  await page.locator(".pv-buttons .btn", { hasText: "Open" }).click();
  await page.waitForFunction((g) => window.game.enginePort.generation() !== g, before, { timeout: 15_000 });
  expect(await towerState(page), "the original opens to the game the 4.2 slot held").toEqual(opened);
});
