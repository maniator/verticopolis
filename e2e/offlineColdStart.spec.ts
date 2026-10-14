/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, chromium, devices, type BrowserContext, type LaunchOptions, type Page } from "@playwright/test";
import { WASM_PROJECT, expectEngineHosted } from "./helpers";
import {
  ENGINE_FILES,
  advanceClock,
  expectAudioFromWorker,
  expectControlledWithEngine,
  expectSoundsAfterGesture,
  hostedGame,
  installWorker,
  lobbyAt,
  recordAudio,
  watch,
} from "./offlineHelpers";

/**
 * A cold start offline in a fresh browser session (#985, criteria 1 to 4).
 * offline.spec.ts reloads inside one browser context; here the browser itself
 * restarts. One online visit installs the service worker in a persistent
 * profile, every page and the browser close, and a new browser opens the same
 * profile with the network off from its very first request. Nothing carries
 * over except what a real restart keeps: the service worker, its caches and
 * localStorage (the engine choice the first visit stored, and the save slots).
 *
 * These run against the production build `npm run e2e` serves (vite preview),
 * on the chromium-wasm project. A persistent context takes none of the
 * project's `use` options, so the profile is launched here with the same
 * device, base URL and browser, and the engine choice (`vc.engine`, which the
 * project seeds into every other context) is stored by the online visit.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== WASM_PROJECT, "the engine runs on the chromium-wasm project"));
// An install, a browser restart and a game session each: more than the default 30s.
test.setTimeout(120_000);

// The project's device, minus `defaultBrowserType`, which is not a context option.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Desktop Chrome"];
const DESKTOP_CHROME = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch };

/**
 * Open the persistent profile at `dir`, online or offline from the start.
 * Playwright's `offline` cuts the page's network but not the service
 * worker's: a worker fetch still reaches the preview server, so a precache
 * miss would be fetched quietly and the test would pass. Offline, the browser
 * also sends every request, loopback included, to a proxy on a port nothing
 * listens on, so the worker has no network either (offlineStart probes both).
 */
function launch(dir: string, baseURL: string, launchOptions: LaunchOptions, offline: boolean): Promise<BrowserContext> {
  const noNetwork = offline ? { proxy: { server: "http://127.0.0.1:9" }, args: [...(launchOptions.args ?? []), "--proxy-bypass-list=<-loopback>"] } : {};
  return chromium.launchPersistentContext(dir, { ...launchOptions, ...DESKTOP_CHROME, baseURL, offline, ...noNetwork });
}

/** The one online visit: install the worker, choose the WASM engine, reload
 *  under the worker's control and check the engine package is precached.
 *  `beforeClose` runs on the hosted game before the browser closes. */
async function onlineVisit(dir: string, baseURL: string, launchOptions: LaunchOptions, beforeClose?: (page: Page) => Promise<void>): Promise<void> {
  const context = await launch(dir, baseURL, launchOptions, false);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    // Stored once, the way a player's choice is: the offline session reads it
    // back from the profile, with no init script.
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("vc.engine", "wasm"));
    await installWorker(page);
    await page.reload();
    await expectControlledWithEngine(page);
    await hostedGame(page);
    await beforeClose?.(page);
    await expectEngineHosted(page);
  } finally {
    // Every page and the browser go away: nothing in memory survives.
    await context.close();
  }
}

/** Open the profile offline and navigate to the game. The navigation and the
 *  engine package must come from the worker, since nothing else can answer. */
async function offlineStart(context: BrowserContext): Promise<{ page: Page; seen: ReturnType<typeof watch>; audio: ReturnType<typeof recordAudio> }> {
  const page = context.pages()[0] ?? (await context.newPage());
  const seen = watch(page);
  const audio = recordAudio(page);
  const binary = page.waitForResponse((r) => r.url().includes(ENGINE_FILES[1]), { timeout: 30_000 });
  await page.goto("/");
  expect((await binary).fromServiceWorker(), "the engine binary is served by the service worker").toBe(true);
  await expectControlledWithEngine(page);
  await hostedGame(page);
  expect(await page.evaluate(() => navigator.onLine), "the browser is offline").toBe(false);
  // Booting offline needed no network: nothing failed before the probes.
  expect(seen, "the offline cold start made no failed request").toEqual({ errors: [], failed: [] });
  // The network is really gone, for the page and for the worker alike: a
  // file that is not precached cannot be fetched by either.
  const probe = `/offline-probe-${Date.now()}.json`;
  expect(await page.evaluate((u) => fetch(u).then(() => "fetched", () => "failed"), probe), "the page reaches no network").toBe("failed");
  const [worker] = context.serviceWorkers();
  expect(worker, "the service worker is running").toBeDefined();
  expect(await worker.evaluate((u) => fetch(u).then(() => "fetched", () => "failed"), probe), "the service worker reaches no network").toBe("failed");
  // The probes' own failures are expected; drop exactly those.
  seen.failed.splice(0, seen.failed.length, ...seen.failed.filter((f) => !f.includes(probe)));
  return { page, seen, audio };
}

