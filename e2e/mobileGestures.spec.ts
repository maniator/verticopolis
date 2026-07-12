import { test, expect } from "@playwright/test";

/**
 * Regression coverage for the mobile multi-touch bugs fixed in 1.18.2: pinch
 * zoom wedging into a broken state and taps being swallowed before placement.
 *
 * Root cause was Excalibur 0.32 renumbering its public pointerId when a
 * contact lifts mid-gesture (the id is the index of the native id in the
 * sorted active set). Lifting the FIRST-placed finger of a pinch first made
 * the survivor's up arrive under a different id than its down, stranding a
 * phantom contact; every later one-finger press then read as a two-finger
 * pinch (stuck zoom, dead taps). The unit layer (src/tests/pinchTracker.test.ts)
 * pins the pure state machine; THIS spec drives the real browser pipeline
 * (native PointerEvents through Excalibur's receiver into TowerEngine), so an
 * Excalibur upgrade or input-wiring change that reintroduces the class of bug
 * fails CI before it can ship.
 *
 * Events are dispatched with realistic monotonically-increasing native
 * pointerIds (as Android Chrome assigns) so Excalibur's id normalization is
 * exercised for real, not simulated.
 */

/** Dispatch one synthetic touch PointerEvent on the game canvas at
 *  canvas-relative coordinates. Self-contained for page.evaluate. */
function touchArgs(type: string, id: number, x: number, y: number) {
  return { type, id, x, y };
}

async function dispatchTouch(
  page: import("@playwright/test").Page,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  id: number,
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(({ type, id, x, y }) => {
    const canvas = document.getElementById("view") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        pointerType: "touch",
        isPrimary: false,
        button: 0,
        buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
        clientX: r.left + x,
        clientY: r.top + y,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, touchArgs(type, id, x, y));
  // Excalibur flushes pointer events in its update loop; let two frames run.
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** Camera zoom derived from two world points (no absolute-zoom getter). */
async function readZoom(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = (window as any).game.engine;
    return Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2)) / 34; // FLOOR px
  });
}

test.describe("mobile multi-touch gestures: pinch survives any finger lift order", () => {
  test("pinch (lift first-placed finger first), then taps still place and zoom still responds", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto("/");
    await page.waitForFunction(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).game;
      const canvas = document.querySelector<HTMLCanvasElement>("#view");
      return Boolean(g?.sim && g.engine && canvas && canvas.width > 0 && canvas.height > 0);
    });
    await page.evaluate(() => {
      document.getElementById("splash")?.remove();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).game;
      g.speed = 0; // freeze time; input handling is frame-driven, not sim-driven
      g.sim.money = 1e9; // placement must only depend on the gesture, never funds
    });

    const cx = await page.evaluate(() => (document.getElementById("view") as HTMLCanvasElement).clientWidth / 2);
    const cy = await page.evaluate(() => (document.getElementById("view") as HTMLCanvasElement).clientHeight / 2);

    // ---- Phase 1: pinch zoom IN, lifting the FIRST-placed finger first ----
    // (the exact order that used to strand a phantom contact forever).
    const zoomStart = await readZoom(page);
    await dispatchTouch(page, "pointerdown", 7001, cx - 40, cy);
    await dispatchTouch(page, "pointerdown", 7002, cx + 40, cy);
    await dispatchTouch(page, "pointermove", 7001, cx - 70, cy);
    await dispatchTouch(page, "pointermove", 7002, cx + 70, cy);
    await dispatchTouch(page, "pointermove", 7001, cx - 100, cy);
    await dispatchTouch(page, "pointermove", 7002, cx + 100, cy);
    const zoomPinched = await readZoom(page);
    expect(zoomPinched).toBeGreaterThan(zoomStart * 1.5); // the pinch really zoomed

    await dispatchTouch(page, "pointerup", 7001, cx - 100, cy); // FIRST-placed finger lifts FIRST
    await dispatchTouch(page, "pointermove", 7002, cx + 60, cy - 30); // survivor keeps dragging (pan hand-off)
    await dispatchTouch(page, "pointerup", 7002, cx + 60, cy - 30);

    // The survivor's drag+release must not have stranded a build ghost.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ghost = await page.evaluate(() => Boolean(((window as any).game.engine as any).preview));
    expect(ghost).toBe(false);

    // ---- Phase 2: a single-finger tap with a build tool still places ----
    // (with the phantom contact of the old bug, this tap was misread as a
    // pinch start and swallowed: nothing placed, no message, forever).
    await page.click('.pal-item[data-kind="office"]');
    const unitsBefore = await page.evaluate(() => (window as any).game.sim.tower.units.length); // eslint-disable-line @typescript-eslint/no-explicit-any
    const tap = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).game;
      const e = g.engine;
      // Middle of floor 2, over the seeded ground lobby: a valid office spot.
      const zoomPx = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
      return { x: e.worldToScreenX(g.grid.width / 2), y: e.worldToScreenY(2) + zoomPx / 2 };
    });
    await dispatchTouch(page, "pointerdown", 7003, tap.x, tap.y);
    await dispatchTouch(page, "pointerup", 7003, tap.x, tap.y);
    const unitsAfter = await page.evaluate(() => (window as any).game.sim.tower.units.length); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(unitsAfter).toBeGreaterThan(unitsBefore); // the tap placed a room

    // ---- Phase 3: pinch zoom OUT still responds (zoom is not "stuck") ----
    const zoomBeforeOut = await readZoom(page);
    await dispatchTouch(page, "pointerdown", 7004, cx - 100, cy);
    await dispatchTouch(page, "pointerdown", 7005, cx + 100, cy);
    await dispatchTouch(page, "pointermove", 7004, cx - 50, cy);
    await dispatchTouch(page, "pointermove", 7005, cx + 50, cy);
    const zoomOut = await readZoom(page);
    expect(zoomOut).toBeLessThan(zoomBeforeOut * 0.75);
    await dispatchTouch(page, "pointerup", 7005, cx + 50, cy); // lift SECOND-placed first this time
    await dispatchTouch(page, "pointerup", 7004, cx - 50, cy);

    // ---- Phase 4: a cancelled pinch (browser takes the gesture) recovers ----
    await dispatchTouch(page, "pointerdown", 7006, cx - 40, cy);
    await dispatchTouch(page, "pointerdown", 7007, cx + 40, cy);
    await dispatchTouch(page, "pointercancel", 7006, cx - 40, cy);
    await dispatchTouch(page, "pointercancel", 7007, cx + 40, cy);
    const units2 = await page.evaluate(() => (window as any).game.sim.tower.units.length); // eslint-disable-line @typescript-eslint/no-explicit-any
    // Recompute the tap point: the phase-3 zoom changed the world-to-screen
    // mapping, so the phase-2 coordinates now land on different tiles.
    const tap2 = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).game;
      const e = g.engine;
      const zoomPx = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
      // Floor 3, above the office phase 2 placed on floor 2: still supported.
      return { x: e.worldToScreenX(g.grid.width / 2), y: e.worldToScreenY(3) + zoomPx / 2 };
    });
    await dispatchTouch(page, "pointerdown", 7008, tap2.x, tap2.y);
    await dispatchTouch(page, "pointerup", 7008, tap2.x, tap2.y);
    const units3 = await page.evaluate(() => (window as any).game.sim.tower.units.length); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(units3).toBeGreaterThan(units2); // taps still work after cancels

    // The whole gesture storm produced no uncaught errors.
    expect(errors).toEqual([]);
  });
});
