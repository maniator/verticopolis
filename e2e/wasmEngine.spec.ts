/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test";
import { onWasm, expectEngineHosted } from "./helpers";

// On chromium-wasm every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * The WASM switch (story-engine-wasm-switch) in a real browser: with
 * `?engine=wasm` the served package loads, the boot tower is hosted on the
 * Rust engine, the clock advances through it, and a build reaches the
 * engine.
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
  await expect(page.locator(".splash-version")).toContainText("Rust engine");
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
    g.syncSim();
    const unitInEngine = JSON.parse(host.port.serialize()).units.some((u: { kind: string; x: number }) => u.kind === "lobby" && u.x === 160);
    return { ok, hosted: host.status.hosted, lastError: host.status.lastError, onEngine: g.enginePort === host.port, unitInEngine };
  });
  expect(result).toEqual({ ok: true, hosted: true, lastError: null, onEngine: true, unitInEngine: true });
  expect(errors).toEqual([]);
});

/**
 * The priced editor commands (#914, landed in #928) on the Rust engine. Each
 * charge is the engine's own: the balance change a command reports is exactly
 * how far the engine's balance moved, and a refusal moves nothing.
 */
test("the car, extend and removal commands charge inside the WASM engine", async ({ page }, info) => {
  test.skip(!onWasm(info.project.name), "the hosted engine runs on the chromium-wasm and chromium-wasm-only projects");
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => {
    const w = window as unknown as { __vcEngine?: { status: { hosted: boolean } }; game?: unknown };
    return !!w.__vcEngine?.status.hosted && !!w.game;
  }, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.getElementById("splash")?.remove());
  const result = await page.evaluate(() => {
    const g = (window as any).game;
    const engine = g.enginePort;
    const sim = g.sim;
    sim.money = 1e9;
    const built: boolean[] = [];
    for (let x = 150; x < 175; x++) built.push(sim.build("lobby", 1, x).ok);
    for (let f = 2; f <= 3; f++) for (let x = 150; x < 175; x++) built.push(sim.build("floor", f, x).ok);
    built.push(sim.build("office", 2, 152).ok);
    built.push(sim.buildTransport("elevatorStandard", 168, 1, 2).ok);
    const shaft = sim.tower.transportAt(1, 168);
    const office = sim.tower.unitAt(2, 152);
    const setupOk = built.every(Boolean) && shaft?.kind === "elevatorStandard" && office?.kind === "office";
    g.syncSim();
    const steps: { step: string; ok: boolean; delta: number; engineMoved: number }[] = [];
    const run = (step: string, act: () => { ok: boolean; delta?: number }) => {
      const before = engine.money();
      const res = act();
      const engineMoved = engine.money() - before;
      steps.push({ step, ok: res.ok, delta: res.delta ?? engineMoved, engineMoved });
    };
    const sent = (rec: Float64Array) => ({ ok: rec[0] === 1, delta: rec[1] });
    if (setupOk) {
      // Through the port, as the editor sends them.
      run("add car", () => sent(engine.changeCars(shaft.id, true)));
      run("remove car", () => sent(engine.changeCars(shaft.id, false)));
      run("remove last car", () => sent(engine.changeCars(shaft.id, false)));
      run("extend up", () => sent(engine.extendShaft(shaft.id, true, 3)));
      // The removal helpers answer a bare boolean, so the delta is the engine's own change.
      run("sell office", () => ({ ok: g.build.tryRemoveUnit(office, "sell") }));
      run("bulldoze shaft", () => ({ ok: g.build.removeTransportWithRefund(shaft, "bulldoze") }));
    }
    const save = JSON.parse(engine.serialize()) as { units: { kind: string }[]; transports: { x: number }[] };
    return {
      setupOk, steps,
      shaftGone: !save.transports.some((t) => t.x === 168),
      officeGone: !save.units.some((u) => u.kind === "office"),
    };
  });
  expect(result.setupOk, "the setup tower built").toBe(true);
  expect(result.shaftGone).toBe(true);
  expect(result.officeGone).toBe(true);
  for (const s of result.steps) expect(s.engineMoved, `${s.step}: the engine moved by the reported change`).toBe(s.delta);
  const by = Object.fromEntries(result.steps.map((s) => [s.step, s]));
  expect(by["add car"]).toMatchObject({ ok: true, delta: -40_000 });
  expect(by["remove car"]).toMatchObject({ ok: true, delta: 20_000 });
  expect(by["remove last car"]).toMatchObject({ ok: false, delta: 0 });
  expect(by["extend up"]).toMatchObject({ ok: true, delta: -5_000 });
  // Half the build price comes back on a sale or a bulldoze.
  expect(by["sell office"]).toMatchObject({ ok: true, delta: 20_000 });
  expect(by["bulldoze shaft"]).toMatchObject({ ok: true, delta: 100_000 });
});
