/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { WASM_PROJECT } from "./helpers";

/**
 * The runtime fallback (#874) in a real browser, on the switchable build:
 * a hosted engine that traps mid-game freezes, the tower goes back to its
 * last restore point on the TypeScript engine with a log line, and the game
 * keeps running. The trap is forced at the binding boundary, as the
 * integration tests do: the real method runs, then the call throws a
 * RuntimeError, and every later call on that engine throws the borrow error
 * a poisoned wasm-bindgen object throws. Not under `wasmEngine.spec.ts`,
 * whose every test must end on the engine.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== WASM_PROJECT, "forces a trap on the hosted engine of the switchable build"));
test.setTimeout(90_000);

async function runningOnEngine(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => !!(window as any).__vcEngine?.status.hosted && !!(window as any).game, undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    const g = (window as any).game;
    // Leave the title screen as a player does. Removing its element alone
    // leaves the onboarding thinking it is up, and the recovery's adopt would
    // then take it down and pause the game.
    g.onboarding.dismissSplash();
    g.sim.money = 1e9;
    for (let x = 160; x < 190; x++) g.sim.build("lobby", 1, x);
    g.setSpeed(1);
  });
  const before = await page.evaluate(() => (window as any).game.sim.clock.minutes as number);
  await page.waitForFunction((b) => (window as any).game.sim.clock.minutes > b + 5, before, { timeout: 30_000 });
  return errors;
}

/** Make the hosted engine's `method` run, then trap and poison the engine. */
async function trapAfter(page: Page, method: string): Promise<void> {
  await page.evaluate((name) => {
    const engine = (window as any).__vcEngine.current().engine;
    const proto = Object.getPrototypeOf(engine);
    const real = engine[name].bind(engine);
    const poison = () => {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === "constructor" || typeof Object.getOwnPropertyDescriptor(proto, key)?.value !== "function") continue;
        Object.defineProperty(engine, key, {
          value: () => {
            throw new Error("recursive use of an object detected which would lead to unsafe aliasing in rust");
          },
          configurable: true,
          writable: true,
        });
      }
    };
    Object.defineProperty(engine, name, {
      value: (...args: unknown[]) => {
        real(...args);
        poison();
        throw new WebAssembly.RuntimeError("unreachable");
      },
      configurable: true,
      writable: true,
    });
  }, method);
}

const state = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    const sim = w.game.sim;
    return {
      hosted: Boolean(w.__vcEngine.status.hosted),
      fallbacks: w.__vcEngine.status.fallbacks as number,
      lastFallback: w.__vcEngine.status.lastFallback as { reason: string; stage: string } | null,
      lastError: w.__vcEngine.status.lastError as string | null,
      onTypeScript: !Object.prototype.hasOwnProperty.call(sim, "serialize"),
      // The last few lines: the TypeScript engine may log more once it runs.
      recentLog: (sim.log.slice(-5) as { text: string }[]).map((e) => e.text).join("\n"),
      minutes: sim.clock.minutes as number,
      lobbies: (sim.tower.units as { kind: string }[]).filter((u) => u.kind === "lobby").length,
    };
  });

test("a tick that traps mid-game falls back to TypeScript and the game keeps running", async ({ page }) => {
  const errors = await runningOnEngine(page);
  await trapAfter(page, "tick");
  await page.waitForFunction(() => (window as any).__vcEngine.status.fallbacks === 1, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => !Object.prototype.hasOwnProperty.call((window as any).game.sim, "serialize"), undefined, { timeout: 30_000 });
  const after = await state(page);
  expect(after).toMatchObject({ hosted: false, fallbacks: 1, lastFallback: { reason: "trap-tick", stage: "start" }, onTypeScript: true, lobbies: 30 });
  expect(after.lastError).toMatch(/failed during a tick: unreachable/);
  expect(after.recentLog).toMatch(/WASM engine stopped/);
  // The UI shows the line as an alert toast.
  await expect(page.locator("#toast-wrap .toast.bad[role=alert]", { hasText: "The WASM engine stopped" })).toBeVisible({ timeout: 10_000 });
  // The TypeScript engine runs the tower now, and the fault was the only error.
  await page.waitForFunction((b) => (window as any).game.sim.clock.minutes > b + 5, after.minutes, { timeout: 30_000 });
  expect((await state(page)).fallbacks).toBe(1);
  expect(errors.filter((e) => !/the WASM engine failed during a tick/.test(e))).toEqual([]);
});

test("a command that traps falls back without throwing to the caller, and the edit is undone", async ({ page }) => {
  const errors = await runningOnEngine(page);
  await page.evaluate(() => (window as any).game.setSpeed(0));
  await trapAfter(page, "build");
  const answer = await page.evaluate(() => (window as any).game.sim.build("lobby", 1, 190).ok as boolean);
  expect(answer).toBe(true);
  await page.waitForFunction(() => !Object.prototype.hasOwnProperty.call((window as any).game.sim, "serialize"), undefined, { timeout: 30_000 });
  const after = await state(page);
  expect(after).toMatchObject({ hosted: false, fallbacks: 1, lastFallback: { reason: "trap-command", stage: "start" }, onTypeScript: true });
  // The restore point is from before the trapped build, so it is undone, and
  // the player is told.
  expect(after.lobbies).toBe(30);
  expect(after.recentLog).toMatch(/your recent changes were undone/);
  await expect(page.locator("#toast-wrap .toast.bad[role=alert]", { hasText: "your recent changes were undone" })).toBeVisible({ timeout: 10_000 });
  expect(errors.filter((e) => !/the WASM engine failed during a command/.test(e))).toEqual([]);
  // A later tower stays on TypeScript for the rest of the page life.
  await page.evaluate(() => {
    const g = (window as any).game;
    g.adoptSim(g.sim.constructor.newGame(3, "classic"));
  });
  expect(await state(page)).toMatchObject({ hosted: false, onTypeScript: true, fallbacks: 1 });
});
