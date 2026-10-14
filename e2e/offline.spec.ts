/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { WASM_PROJECT, expectEngineHosted } from "./helpers";

/**
 * The installed game on the WASM engine without a network (#985). The service
 * worker precaches the shell and the engine package together (vite.config.ts),
 * so after one online visit the game must start the engine on an offline
 * reload, keep it through a lost connection, and save and load on it. "On the
 * engine" means the host holds the live tower with no silent fallback to the
 * TypeScript engine (expectEngineHosted, after every test), and the engine
 * binary came from the service worker. A reload here keeps the browser
 * context; a start in a fresh browser session is still open on #985.
 *
 * These run against the production build `npm run e2e` serves (vite preview),
 * on the chromium-wasm project, where the engine is the chosen one.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== WASM_PROJECT, "the engine runs on the chromium-wasm project"));
// An install, an offline reload and a game session each: more than the default 30s.
test.setTimeout(90_000);
test.afterEach(async ({ page }) => expectEngineHosted(page));

const ENGINE_FILES = ["engine/verticopolis_engine.js", "engine/verticopolis_engine_bg.wasm"];

/** Wait until the page runs on the engine, then lift the title screen. */
async function hostedGame(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __vcEngine?: { status: { hosted: boolean } }; game?: { sim: unknown } };
    return !!w.__vcEngine?.status.hosted && !!w.game;
  }, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.getElementById("splash")?.remove());
}

/** The first online visit: it installs the service worker, which precaches
 *  the shell and the engine package. That visit is not controlled by the
 *  worker (no clients.claim, by design: updates wait for the player). */
async function installWorker(page: Page): Promise<void> {
  await page.goto("/");
  // An install that fails (a precache entry that 404s, say) never activates;
  // say so here, with the worker's state, rather than at the test timeout.
  const ready = await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<boolean>((done) => setTimeout(() => done(false), 25_000)),
    ]),
  );
  if (!ready) {
    const state = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return { registered: !!r, installing: !!r?.installing, waiting: !!r?.waiting, active: !!r?.active };
    });
    throw new Error(`the service worker never activated: ${JSON.stringify(state)}`);
  }
}

/** Wait for the worker to control the page, and check the engine glue and
 *  binary are in its precache. */
async function expectControlledWithEngine(page: Page): Promise<void> {
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 });
  const cached = await page.evaluate(async (files) => {
    const hits = await Promise.all(files.map((f) => caches.match(new URL(f, document.baseURI).href, { ignoreSearch: true })));
    return hits.map((r) => r?.ok ?? false);
  }, ENGINE_FILES);
  expect(cached, "the engine glue and binary are in the service worker's precache").toEqual([true, true]);
}

/** Advance the clock on the engine, build, save to a slot and load it back. */
async function playSaveAndLoad(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).game.setSpeed(1));
  const before = await page.evaluate(() => (window as any).game.sim.clock.minutes as number);
  await page.waitForFunction((b) => (window as any).game.sim.clock.minutes > b + 5, before, { timeout: 30_000 });
  const built = await page.evaluate(() => {
    const g = (window as any).game;
    g.setSpeed(0);
    g.sim.money = 1e9;
    const ok = g.sim.build("lobby", 1, 160).ok;
    (window as any).__vcEngine.current().syncStructure();
    const host = (window as any).__vcEngine;
    const lobbyAt = (x: number) => (JSON.parse(host.current().engine.serialize()).units as { kind: string; x: number }[]).some((u) => u.kind === "lobby" && u.x === x);
    g.saveToSlot(1);
    // A change after the save, which the load must undo (it lands in the
    // engine first, so a load that did nothing would leave it there).
    const after = g.sim.build("lobby", 1, 200).ok;
    host.current().syncStructure();
    const beforeLoad = lobbyAt(200);
    g.loadFromSlot(1);
    return {
      ok,
      after,
      beforeLoad,
      hosted: host.status.hosted,
      errors: host.status.errors,
      saved: lobbyAt(160),
      afterLoad: lobbyAt(200),
    };
  });
  expect(built).toEqual({ ok: true, after: true, beforeLoad: true, hosted: true, errors: [], saved: true, afterLoad: false });
}

/** Collect page errors and every request that fails, from now on. Offline,
 *  gameplay must need no network at all (no telemetry, no engine fetch). */
function watch(page: Page): { errors: string[]; failed: string[] } {
  const seen = { errors: [] as string[], failed: [] as string[] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  // A request the reload itself cancels (ERR_ABORTED) is the old page going
  // away; anything else that fails offline is a real network dependency.
  page.on("requestfailed", (r) => {
    if (r.failure()?.errorText !== "net::ERR_ABORTED") seen.failed.push(`${r.url()} (${r.failure()?.errorText})`);
  });
  return seen;
}

test("an installed game starts the WASM engine on its first reload offline, and plays, saves and loads", async ({ page, context }) => {
  await installWorker(page);
  // The first navigation the worker controls happens with no network, so the
  // shell and the engine come from the precache only and the binary is
  // answered by the service worker. The reload keeps the browser context.
  await context.setOffline(true);
  const seen = watch(page);
  const binary = page.waitForResponse((r) => r.url().includes("engine/verticopolis_engine_bg.wasm"), { timeout: 30_000 });
  await page.reload();
  expect((await binary).fromServiceWorker(), "the engine binary is served by the service worker").toBe(true);
  await expectControlledWithEngine(page);
  await hostedGame(page);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await playSaveAndLoad(page);
  expect(seen).toEqual({ errors: [], failed: [] });
});

test("losing the network mid-session keeps the game playing on the WASM engine", async ({ page, context }) => {
  await installWorker(page);
  await page.reload();
  await expectControlledWithEngine(page);
  await hostedGame(page);
  await context.setOffline(true);
  const seen = watch(page);
  // Nudge src/pwa.ts's visibility-driven update check. This test only shows
  // the session keeps playing with it in flight; src/pwa.test.ts
  // ("registerPWA: offline") pins that a failed version.json fetch still
  // offers the update, and check() catches its own failures by construction.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await playSaveAndLoad(page);
  expect(seen.errors).toEqual([]);
});
