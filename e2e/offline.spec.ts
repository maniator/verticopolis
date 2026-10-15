/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { onWasm, expectEngineHosted } from "./helpers";
import { expectAudioFromWorker, expectControlledWithEngine, expectSoundsAfterGesture, hostedGame, installWorker, recordAudio, watch } from "./offlineHelpers";

/**
 * The installed game on the WASM engine without a network (#985). The service
 * worker precaches the shell and the engine package together (vite.config.ts),
 * so after one online visit the game must start the engine on an offline
 * reload, keep it through a lost connection, and save and load on it. "On the
 * engine" means the host holds the live tower with no silent fallback to the
 * TypeScript engine (expectEngineHosted, after every test), and the engine
 * binary came from the service worker. A reload here keeps the browser
 * context; offlineColdStart.spec.ts covers a start in a fresh browser session.
 *
 * These run against the production build `npm run e2e` serves (vite preview),
 * on the chromium-wasm project, where the engine is the chosen one.
 */
test.beforeEach(({}, info) => test.skip(!onWasm(info.project.name), "the engine runs on the chromium-wasm and chromium-wasm-only projects"));
// An install, an offline reload and a game session each: more than the default 30s.
test.setTimeout(90_000);
test.afterEach(async ({ page }) => expectEngineHosted(page));

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

/** Today's sounds offline (#985, criterion 3), after the first gesture: see
 *  expectSoundsAfterGesture for what "play" means here. */
test("an installed game plays today's sounds offline after the first gesture", async ({ page, context }) => {
  await installWorker(page);
  // As in the cold-start test: the first navigation the worker controls is
  // the offline one.
  await context.setOffline(true);
  const seen = watch(page);
  const audio = recordAudio(page);
  await page.reload();
  await expectControlledWithEngine(page);
  await hostedGame(page);
  await expectSoundsAfterGesture(page);
  // Every audio file came from the service worker, with nothing fetched from
  // the network.
  expectAudioFromWorker(audio);
  expect(seen).toEqual({ errors: [], failed: [] });
});
