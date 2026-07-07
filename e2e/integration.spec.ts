import { test, expect } from "@playwright/test";
import { buildToStar, fitCamera } from "./helpers";

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
    await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game));

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
});
