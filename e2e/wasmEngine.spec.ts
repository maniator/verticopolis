/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test";
import { WASM_PROJECT, expectEngineHosted } from "./helpers";

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
 * The priced editor commands (#914, landed in #928) on the hosted engine. Each
 * charge reaches the engine as its own command: the engine's balance moves by
 * exactly the delta the page saw, the page never writes the balance for it,
 * and the two balances agree after every step. A refusal moves neither.
 */
test("the car, extend and removal commands charge inside the WASM engine", async ({ page }, info) => {
  test.skip(info.project.name !== WASM_PROJECT, "the hosted engine runs on the chromium-wasm project");
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
    const built: boolean[] = [];
    for (let x = 150; x < 175; x++) built.push(g.sim.build("lobby", 1, x).ok);
    for (let f = 2; f <= 3; f++) for (let x = 150; x < 175; x++) built.push(g.sim.build("floor", f, x).ok);
    built.push(g.sim.build("office", 2, 152).ok);
    built.push(g.sim.buildTransport("elevatorStandard", 168, 1, 2).ok);
    const shaft = g.sim.tower.transportAt(1, 168);
    const office = g.sim.tower.unitAt(2, 152);
    const setupOk = built.every(Boolean) && shaft?.kind === "elevatorStandard" && office?.kind === "office";
    // Count every balance write the page relays to the engine. A relayed write
    // first proves the counter sees one, then the count starts over.
    let writes = 0;
    const setMoney = engine.setMoney.bind(engine);
    engine.setMoney = (amount: number) => { writes++; setMoney(amount); };
    g.sim.money = g.sim.money + 0;
    const controlWrites = writes;
    writes = 0;
    const steps: { step: string; ok: boolean; delta: number; engineMoved: number; agree: boolean }[] = [];
    const run = (step: string, act: () => { ok: boolean; delta?: number }) => {
      const engineBefore = engine.money();
      const pageBefore = g.sim.money;
      const res = act();
      steps.push({ step, ok: res.ok, delta: res.delta ?? g.sim.money - pageBefore, engineMoved: engine.money() - engineBefore, agree: engine.money() === g.sim.money });
    };
    if (setupOk) {
      run("add car", () => g.sim.addCar(shaft.id));
      run("remove car", () => g.sim.removeCar(shaft.id));
      run("remove last car", () => g.sim.removeCar(shaft.id));
      run("extend up", () => g.sim.extendTransport(shaft.id, "up", 3));
      // The removal helpers return a bare boolean, so the delta is the page's own change.
      run("sell office", () => ({ ok: g.build.tryRemoveUnit(office, "sell") }));
      run("bulldoze shaft", () => ({ ok: g.build.removeTransportWithRefund(shaft, "bulldoze") }));
    }
    engine.setMoney = setMoney;
    const kinds = (JSON.parse(engine.serialize()) as { units: { kind: string }[] }).units.map((u) => u.kind);
    return {
      setupOk, controlWrites, steps, writes,
      shaftGone: engine.transportAt(1, 168) == null && g.sim.tower.transportAt(1, 168) == null,
      officeGone: !kinds.includes("office") && g.sim.tower.unitAt(2, 152)?.kind !== "office",
    };
  });
  expect(result.setupOk, "the setup tower built").toBe(true);
  expect(result.controlWrites, "the counter sees a relayed balance write").toBe(1);
  expect(result.writes, "no balance write during the charges").toBe(0);
  expect(result.shaftGone).toBe(true);
  expect(result.officeGone).toBe(true);
  for (const s of result.steps) {
    expect(s.agree, `${s.step}: engine and page balances agree`).toBe(true);
    expect(s.engineMoved, `${s.step}: engine moved by the page's delta`).toBe(s.delta);
  }
  const by = Object.fromEntries(result.steps.map((s) => [s.step, s]));
  expect(by["add car"]).toMatchObject({ ok: true, delta: -40_000 });
  expect(by["remove car"]).toMatchObject({ ok: true, delta: 20_000 });
  expect(by["remove last car"]).toMatchObject({ ok: false, delta: 0 });
  expect(by["extend up"]).toMatchObject({ ok: true, delta: -5_000 });
  // Half the build price comes back on a sale or a bulldoze.
  expect(by["sell office"]).toMatchObject({ ok: true, delta: 20_000 });
  expect(by["bulldoze shaft"]).toMatchObject({ ok: true, delta: 100_000 });
});
