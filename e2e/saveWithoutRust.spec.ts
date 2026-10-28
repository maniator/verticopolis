/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { test, expect, type Page } from "@playwright/test";
import { WASM_PROJECT } from "./helpers";

/**
 * Saves with no Rust engine at all (#1422, owner 2026-10-28): the engine
 * package cannot be fetched, so the boot that asked for Rust runs the
 * TypeScript engine, and that engine must keep every save path working on
 * its own. It loads the autosave, plays, saves and reloads; it loads a save
 * from an older version; a failed import leaves the tower alone; an
 * unreadable autosave is kept, not overwritten, and downloads as it was
 * stored; and the tower still downloads as a file.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== WASM_PROJECT, "one switchable project is enough"));
test.setTimeout(90_000);
// No stored engine choice, and no service worker that could serve a cached package.
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });

const AUTO_KEY = "verticopolis-save";
const LEGACY_AUTO_KEY = "simtower-clone-save";
const UNREADABLE_KEY = "simtower-clone-unreadable";
/** A save from save format version 1, in the file container. */
const OLD_FILE = readFileSync(new URL("../conformance/fixtures/towerone-star1.vctower", import.meta.url), "utf8");
const OLD_SAVE = inflateRawSync(Buffer.from(OLD_FILE.split("\n")[1]!, "base64")).toString();

/** The engine package is unavailable: every request for it fails. */
async function noEnginePackage(page: Page): Promise<void> {
  await page.route(/\/engine\//, (route) => route.abort());
}

/** Load `url` and wait for the game, returning what boot ran. */
async function boot(page: Page, url: string): Promise<{ engine: string; failedAt: string | null }> {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngineBoot, undefined, { timeout: 30_000 });
  return page.evaluate(() => {
    const b = (window as any).__vcEngineBoot;
    return { engine: b.engine as string, failedAt: (b.failure?.stage as string | undefined) ?? null };
  });
}

/** Play until the clock passes `after`, pause, and save; returns the saved time. */
async function playAndSave(page: Page, after: number): Promise<number> {
  await page.evaluate(() => {
    const g = (window as any).game;
    g.onboarding.dismissSplash();
    g.setSpeed(3);
  });
  await page.waitForFunction((m) => (window as any).game.reader.header.minutes > m, after, { timeout: 30_000 });
  return page.evaluate(() => {
    const g = (window as any).game;
    g.setSpeed(0);
    g.saveLoad.save(true);
    return g.reader.header.minutes as number;
  });
}

const clockReads = (page: Page, minutes: number) =>
  page.waitForFunction((m) => (window as any).game.reader.header.minutes === m, minutes, { timeout: 10_000 });

test("the TypeScript engine loads the autosave, plays, saves, reloads and downloads it with no Rust package", async ({ page }) => {
  await noEnginePackage(page);
  expect(await boot(page, "/")).toMatchObject({ engine: "ts" });
  const first = await playAndSave(page, 0);
  // Asking for Rust fails to load the package, so the boot runs TypeScript.
  expect(await boot(page, "/?engine=wasm")).toEqual({ engine: "ts", failedAt: "load" });
  await clockReads(page, first);
  const second = await playAndSave(page, first);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).game, undefined, { timeout: 30_000 });
  await clockReads(page, second);
  // The tower still downloads as a .vctower file.
  const [download] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => (window as any).game.saveLoad.exportGame())]);
  const file = readFileSync((await download.path())!, "utf8");
  expect(file.startsWith("VCTOWER1\n")).toBe(true);
});

test("an older version's autosave loads, a failed import changes nothing, and an older file imports", async ({ page }) => {
  await noEnginePackage(page);
  const old = JSON.parse(OLD_SAVE) as { version: number; money: number };
  expect(old.version).toBe(1);
  await page.addInitScript(
    ([key, save]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem(key, save);
    },
    [LEGACY_AUTO_KEY, OLD_SAVE],
  );
  expect(await boot(page, "/?engine=wasm")).toEqual({ engine: "ts", failedAt: "load" });
  await page.waitForFunction((money) => (window as any).game.reader.header.money === money, old.money, { timeout: 10_000 });
  await page.evaluate(() => (window as any).game.onboarding.dismissSplash());
  const before = await page.evaluate(() => (window as any).game.reader.header.minutes as number);
  await page.evaluate(() => (window as any).game.saveLoad.importGame("not a tower"));
  await expect(page.getByText(/Import failed/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).game.reader.header.minutes)).toBe(before);
  // The same older tower as a file imports through the TypeScript engine.
  await page.evaluate((text) => (window as any).game.saveLoad.importGame(text), OLD_FILE);
  await expect(page.getByText("Tower imported.")).toBeVisible();
  await page.waitForFunction((money) => (window as any).game.reader.header.money === money, old.money, { timeout: 10_000 });
});

test("an unreadable autosave is kept, not overwritten, and downloads as it was stored", async ({ page }) => {
  await noEnginePackage(page);
  const unreadable = "VCTOWER1\nnot a tower this version can read";
  await page.addInitScript(
    ([key, raw]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem(key, raw);
    },
    [AUTO_KEY, unreadable],
  );
  expect(await boot(page, "/?engine=wasm")).toEqual({ engine: "ts", failedAt: "load" });
  expect(await page.evaluate((k) => localStorage.getItem(k), UNREADABLE_KEY)).toBe(unreadable);
  // A new tower saves over the autosave slot, and the kept copy stays.
  await playAndSave(page, 0);
  expect(await page.evaluate((k) => localStorage.getItem(k), UNREADABLE_KEY)).toBe(unreadable);
  // The kept text downloads from Saved Towers exactly as it was stored.
  await page.evaluate(() => (window as any).game.showSaves());
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download unreadable save" }).click()]);
  expect(download.suggestedFilename()).toBe("verticopolis-unreadable-save.txt");
  expect(readFileSync((await download.path())!, "utf8")).toBe(unreadable);
});
