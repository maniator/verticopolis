/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { test, expect, type Page } from "@playwright/test";
import { storedSave, storedSaves } from "./helpers";

/**
 * The save paths in a real browser on the Rust engine (#1596, from the checks
 * `saveWithoutRust.spec.ts` held while the TypeScript engine could play on):
 * an older version's autosave loads into the engine at boot; a failed import
 * leaves the tower and every stored save byte for byte alone; an unreadable
 * autosave is kept, is not overwritten by a later autosave, and downloads
 * exactly as stored; and the tower downloads as a binary `VCTOWER2` file. Any save
 * the engine's loader refuses blocks the flip to 3.0, so these stay.
 */
test.setTimeout(90_000);
// No stored state, and no service worker that could serve a cached package.
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });

const AUTO_KEY = "verticopolis-save";
const LEGACY_AUTO_KEY = "simtower-clone-save";
const UNREADABLE_KEY = "simtower-clone-unreadable";
const SLOT_1_KEY = "simtower-clone-slot-1";
/** A save from save format version 1, in the file container. */
const OLD_FILE = readFileSync(new URL("../conformance/fixtures/towerone-star1.vctower", import.meta.url), "utf8");
const OLD_SAVE = inflateRawSync(Buffer.from(OLD_FILE.split("\n")[1]!, "base64")).toString();

/** Seed browser storage once, before the page's own scripts, so a reload keeps what the game wrote. */
async function seed(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript((seeded) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [key, value] of Object.entries(seeded)) localStorage.setItem(key, value);
  }, entries);
}

/** Load `url` and wait for the game on the Rust engine. */
async function boot(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngine?.status?.hosted, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as any).__vcEngineBoot.engine)).toBe("wasm");
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

const clockReads = (page: Page, minutes: number) => page.waitForFunction((m) => (window as any).game.reader.header.minutes === m, minutes, { timeout: 10_000 });

test("the engine loads the autosave, plays, saves, reloads and downloads it as a binary VCTOWER2 file", async ({ page }) => {
  await boot(page, "/");
  const first = await playAndSave(page, 0);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngine?.status?.hosted, undefined, { timeout: 30_000 });
  await clockReads(page, first);
  const second = await playAndSave(page, first);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngine?.status?.hosted, undefined, { timeout: 30_000 });
  await clockReads(page, second);
  const [download] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => (window as any).game.saveLoad.exportGame())]);
  const file = readFileSync((await download.path())!);
  expect(file.subarray(0, 9).toString("latin1")).toBe("VCTOWER2\n");
  // The raw deflate bytes: no base64 line.
  expect(inflateRawSync(file.subarray(9)).toString().startsWith("{")).toBe(true);
  // The exported bytes load: play on, then import the file and the tower is the one that was exported.
  const exported = await page.evaluate(() => {
    const h = (window as any).game.reader.header;
    return { minutes: h.minutes as number, header: JSON.stringify(h) };
  });
  await playAndSave(page, second);
  expect(await page.evaluate(() => (window as any).game.reader.header.minutes)).toBeGreaterThan(exported.minutes);
  await page.evaluate((bytes) => (window as any).game.saveLoad.importGame(Uint8Array.from(bytes)), Array.from(file));
  await expect(page.getByText("Tower imported.")).toBeVisible();
  await clockReads(page, exported.minutes);
  expect(await page.evaluate(() => JSON.stringify((window as any).game.reader.header)), "every header figure matches the exported tower").toBe(exported.header);
});

test("the towers come back from IndexedDB after a reload, the same game", async ({ page }) => {
  await boot(page, "/");
  // A built tower, so the check covers rooms, transport and people.
  await page.evaluate((text) => (window as any).game.saveLoad.importGame(text), OLD_FILE);
  await expect(page.getByText("Tower imported.")).toBeVisible();
  const imported = await page.evaluate(() => (window as any).game.reader.header.minutes as number);
  await playAndSave(page, imported + 60);
  // A slot too, so the check covers more than the autosave.
  await page.evaluate(() => (window as any).game.saveToSlot(1));
  // The engine's whole state, parsed so a number reads the same however it was written.
  const engine = async () => JSON.parse(await page.evaluate(() => (window as any).__vcEngine.port.serialize() as string)) as unknown;
  const before = await engine();
  expect((before as { units: unknown[] }).units.length).toBeGreaterThan(0);
  const saves = await storedSaves(page);
  expect(saves[`idb:${AUTO_KEY}`], "the autosave reached IndexedDB").toBe(saves[`ls:${AUTO_KEY}`]);
  expect(saves[`idb:${SLOT_1_KEY}`], "the slot reached IndexedDB").toBe(saves[`ls:${SLOT_1_KEY}`]);
  // IndexedDB keeps the deflate bytes; the text the game reads back is the one it wrote.
  expect(saves[`idb:${AUTO_KEY}`]).toMatch(/^VCZ1:/);
  // Put another tower, with no save time, in the localStorage copies: the
  // database copy is the one with a time, so boot must take it from there.
  await page.evaluate(([keys, other]) => (keys as string[]).forEach((k) => localStorage.setItem(k, other as string)), [[AUTO_KEY, SLOT_1_KEY], OLD_SAVE] as const);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngine?.status?.hosted, undefined, { timeout: 30_000 });
  await page.evaluate(() => (window as any).game.setSpeed(0));
  expect(await engine(), "the autosave from IndexedDB is the same game").toEqual(before);
  expect(await storedSave(page, SLOT_1_KEY)).toBe(saves[`idb:${SLOT_1_KEY}`]);
  await page.evaluate(() => (window as any).game.loadFromSlot(1));
  expect(await engine(), "the slot from IndexedDB is the same game").toEqual(before);
});

