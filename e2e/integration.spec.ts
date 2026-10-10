import { test, expect } from "@playwright/test";
import { buildToStar, engineSave, expectEngineHosted, fitCamera, WASM_PROJECT } from "./helpers";

// On chromium-wasm every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * Integration coverage for the two files kept OUT of the vitest unit set because
 * they can't run headless — src/main.ts (the composition root, whose constructor
 * boots the WebGL TowerEngine) and src/render/excalibur/TowerEngine.ts. Here they
 * run for real in a browser: the app boots, wires the GameApp, renders a live
 * tower through the engine, and survives a build round-trip without a single
 * uncaught error. This is the "unit-exempt, integration-covered" half of the
 * coverage strategy made explicit (see vite.config.ts coverage comment).
 */
test.describe("app integration — main.ts + TowerEngine boot/render boundary", () => {
  test("boots the composition root, renders the canvas, and round-trips a build error-free", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto("/");
    // Wait for the invariants we actually assert, not just for `window.game` to
    // exist — main.ts could publish the handle before every sub-system is wired.
    await page.waitForFunction(() => {
      const g = (window as unknown as { game?: { sim?: unknown; engine?: unknown; audio?: unknown } }).game;
      const canvas = document.querySelector<HTMLCanvasElement>("#view");
      return Boolean(g?.sim && g.engine && g.audio && canvas && canvas.width > 0 && canvas.height > 0);
    });

    // main.ts wired the GameApp: the sim, the engine, the audio facade and the
    // canvas element are all present — the constructor ran end to end.
    const wired = await page.evaluate(() => {
      const g = (window as unknown as { game: Record<string, unknown> }).game;
      const canvas = document.querySelector<HTMLCanvasElement>("#view");
      return {
        hasSim: Boolean(g.sim),
        hasEngine: Boolean(g.engine),
        hasAudio: Boolean(g.audio),
        canvasSized: Boolean(canvas && canvas.width > 0 && canvas.height > 0),
      };
    });
    expect(wired).toEqual({ hasSim: true, hasEngine: true, hasAudio: true, canvasSized: true });

    // Dismiss the splash and grow a real tower THROUGH the engine + sim. That the
    // rating genuinely reaches 3★ proves the whole main.ts↔engine↔sim loop ran.
    await page.evaluate(() => document.getElementById("splash")?.remove());
    const reached = await page.evaluate(buildToStar, 3);
    expect(reached).toBe(3);
    await expectEngineHosted(page);

    // Frame the tower so TowerEngine reconciles the built world to the canvas,
    // and let several frames render.
    await page.evaluate(fitCamera);
    await page.waitForTimeout(500);

    // The whole boot → build → render path produced no uncaught error. main.ts
    // routes any thrown frame to console (its per-frame error containment) rather
    // than letting Excalibur halt the loop, so a TowerEngine render throw would
    // surface here — an empty error list means the engine booted and kept drawing
    // the live tower cleanly.
    expect(errors).toEqual([]);
  });

  // A loaded save can carry a pending fire/bomb emergency (EventSystem serializes
  // `pending`). Now that a returning player sees the title screen on boot, the
  // per-frame auto-surfacing must NOT pop that modal over the splash, and must not
  // let anything mutate the tower behind it: resolving an emergency runs
  // `resolveChoice` (pays money / applies the outcome), and autosave trusts that
  // nothing changes while the splash is up. This exercises the guard in the live
  // update() loop, which needs a real canvas/WebGL GameApp and so can't be unit-
  // tested (same reason resolveBootScreen was extracted). It fails on the pre-fix
  // code (the modal surfaces over the splash) and passes with the `!splashUp` guard.
  test("does not surface an emergency over the splash (no sim mutation behind the title screen)", async ({ page }) => {
    // Stage the returning player for real: write an autosave whose tower carries
    // a pending bomb threat (the shape EventSystem serializes), then reload so
    // boot loads it behind the title screen. A load is how a save's state reaches
    // the WASM engine, so on chromium-wasm the engine holds the emergency too.
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as unknown as { game?: { saveLoad?: unknown } }).game?.saveLoad));
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).game;
      const Sim = g.sim.constructor;
      const s = Sim.deserialize(JSON.parse(JSON.stringify(g.sim.serialize())));
      s.events.pending = {
        kind: "bombThreat",
        cost: 300_000,
        message: "TEST bomb threat: pay the ransom or have Security search the tower.",
      };
      // SaveLoad writes the app's current tower, so lend it the staged one for
      // the one synchronous write and put the live tower straight back.
      const live = g.sim;
      g.sim = s;
      try {
        g.saveLoad.save(true);
      } finally {
        g.sim = live;
      }
    });
    await page.reload();
    // A returning player's boot shows the title screen over the loaded tower;
    // wait for the wired sim AND the splash together.
    await page.waitForFunction(() => {
      const g = (window as unknown as { game?: { sim?: { pendingChoice?: unknown } } }).game;
      return Boolean(g?.sim?.pendingChoice) && Boolean(document.getElementById("splash"));
    });
    await expectEngineHosted(page);
    if (test.info().project.name === WASM_PROJECT) {
      expect((await engineSave(page))?.events?.pending).toMatchObject({ kind: "bombThreat", cost: 300_000 });
    }

    const splash = page.locator("#splash");
    const modal = page.locator("#modal");
    await expect(splash).toBeVisible();

    // The app is already paused behind the splash.
    const moneyBefore = await page.evaluate(
      () => (window as unknown as { game: { sim: { money: number } } }).game.sim.money,
    );

    // Give the ~6Hz surfacing loop several cycles to (wrongly) fire. With the
    // guard, the emergency modal stays closed the whole time the splash is up.
    await page.waitForTimeout(500);
    await expect(splash).toBeVisible();
    await expect(modal).toBeHidden();
    const moneyDuring = await page.evaluate(
      () => (window as unknown as { game: { sim: { money: number } } }).game.sim.money,
    );
    expect(moneyDuring).toBe(moneyBefore); // nothing paid / resolved behind the splash

    // Dismiss the splash the way teardown leaves the DOM (the node is removed), and
    // the very same pending emergency now surfaces on the next calm tick.
    await page.evaluate(() => document.getElementById("splash")?.remove());
    await expect(modal).toBeVisible();
    // Surfacing alone still hasn't mutated the tower; only answering the modal would.
    const moneyAfter = await page.evaluate(
      () => (window as unknown as { game: { sim: { money: number } } }).game.sim.money,
    );
    expect(moneyAfter).toBe(moneyBefore);
  });
});