/** The engine's own save, parsed: the tower and clock the WASM engine holds. */
function engineSave(page: Page): Promise<unknown> {
  return page.evaluate(() => JSON.parse((window as any).__vcEngine.current().engine.serialize()));
}

/** The engine's own clock, read from its save. */
async function engineMinutes(page: Page): Promise<number> {
  return ((await engineSave(page)) as { minutes: number }).minutes;
}

test("after one online visit, a fresh offline browser session opens the game on the WASM engine, runs the clock and plays today's sounds", async ({ baseURL, launchOptions }, info) => {
  const dir = info.outputPath("profile");
  await onlineVisit(dir, baseURL!, launchOptions);

  const context = await launch(dir, baseURL!, launchOptions, true);
  try {
    const { page, seen, audio } = await offlineStart(context);
    const engine = await page.evaluate(() => (window as any).__vcEngine.status);
    expect({ hosted: engine.hosted, errors: engine.errors }, "the engine hosts the tower with no fallback").toEqual({ hosted: true, errors: [] });
    // Read the clock from the engine's own save, so the advance is the
    // engine's and no copy the host keeps.
    const start = await engineMinutes(page);
    await advanceClock(page);
    expect(await engineMinutes(page), "the engine's own clock advances").toBeGreaterThan(start);
    await expectSoundsAfterGesture(page);
    expectAudioFromWorker(audio);
    await expectEngineHosted(page);
    expect(seen).toEqual({ errors: [], failed: [] });
  } finally {
    await context.close();
  }
});

test("a tower saved online loads in a fresh offline browser session, runs, saves and reloads", async ({ baseURL, launchOptions }, info) => {
  const dir = info.outputPath("profile");
  // Online: build a lobby, run the clock, and save to slot 1.
  let savedAt = 0;
  let savedState: unknown;
  await onlineVisit(dir, baseURL!, launchOptions, async (page) => {
    await page.evaluate(() => {
      const g = (window as any).game;
      g.sim.money = 1e9;
      if (!g.sim.build("lobby", 1, 160).ok) throw new Error("the online lobby was refused");
      (window as any).__vcEngine.current().syncStructure();
    });
    savedAt = await advanceClock(page);
    await page.evaluate(() => (window as any).game.saveToSlot(1));
    savedState = await engineSave(page);
  });

  const context = await launch(dir, baseURL!, launchOptions, true);
  try {
    const { page, seen } = await offlineStart(context);
    expect(await lobbyAt(page, 160), "the offline session starts on its own tower before the load").toBe(false);
    // Load the online save on the engine.
    await page.evaluate(() => {
      const g = (window as any).game;
      g.setSpeed(0);
      g.loadFromSlot(1);
      (window as any).__vcEngine.current().syncStructure();
    });
    expect(await lobbyAt(page, 160), "the online save's lobby loaded").toBe(true);
    expect(await page.evaluate(() => (window as any).game.sim.clock.minutes), "the online save's clock loaded").toBe(savedAt);
    expect(await engineSave(page), "the engine holds exactly the state saved online").toEqual(savedState);
    // Run it, issue a command, and save over the slot.
    const ranTo = await advanceClock(page);
    expect(ranTo).toBeGreaterThan(savedAt);
    const resaved = await page.evaluate(() => {
      const g = (window as any).game;
      const ok = g.sim.build("lobby", 1, 200).ok;
      (window as any).__vcEngine.current().syncStructure();
      g.saveToSlot(1);
      return { ok, minutes: g.sim.clock.minutes as number };
    });
    const resavedState = await engineSave(page);
    expect(resaved.ok, "the offline lobby was built").toBe(true);

    // Reload, still offline, and load the slot: both lobbies and the later
    // clock come back.
    await page.reload();
    await hostedGame(page);
    expect(await lobbyAt(page, 200), "the reload starts on its own tower before the load").toBe(false);
    await page.evaluate(() => {
      const g = (window as any).game;
      g.setSpeed(0);
      g.loadFromSlot(1);
      (window as any).__vcEngine.current().syncStructure();
    });
    const reloaded = {
      lobby160: await lobbyAt(page, 160),
      lobby200: await lobbyAt(page, 200),
      minutes: await page.evaluate(() => (window as any).game.sim.clock.minutes as number),
    };
    expect(reloaded, "the offline save persisted across the reload").toEqual({ lobby160: true, lobby200: true, minutes: resaved.minutes });
    expect(await engineSave(page), "the engine holds exactly the state saved offline").toEqual(resavedState);
    await expectEngineHosted(page);
    expect(seen).toEqual({ errors: [], failed: [] });
  } finally {
    await context.close();
  }
});
