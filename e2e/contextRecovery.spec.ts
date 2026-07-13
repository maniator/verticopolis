import { test, expect } from "@playwright/test";

/**
 * Tier-2 coverage for the in-place WebGL context-loss recovery, the one piece
 * the vitest suites deliberately pin AROUND (SaveLoad injects a fake
 * attemptGraphicsRecovery; contextRecovery injects a fake rebuild): here the
 * REAL rebuild runs in a browser. WEBGL_lose_context forces an actual loss and
 * restore, and the test asserts the player-visible invariants of
 * GameApp.rebuildEngine: no crash screen, a fresh live engine on a fresh
 * canvas, the camera exactly where it was, input rewired, the sim advancing,
 * and the autosave flushed. A second forced loss inside the 90s window then
 * exercises the escalation path for real: the crash screen with the repeat
 * advice.
 */
test.describe("WebGL context loss: in-place recovery", () => {
  test("a first loss recovers in place; a rapid second loss escalates to the crash screen", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const g = (window as unknown as { game?: { sim?: unknown } }).game;
      return Boolean(g?.sim) && Boolean(document.getElementById("splash"));
    });
    // Enter play the way the teardown leaves the DOM (node removed) and get
    // the clock running so "the sim still advances" is a meaningful check.
    await page.evaluate(() => {
      document.getElementById("splash")?.remove();
      document.querySelector<HTMLButtonElement>('#speed button[data-speed="1"]')?.click();
    });

    // Pin a recognizable camera and remember the pre-crash identities.
    const before = await page.evaluate(() => {
      const w = window as unknown as { game: { engine: { setCamera(t: number, f: number, z: number): void; viewState(): { tile: number; floor: number; zoom?: number } } }; __old?: unknown };
      w.game.engine.setCamera(120, 8, 1.4);
      (window as unknown as Record<string, unknown>).__oldEngine = w.game.engine;
      (window as unknown as Record<string, unknown>).__oldCanvas = document.getElementById("view");
      return w.game.engine.viewState();
    });

    // Force a real context loss; keep the extension handle to restore with.
    await page.evaluate(() => {
      const gl = (document.getElementById("view") as HTMLCanvasElement).getContext("webgl2")!;
      (window as unknown as Record<string, unknown>).__ext = gl.getExtension("WEBGL_lose_context");
      (gl.getExtension("WEBGL_lose_context") as WEBGL_lose_context).loseContext();
    });
    await expect(page.locator("#crash-screen")).toHaveCount(0); // recovering, no dead end
    await page.evaluate(() => ((window as unknown as Record<string, unknown>).__ext as WEBGL_lose_context).restoreContext());

    // The rebuild swaps in a fresh engine on a fresh canvas.
    await page.waitForFunction(() => {
      const w = window as unknown as { game: { engine: unknown } };
      return w.game.engine !== (window as unknown as Record<string, unknown>).__oldEngine;
    });
    const after = await page.evaluate(() => {
      const w = window as unknown as {
        game: { engine: { viewState(): { tile: number; floor: number; zoom?: number } }; sim: { clock: { minutes: number }; log: { text: string }[] } };
      };
      return {
        crashScreen: Boolean(document.getElementById("crash-screen")),
        freshCanvas: document.getElementById("view") !== (window as unknown as Record<string, unknown>).__oldCanvas,
        view: w.game.engine.viewState(),
        minutes: w.game.sim.clock.minutes,
        logged: w.game.sim.log.some((e) => e.text.includes("recovered on the spot")),
        saved: Boolean(localStorage.getItem("verticopolis-save")),
      };
    });
    expect(after.crashScreen).toBe(false);
    expect(after.freshCanvas).toBe(true);
    expect(after.view.tile).toBeCloseTo(before.tile, 3);
    expect(after.view.floor).toBeCloseTo(before.floor, 3);
    expect(after.view.zoom ?? 0).toBeCloseTo(before.zoom ?? 0, 3);
    expect(after.logged).toBe(true); // the bulletin keeps the evidence
    expect(after.saved).toBe(true); // the tower was flushed before recovering

    // The new engine is alive: the sim keeps advancing and input is rewired
    // (a wheel zoom on the fresh canvas moves the camera).
    await page.waitForFunction((m0) => (window as unknown as { game: { sim: { clock: { minutes: number } } } }).game.sim.clock.minutes > m0, after.minutes);
    await page.mouse.move(200, 300);
    await page.mouse.wheel(0, -400);
    await page.waitForFunction(
      (z0) => ((window as unknown as { game: { engine: { viewState(): { zoom?: number } } } }).game.engine.viewState().zoom ?? 0) > z0,
      after.view.zoom ?? 0,
    );

    // A second loss inside the 90s window is a repeat: the crash screen takes
    // over, with the device-distress advice.
    await page.evaluate(() => {
      const gl = (document.getElementById("view") as HTMLCanvasElement).getContext("webgl2")!;
      gl.getExtension("WEBGL_lose_context")!.loseContext();
    });
    await expect(page.locator("#crash-screen")).toBeVisible();
    await expect(page.locator("#crash-screen")).toContainText("second crash in a row");
  });
});
