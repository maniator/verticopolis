import { test, expect } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

// On chromium-wasm every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * The WASM switch (story-engine-wasm-switch) in a real browser: with
 * `?engine=wasm` the served package loads, the boot tower is hosted on the
 * Rust engine, the clock advances through it, and a build goes through to
 * both the instance and the engine.
 */
test("the game runs on the WASM engine behind ?engine=wasm", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => {
    const w = window as unknown as { __vcEngine?: { status: { hosted: boolean } }; game?: { sim: unknown } };
    return !!w.__vcEngine?.status.hosted && !!w.game;
  }, undefined, { timeout: 30_000 });
  // The title screen names the engine next to the version, so a tester can
  // tell which engine runs without the console.
  await expect(page.locator(".splash-version")).toContainText("WASM engine");
  // The sim does not tick behind the title screen; dismiss it the way the
  // other specs do.
  await page.evaluate(() => {
    document.getElementById("splash")?.remove();
    (window as any).game.setSpeed(1);
  });
  const before = await page.evaluate(() => (window as any).game.sim.clock.minutes as number);
  await page.waitForFunction((b) => (window as any).game.sim.clock.minutes > b + 5, before, { timeout: 30_000 });
  const result = await page.evaluate(() => {
    const g = (window as any).game;
    const host = (window as any).__vcEngine;
    g.sim.money = 1e9;
    const ok = g.sim.build("lobby", 1, 160).ok;
    host.current().syncStructure();
    return { ok, hosted: host.status.hosted, starts: host.status.starts, errors: host.status.errors, frames: host.current().frames, unitInEngine: JSON.parse(host.current().engine.serialize()).units.some((u: { kind: string; x: number }) => u.kind === "lobby" && u.x === 160) };
  });
  expect(result).toMatchObject({ ok: true, hosted: true, starts: 1, errors: [], unitInEngine: true });
  expect(result.frames).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

/**
 * The priced editor commands (#914) on the hosted engine: a car, an extend
 * and the shared sell path each reach the engine as their own command, and
 * the engine's balance moves by the price with no money write from the page.
 */
test("the car, extend and sell commands charge inside the WASM engine", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-wasm", "the hosted engine runs on the chromium-wasm project");
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => {
    const w = window as unknown as { __vcEngine?: { status: { hosted: boolean } }; game?: { sim: unknown } };
    return !!w.__vcEngine?.status.hosted && !!w.game;
  }, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.getElementById("splash")?.remove());
  const result = await page.evaluate(() => {
    const g = (window as any).game;
    const engine = (window as any).__vcEngine.current().engine;
    g.sim.money = 1e9;
    for (let x = 150; x < 175; x++) g.sim.build("lobby", 1, x);
    for (let f = 2; f <= 3; f++) for (let x = 150; x < 175; x++) g.sim.build("floor", f, x);
    g.sim.build("office", 2, 152);
    g.sim.buildTransport("elevatorStandard", 168, 1, 2);
    const t = g.sim.tower.transportAt(1, 168);
    const office = g.sim.tower.unitAt(2, 152);
    const start = engine.money();
    let writes = 0;
    const setMoney = engine.setMoney.bind(engine);
    engine.setMoney = (amount: number) => { writes++; setMoney(amount); };
    const add = g.sim.addCar(t.id).ok;
    const afterAdd = engine.money();
    const remove = g.sim.removeCar(t.id).ok;
    const extend = g.sim.extendTransport(t.id, "up", 3).ok;
    const sold = g.build.tryRemoveUnit(office, "sell");
    g.build.removeTransportWithRefund(t, "bulldoze");
    engine.setMoney = setMoney;
    return { add, remove, extend, sold, addCost: start - afterAdd, writes, agree: engine.money() === g.sim.money, shaftGone: engine.transportAt(1, 168) == null };
  });
  expect(result).toEqual({ add: true, remove: true, extend: true, sold: true, addCost: 40_000, writes: 0, agree: true, shaftGone: true });
});