test("a tower file saved by a newer version is refused and changes nothing", async ({ page }) => {
  await boot(page, "/");
  await playAndSave(page, 0);
  const before = await page.evaluate(() => (window as any).game.reader.header.minutes as number);
  const storedBefore = await storedSaves(page);
  const newer = JSON.parse(OLD_SAVE) as Record<string, unknown>;
  newer.version = 999;
  const file = `VCTOWER1\n${deflateRawSync(JSON.stringify(newer)).toString("base64")}\n`;
  await page.evaluate((text) => (window as any).game.saveLoad.importGame(text), file);
  await expect(page.getByText(/made by a newer version of Verticopolis\. Update the game to load it\./)).toBeVisible();
  expect(await page.evaluate(() => (window as any).game.reader.header.minutes)).toBe(before);
  expect(await storedSaves(page)).toEqual(storedBefore);
});

test("an older version's autosave loads, a failed import changes nothing, and an older file imports", async ({ page }) => {
  const old = JSON.parse(OLD_SAVE) as { version: number; money: number };
  expect(old.version).toBe(1);
  // A manual slot too, so the import check below covers more than the autosave.
  await seed(page, { [LEGACY_AUTO_KEY]: OLD_SAVE, [SLOT_1_KEY]: OLD_SAVE });
  await boot(page, "/");
  await page.waitForFunction((money) => (window as any).game.reader.header.money === money, old.money, { timeout: 10_000 });
  await page.evaluate(() => (window as any).game.onboarding.dismissSplash());
  const live = () => page.evaluate(() => (window as any).__vcEngine.port.serialize() as string);
  const before = await page.evaluate(() => (window as any).game.reader.header.minutes as number);
  const towerBefore = await live();
  const storedBefore = await storedSaves(page);
  // Two failed imports: text the front door turns away, and a container with a payload that looks like a tower
  // (it has a clock and a unit list) but is cut off, so only the engine's loader can refuse it. Neither may touch
  // the tower or any stored save, and each shows its own message.
  const damaged = `VCTOWER1\n${deflateRawSync('{"minutes":0,"units":[').toString("base64")}`;
  const refusals: [string, RegExp][] = [
    ["not a tower", /Not a Verticopolis tower file\./],
    [damaged, /This tower file is damaged and can't be read\./],
    ["VCTOWER3\nabc", /This tower file was made by a newer version of Verticopolis\. Update the game to load it\./],
    [`VCTOWER1\n${deflateRawSync('{"minutes":"0","units":[]}').toString("base64")}`, /Not a valid tower save file\./],
  ];
  for (const [text, message] of refusals) {
    await page.evaluate((t) => (window as any).game.saveLoad.importGame(t), text);
    await expect(page.getByText(message)).toBeVisible();
    expect(await page.evaluate(() => (window as any).game.reader.header.minutes)).toBe(before);
    expect(await live(), "the live tower is untouched").toBe(towerBefore);
    // Every stored save is byte for byte what it was.
    expect(await storedSaves(page)).toEqual(storedBefore);
  }
  // Change the tower, so the import below has something to replace.
  await playAndSave(page, before);
  const moved = await page.evaluate(() => (window as any).game.reader.header.minutes as number);
  expect(moved).toBeGreaterThan(before);
  // The same older tower as a file imports through the engine and puts the clock back.
  await page.evaluate((text) => (window as any).game.saveLoad.importGame(text), OLD_FILE);
  await expect(page.getByText("Tower imported.")).toBeVisible();
  await page.waitForFunction((m) => (window as any).game.reader.header.minutes === m, before, { timeout: 10_000 });
  expect(await page.evaluate(() => (window as any).game.reader.header.money)).toBe(old.money);
});

test("an unreadable autosave is kept, not overwritten, and downloads as it was stored", async ({ page }) => {
  const unreadable = "VCTOWER1\nnot a tower this version can read";
  await seed(page, { [AUTO_KEY]: unreadable });
  await boot(page, "/");
  expect(await storedSave(page, UNREADABLE_KEY)).toBe(unreadable);
  // A new tower saves over the autosave slot, and the kept copy stays.
  await playAndSave(page, 0);
  const autosave = await page.evaluate((k) => localStorage.getItem(k), AUTO_KEY);
  expect(autosave, "the new tower was written to the autosave slot").not.toBe(unreadable);
  expect(autosave).toMatch(/^VCZ1:/);
  expect(await storedSave(page, UNREADABLE_KEY)).toBe(unreadable);
  // The kept text downloads from Saved Towers exactly as it was stored.
  await page.evaluate(() => (window as any).game.showSaves());
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download unreadable save" }).click()]);
  // Text that starts like a tower file is named as one, so Import from file takes it after an update.
  expect(download.suggestedFilename()).toBe("verticopolis-unreadable-save.vctower");
  expect(readFileSync((await download.path())!, "utf8")).toBe(unreadable);
});
