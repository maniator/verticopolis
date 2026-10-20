/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test";
import { onWasm } from "./helpers";
import { hostedGame } from "./offlineHelpers";
import { ENGINE_LOADING_TEXT } from "../src/engineLoading";

/**
 * The boot cover tells the player the engine is loading when the download is
 * slow (#1132), and says nothing when it is fast. The WASM engine loads before
 * the app exists, so without the line a slow first visit is a blank sky.
 */
test.beforeEach(({}, info) => test.skip(!onWasm(info.project.name), "the engine loads before the app on the chromium-wasm and chromium-wasm-only projects"));
test.setTimeout(60_000);
// No worker, so the route below sees every engine request (an installed game
// reads the engine from the precache in milliseconds).
test.use({ serviceWorkers: "block" });

test("a slow engine download shows a loading line that is announced and gone once the game is up", async ({ page }) => {
  await page.route("**/engine/verticopolis_engine_bg.wasm", async (route) => {
    await new Promise((done) => setTimeout(done, 4_000));
    await route.continue();
  });
  await page.goto("/");
  const line = page.locator("#boot-cover .boot-loading");
  await expect(line).toHaveText(ENGINE_LOADING_TEXT, { timeout: 3_000 });
  await expect(page.locator("#a11y-live")).toHaveText(ENGINE_LOADING_TEXT);
  await hostedGame(page);
  await expect(page.locator("#boot-cover")).toHaveCount(0);
  await expect(page.locator(".boot-loading")).toHaveCount(0);
});

test("a fast load never shows the line", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__loadingLines = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof Element && (n.classList.contains("boot-loading") || n.querySelector(".boot-loading"))) (window as any).__loadingLines++;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/");
  await hostedGame(page);
  expect(await page.evaluate(() => (window as any).__loadingLines)).toBe(0);
});
