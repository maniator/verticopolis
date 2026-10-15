/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { WASM_PROJECT } from "./helpers";

/**
 * The experimental worker host (`?engine=wasm-worker`) in a real browser,
 * on the served package: the engine boots in a module worker (the main
 * thread never fetches the WASM module), the clock advances through the
 * frame loop, a build answers at once and reaches the engine, and the exact
 * save the host settles on is the engine's own (it round-trips through a
 * second engine unchanged). Runs on the chromium-wasm project, which serves
 * the package; `?engine=wasm-worker` overrides its stored choice.
 */

async function boot(page: Page): Promise<void> {
  await page.goto("/?engine=wasm-worker");
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__vcEngine?.status?.placement === "worker" && w.__vcEngine.current()?.loaded() && !!w.game;
  }, undefined, { timeout: 30_000 });
  await expect(page.locator(".splash-version")).toContainText("WASM engine (worker)");
  await page.evaluate(() => document.getElementById("splash")?.remove());
}

test("the game runs on the WASM engine in a worker behind ?engine=wasm-worker", async ({ page }, info) => {
  test.skip(info.project.name !== WASM_PROJECT, "the engine package is served on the chromium-wasm project");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await boot(page);
  // The main thread never loaded the engine itself.
  const mainWasm = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.endsWith(".wasm")).length);
  expect(mainWasm).toBe(0);
  await page.evaluate(() => (window as any).game.setSpeed(3));
  const before = await page.evaluate(() => (window as any).game.sim.clock.minutes as number);
  await page.waitForFunction((b) => (window as any).game.sim.clock.minutes > b + 30, before, { timeout: 30_000 });
  const result = await page.evaluate(async () => {
    const g = (window as any).game;
    const h = (window as any).__vcEngine;
    g.setSpeed(0);
    g.sim.money = 1e9;
    const ok = g.sim.build("lobby", 1, 160).ok;
    await h.settle();
    const approximateBefore = h.current().stats.approximateSaves;
    const save = g.sim.serialize();
    const exact = h.current().stats.approximateSaves === approximateBefore;
    return {
      ok,
      hosted: h.status.hosted,
      errors: h.status.errors,
      replies: h.current().stats.replies,
      unitInEngine: save.units.some((u: { kind: string; x: number }) => u.kind === "lobby" && u.x === 160),
      money: save.money,
      exact,
      save: JSON.stringify(save),
    };
  });
  expect(result).toMatchObject({ ok: true, hosted: true, errors: [], unitInEngine: true, exact: true });
  // The lobby cost came out of the billion the engine was given.
  expect(result.money).toBeLessThan(1e9);
  expect(result.money).toBeGreaterThan(1e9 - 1e6);
  expect(result.replies).toBeGreaterThan(2);
  // The settled save is the engine's: a second engine loaded from it writes it back unchanged.
  const roundTrip = await page.evaluate(async (save) => {
    const url = new URL(`${(window as any).__vcBase ?? "/"}engine/verticopolis_engine.js`, location.href).href;
    const mod = await import(/* @vite-ignore */ url);
    await mod.default();
    const e = mod.Engine.fromSave(save);
    const back = e.serialize();
    e.free();
    const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
    return JSON.stringify(canon(JSON.parse(back))) === JSON.stringify(canon(JSON.parse(save)));
  }, result.save);
  expect(roundTrip).toBe(true);
  // The worker's script is in the service worker's precache, so an offline
  // start finds it (with the engine package, which #985 precaches).
  const sw = await page.evaluate(async () => (await fetch(new URL("sw.js", document.baseURI))).text());
  const precached = /assets\/engineWorker-[\w-]+\.js/.exec(sw)?.[0];
  expect(precached).toBeTruthy();
  // The worker this page runs is that same script (one build, one hash).
  const loadedWorker = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname).find((p) => /engineWorker-/.test(p)) ?? null);
  expect(loadedWorker?.endsWith(precached!)).toBe(true);
  expect(errors).toEqual([]);
});

test("a fatal worker error leaves the tower on TypeScript, and the next tower gets a fresh worker", async ({ page }, info) => {
  test.skip(info.project.name !== WASM_PROJECT, "the engine package is served on the chromium-wasm project");
  await boot(page);
  const after = await page.evaluate(async () => {
    const g = (window as any).game;
    const h = (window as any).__vcEngine;
    const own = h.current();
    own.receive({ type: "error", fatal: true, message: "simulated crash" });
    const fellBack = !h.status.hosted && !Object.prototype.hasOwnProperty.call(g.sim, "serialize");
    g.adoptSim(g.sim.constructor.newGame(5, "classic"));
    return { fellBack, errors: h.status.errors.length };
  });
  expect(after.fellBack).toBe(true);
  expect(after.errors).toBeGreaterThan(0);
  await page.waitForFunction(() => {
    const h = (window as any).__vcEngine;
    return h.status.hosted && h.status.workers === 2 && h.current()?.loaded();
  }, undefined, { timeout: 30_000 });
});

/**
 * Offline on the worker host: with the service worker installed, a reload
 * without the network brings the game back up on the worker host. The
 * worker script and the engine package are both precached (#985), and the
 * worker fetches the package through the page's service worker.
 */
test("an offline reload on the worker host comes back on the worker", async ({ browser }, info) => {
  test.skip(info.project.name !== WASM_PROJECT, "the engine package is served on the chromium-wasm project");
  const ctx = await browser.newContext({ serviceWorkers: "allow" });
  try {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?engine=wasm-worker");
    await page.waitForFunction(() => (window as any).__vcEngine?.current?.()?.loaded?.(), undefined, { timeout: 30_000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForLoadState("networkidle");
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).game) && Boolean((window as any).__vcEngine?.current?.()?.loaded?.()), undefined, { timeout: 30_000 });
    const state = await page.evaluate(() => ({ placement: (window as any).__vcEngine?.status?.placement, hosted: Boolean((window as any).__vcEngine?.status?.hosted) }));
    expect(state).toEqual({ placement: "worker", hosted: true });
    expect(errors).toEqual([]);
  } finally {
    await ctx.setOffline(false);
    await ctx.close();
  }
});
