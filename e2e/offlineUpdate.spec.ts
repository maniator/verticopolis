/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startDeployments, type Deployment, type Deployments } from "./deployments";
import { onWasm, expectEngineHosted } from "./helpers";
import { expectControlledWithEngine, hostedGame, installWorker, watch } from "./offlineHelpers";

/**
 * An update replaces the engine package in the cache, and the game then plays
 * with no network (#985, criterion 7: a bounded precache, old engine caches
 * removed, no network needed to play). Two deployments answer on one origin
 * (deployments.ts): the first is installed, the second is "deployed", and the
 * update prompt moves the page onto it the way a player does.
 *
 * These run against the production build `npm run e2e` serves, on the
 * chromium-wasm project, where the engine is the chosen one. They read the
 * precache the way the worker keeps it: one cache, one key per manifest entry,
 * a revisioned entry keyed `url?__WB_REVISION__=<revision>`.
 */
test.beforeEach(({}, info) => test.skip(!onWasm(info.project.name), "the engine runs on the chromium-wasm and chromium-wasm-only projects"));
// Chromium holds the first update check on a fresh registration for about a
// minute (the next ones answer at once), and the flow makes two updates, so the
// test needs well over the default 30s.
test.setTimeout(240_000);

let deployments: Deployments;

/** A page on the first deployment, installed, controlled and on the engine. */
async function installedFirst(browser: Browser): Promise<{ page: Page; context: BrowserContext }> {
  // The engine choice the project seeds into its own contexts (this origin is new).
  const context = await browser.newContext({
    baseURL: deployments.origin,
    storageState: { cookies: [], origins: [{ origin: deployments.origin, localStorage: [{ name: "vc.engine", value: "wasm" }] }] },
  });
  const page = await context.newPage();
  await installWorker(page);
  await page.reload();
  await expectControlledWithEngine(page);
  await hostedGame(page);
  return { page, context };
}

/** Every cache name in Cache Storage and every key in them, as `path?query`. */
async function cacheContents(page: Page): Promise<{ names: string[]; keys: string[] }> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const keys: string[] = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) {
        const url = new URL(request.url);
        keys.push(`${url.pathname}${url.search}`);
      }
    }
    return { names, keys };
  });
}

/**
 * The cache holds exactly what `which`'s sw.js lists: one precache, one key per
 * manifest entry, and the three engine files each under that build's revision
 * (so no engine key from the other build is left, the binary and the record
 * included).
 */
async function expectCacheIs(page: Page, which: Deployment): Promise<void> {
  const { names, keys } = await cacheContents(page);
  expect(names, "one precache and no other cache").toHaveLength(1);
  expect(keys, "one key per manifest entry").toHaveLength(deployments.manifestEntries[which]);
  const r = deployments.revisions[which];
  const expected = [
    `/engine/verticopolis_engine.js?__WB_REVISION__=${r.glue}`,
    `/engine/verticopolis_engine_bg.wasm?__WB_REVISION__=${r.wasm}`,
    `/engine/BUILD.json?__WB_REVISION__=${r.record}`,
  ];
  expect(keys.filter((k) => k.includes("/engine/")).sort(), `the engine files are all ${which}'s`).toEqual(expected.sort());
}

/** Deploy `which` and take the update the player is offered. */
async function updateTo(page: Page, which: Deployment): Promise<void> {
  deployments.serve(which);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  const update = page.locator('[data-act="update"]');
  await update.waitFor({ state: "visible", timeout: 90_000 });
  // Update now: the page reloads onto the worker that was waiting.
  await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), update.click()]);
  // The reload is on the new worker when nothing is installing or waiting any
  // more (the page was controlled by the old worker before, so a controller
  // alone proves nothing).
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return !!navigator.serviceWorker.controller && !registration?.installing && !registration?.waiting;
    },
    undefined,
    { timeout: 30_000 },
  );
  await hostedGame(page);
}

/** The glue the page would load, as the worker answers it. */
const servedGlue = (page: Page): Promise<string> =>
  page.evaluate(() => fetch(new URL("engine/verticopolis_engine.js", document.baseURI), { cache: "no-store" }).then((r) => r.text()));

test("an update replaces the engine files in the cache, and the updated game plays with no network", async ({ browser }) => {
  deployments = await startDeployments();
  const { page, context } = await installedFirst(browser);
  try {
    await expectCacheIs(page, "A");
    expect(await servedGlue(page)).not.toContain("deployment B");

    await test.step("an update moves the engine files to the new build and leaves no old engine entry", async () => {
      await updateTo(page, "B");
      await expectCacheIs(page, "B");
      expect(await servedGlue(page), "the page now gets the second build's glue").toContain("deployment B");
      const record = await page.evaluate(() => fetch(new URL("engine/BUILD.json", document.baseURI)).then((r) => r.json()));
      expect(record.package, "and the second build's record").toBe(deployments.packageId.B);
      await expectEngineHosted(page);
    });

    await test.step("the updated game starts and plays with no network", async () => {
      // Nothing the worker or the page asks for may reach the server while
      // offline: the worker's own requests count, which Playwright's offline
      // flag does not cut. The server still answers with the first build, so a
      // request that slipped through would also change the glue. The window
      // starts before the network is cut.
      const served = deployments.requests.length;
      await context.setOffline(true);
      deployments.serve("A");
      const seen = watch(page);
      await page.reload();
      await expectControlledWithEngine(page);
      await hostedGame(page);
      expect(await servedGlue(page), "the offline start runs the second build's glue from the cache").toContain("deployment B");
      await page.evaluate(() => (window as any).game.setSpeed(1));
      const minutes = await page.evaluate(() => (window as any).game.sim.clock.minutes as number);
      await page.waitForFunction((m) => (window as any).game.sim.clock.minutes > m + 5, minutes, { timeout: 30_000 });
      expect(deployments.requests.slice(served), "no request reached the server").toEqual([]);
      expect(seen).toEqual({ errors: [], failed: [] });
      await expectEngineHosted(page);
      await context.setOffline(false);
    });

    await test.step("an update still arrives and moves the engine files when version.json cannot be fetched", async () => {
      // version.json only names the incoming build in the prompt; without it the
      // update is the same update. This one goes back to the first build.
      deployments.failVersionJson(true);
      const asked = deployments.requests.filter((r) => r.path === "/version.json").length;
      await updateTo(page, "A");
      expect(deployments.requests.filter((r) => r.path === "/version.json").length, "the page did ask for it").toBeGreaterThan(asked);
      await expectCacheIs(page, "A");
      expect(await servedGlue(page)).not.toContain("deployment B");
      await expectEngineHosted(page);
    });
  } finally {
    await context.close();
    await deployments.close();
  }
});
