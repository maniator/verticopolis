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
 *
 * "Bounded" has two halves. The byte bound (4 MiB) is the build gate in
 * scripts/verify-precache.ts, which `postbuild` runs for every e2e build. The
 * half checked here is that the precache does not grow across updates.
 */
test.beforeEach(({}, info) => test.skip(!onWasm(info.project.name), "the engine runs on the chromium-wasm and chromium-wasm-only projects"));
// Two installs, two updates and an offline hold: more than the default 30s.
// (On some machines Chromium holds the first update check on a fresh
// registration for about a minute; CI does not see it.)
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

/**
 * Deploy `which` and take the update the player is offered. `named` is what
 * the prompt must say about the incoming build: its version when version.json
 * arrived, nothing when it did not.
 */
async function updateTo(page: Page, which: Deployment, named: string | null): Promise<void> {
  deployments.serve(which);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  const update = page.locator('[data-act="update"]');
  await update.waitFor({ state: "visible", timeout: 90_000 });
  const buildLine = page.locator(".build-id");
  if (named === null) await expect(buildLine, "version.json is missing, so the prompt names no build").toHaveCount(0);
  else await expect(buildLine, "the prompt names the incoming build").toContainText(named);
  // Update now: the page reloads onto the worker that was waiting.
  await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), update.click()]);
  // The reload is on the new worker when nothing is installing or waiting any
  // more (the page was controlled by the old worker before, so a controller
  // alone proves nothing).
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return !!navigator.serviceWorker.controller && !registration?.installing && !registration?.waiting;
        }),
      { message: "the new worker is active and nothing is waiting", timeout: 30_000 },
    )
    .toBe(true);
  await hostedGame(page);
}

/** Fetch `path` from the page and require that the service worker answered it. */
async function servedByWorker(page: Page, path: string): Promise<string> {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === `/${path}`, { timeout: 30_000 });
  const text = await page.evaluate((p) => fetch(new URL(p, document.baseURI), { cache: "no-store" }).then((r) => r.text()), path);
  expect((await response).fromServiceWorker(), `${path} is answered by the service worker`).toBe(true);
  return text;
}

/** The glue the page would load, as the worker answers it. */
const servedGlue = (page: Page): Promise<string> => servedByWorker(page, "engine/verticopolis_engine.js");

/** The requests the browser itself makes to check for a new worker: the worker
 *  script and the scripts it imports. They are not the game's or the worker's
 *  fetches, and Playwright's offline flag does not stop them. */
const isUpdateCheck = (path: string): boolean => path === "/sw.js" || /^\/workbox-[\w-]+\.js$/.test(path);

test("an update replaces the engine files in the cache, and the updated game plays with no network", async ({ browser }) => {
  deployments = await startDeployments();
  let context: BrowserContext | undefined;
  try {
    const first = await installedFirst(browser);
    const { page } = first;
    context = first.context;
    await expectCacheIs(page, "A");
    expect(await servedGlue(page)).not.toContain("deployment B");

    await test.step("an update moves the engine files to the new build and leaves no old engine entry", async () => {
      await updateTo(page, "B", "999.0.0");
      await expectCacheIs(page, "B");
      expect(await servedGlue(page), "the page now gets the second build's glue").toContain("deployment B");
      const record = JSON.parse(await servedByWorker(page, "engine/BUILD.json"));
      expect(record.package, "and the second build's record").toBe(deployments.packageId.B);
      await expectEngineHosted(page);
    });

    await test.step("the updated game starts and plays with no network", async () => {
      // Nothing the game or the worker asks for may reach the server while
      // offline: the worker's own requests count, which Playwright's offline
      // flag does not cut. The server keeps answering with the second build, so
      // a cache miss would not change the glue; the log is what proves it. The
      // browser's own update check for sw.js (about two seconds after a load)
      // also gets through, finds the same worker and changes nothing, so the
      // window is held past it. The window starts before the network is cut.
      const served = deployments.requests.length;
      await context!.setOffline(true);
      const seen = watch(page);
      await page.reload();
      await expectControlledWithEngine(page);
      await hostedGame(page);
      expect(await servedGlue(page), "the offline start runs the second build's glue from the cache").toContain("deployment B");
      await page.evaluate(() => (window as any).game.setSpeed(1));
      const minutes = await page.evaluate(() => (window as any).game.sim.clock.minutes as number);
      await page.waitForFunction((m) => (window as any).game.sim.clock.minutes > m + 5, minutes, { timeout: 30_000 });
      await page.waitForTimeout(4_000);
      const reached = deployments.requests.slice(served).filter((r) => !isUpdateCheck(r.path));
      expect(reached, "no request but the browser's update check reached the server").toEqual([]);
      expect(seen).toEqual({ errors: [], failed: [] });
      await expectEngineHosted(page);
      await context!.setOffline(false);
    });

    await test.step("an update still arrives and moves the engine files when version.json cannot be fetched", async () => {
      // version.json only names the incoming build in the prompt; without it the
      // update is the same update. This one goes back to the first build.
      deployments.failVersionJson(true);
      const asked = deployments.requests.filter((r) => r.path === "/version.json").length;
      await updateTo(page, "A", null);
      expect(deployments.requests.filter((r) => r.path === "/version.json").length, "the page did ask for it").toBeGreaterThan(asked);
      await expectCacheIs(page, "A");
      expect(await servedGlue(page)).not.toContain("deployment B");
      await expectEngineHosted(page);
    });
  } finally {
    try {
      await context?.close();
    } finally {
      await deployments.close();
    }
  }
});
