import { test, expect } from "@playwright/test";

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
