/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { WASM_ONLY_PROJECT } from "./helpers";
import { hostedGame } from "./offlineHelpers";
import { ENGINE_PATH, SALT_SECTION, installed, tamperCache } from "./engineCacheHelpers";

/**
 * Repair engine files (#985, design 5.4 "Corrupted-entry recovery"). A cached
 * engine file that no longer matches the shell stops the wasm-only build, and
 * a plain Reload cannot help because the precache returns the bad entry as
 * stored. The stop screen offers Repair when a worker controls the page; it
 * fetches fresh copies, checks them, replaces the running build's three cache
 * entries in place, and leaves the page for the player to reload.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== WASM_ONLY_PROJECT, "the stop screen exists on the wasm-only build"));
test.setTimeout(90_000);

const repairButton = (page: Page) => page.locator('#engine-failure [data-act="repair-engine"]');
const status = (page: Page) => page.locator("#engine-failure .engine-failure-repair-status");
const refused = (page: Page) => page.waitForFunction(() => (window as any).__vcEngineBoot?.failure?.reason === "package-mismatch", undefined, { timeout: 30_000 });

/** The engine entries of the cache, as url -> byte length. */
async function engineEntries(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const out: Record<string, number> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (!new URL(request.url).pathname.startsWith("/engine/")) continue;
        out[`${name} ${request.url}`] = (await (await cache.match(request))!.arrayBuffer()).byteLength;
      }
    }
    return out;
  });
}

test("repairs a corrupted cached binary in place, and the next Reload boots the engine", async ({ page }) => {
  await installed(page);
  const before = await engineEntries(page);
  await tamperCache(page, "wasm", "salt");
  const keys = Object.keys(before);
  const damaged = await engineEntries(page);
  expect(Object.keys(damaged).sort(), "tampering replaces under the same key").toEqual(keys.sort());

  await page.reload();
  await refused(page);
  await expect(repairButton(page)).toBeVisible();
  await expect(page.locator("#engine-failure")).toContainText(/press Repair engine files to download a fresh copy/);

  await repairButton(page).click();
  await expect(status(page)).toHaveText("Engine files repaired. Press Reload to try again.");
  expect(await engineEntries(page), "the same three keys, with the original bytes back").toEqual(before);
  // The page adds no reload of its own: the stop screen is still up.
  await expect(page.locator("#engine-failure")).toBeVisible();

  await page.reload();
  await hostedGame(page);
  expect(await page.evaluate(() => (window as any).__vcEngineBoot)).toMatchObject({ engine: "wasm", failure: null });
});

test("repairs a corrupted cached glue and a cached record the same way", async ({ page }) => {
  await installed(page);
  const before = await engineEntries(page);
  await tamperCache(page, "glue", "flip");
  await tamperCache(page, "record", "record");
  await page.reload();
  await refused(page);
  await repairButton(page).click();
  await expect(status(page)).toHaveText("Engine files repaired. Press Reload to try again.");
  expect(await engineEntries(page)).toEqual(before);
});

test("offline, a repair fails safe: the old entries stay and Repair stays available", async ({ page, context }) => {
  await installed(page);
  await tamperCache(page, "wasm", "salt");
  const damaged = await engineEntries(page);
  await page.reload();
  await refused(page);
  await context.setOffline(true);
  await repairButton(page).click();
  await expect(status(page)).toContainText(/Could not download the engine files\. Nothing was changed/);
  expect(await engineEntries(page), "nothing was written").toEqual(damaged);
  await expect(repairButton(page)).toBeEnabled();
  await expect(repairButton(page)).not.toHaveAttribute("aria-disabled", "true");

  await context.setOffline(false);
  await repairButton(page).click();
  await expect(status(page)).toHaveText("Engine files repaired. Press Reload to try again.");
});

test("a network that serves another build's binary is refused and nothing is written", async ({ page }) => {
  await installed(page);
  await tamperCache(page, "wasm", "salt");
  const damaged = await engineEntries(page);
  await page.reload();
  await refused(page);
  // The worker's own network requests do not pass through page.route, so the
  // other build is served by wrapping the page's fetch for the repair request.
  await page.evaluate(
    ([path, salt]) => {
      const real = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await real(input, init);
        if (!String(input).includes(`${path}?vc-repair=`)) return response;
        return new Response(new Uint8Array([...new Uint8Array(await response.arrayBuffer()), ...salt]), { status: 200 });
      };
    },
    [ENGINE_PATH.wasm, SALT_SECTION] as const,
  );
  await repairButton(page).click();
  await expect(status(page)).toContainText(/do not match this version of the game\. Nothing was changed/);
  expect(await engineEntries(page)).toEqual(damaged);
});

test("other cache entries are left alone", async ({ page }) => {
  await installed(page);
  const others = () =>
    page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) if (!new URL(request.url).pathname.startsWith("/engine/")) out.push(`${name} ${request.url}`);
      }
      return out.sort();
    });
  const before = await others();
  await tamperCache(page, "wasm", "salt");
  await page.reload();
  await refused(page);
  await repairButton(page).click();
  await expect(status(page)).toHaveText("Engine files repaired. Press Reload to try again.");
  expect(await others()).toEqual(before);
});

test("Repair is not offered when no worker controls the page", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route(`**/${ENGINE_PATH.wasm}`, async (route) => {
    const response = await route.fetch();
    const body = Buffer.concat([await response.body(), Buffer.from(SALT_SECTION)]);
    await route.fulfill({ response, body, headers: { ...response.headers(), "content-length": String(body.length) } });
  });
  await page.goto("/");
  await refused(page);
  await expect(page.locator("#engine-failure")).toBeVisible();
  await expect(repairButton(page)).toHaveCount(0);
  await context.close();
});
