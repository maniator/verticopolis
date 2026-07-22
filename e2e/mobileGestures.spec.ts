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
 * pinch (stuck zoom, dead taps). The unit layer (src/render/pinchTracker.test.ts)
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
      // Classic founds an empty lot now; lay the 40-tile concourse the taps
      // below place their offices on top of.
      const x0 = Math.floor(g.grid.width / 2) - 20;
      for (let i = 0; i < 40; i++) {
        const r = g.sim.tower.place("lobby", 1, x0 + i);
        if (!r.ok) throw new Error(`concourse lobby at x=${x0 + i}: ${r.reason ?? "refused"}`);
      }
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
      // Middle of floor 2, over the ground concourse laid above: a valid office spot.
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

test.describe("mobile inspect: a tap opens ONE panel with the diagnostics folded in", () => {
  test("a touch tap opens the editor (with the card's diagnostics), never the floating card", async ({ page }) => {
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
      g.speed = 0;
      g.sim.money = 1e9;
      // Classic founds an empty lot now; lay the 40-tile concourse the office
      // tap below needs beneath it.
      const x0 = Math.floor(g.grid.width / 2) - 20;
      for (let i = 0; i < 40; i++) {
        const r = g.sim.tower.place("lobby", 1, x0 + i);
        if (!r.ok) throw new Error(`concourse lobby at x=${x0 + i}: ${r.reason ?? "refused"}`);
      }
    });

    // Build an office to inspect, then switch to the inspect tool, both at the
    // default (desktop) width where the tool palette is docked and clickable.
    // Compare the unit count before/after so the assertion proves THIS tap placed
    // a room, not that the tower merely already had units.
    await page.click('.pal-item[data-kind="office"]');
    const spot = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).game;
      const e = g.engine;
      const zoomPx = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
      return { x: e.worldToScreenX(g.grid.width / 2), y: e.worldToScreenY(2) + zoomPx / 2 };
    });
    const unitsBefore = await page.evaluate(() => (window as any).game.sim.tower.units.length); // eslint-disable-line @typescript-eslint/no-explicit-any
    await dispatchTouch(page, "pointerdown", 8001, spot.x, spot.y);
    await dispatchTouch(page, "pointerup", 8001, spot.x, spot.y);
    const unitsAfter = await page.evaluate(() => (window as any).game.sim.tower.units.length); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(unitsAfter).toBeGreaterThan(unitsBefore);
    await page.click('.pal-item[data-tool="inspect"]');

    // Drop to a PHONE viewport (< 767px, the mobileMq breakpoint) so the tap
    // takes the one-panel mobile path. Both panels start hidden.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#editor")).toHaveClass(/hidden/);
    await expect(page.locator("#inspector")).toHaveClass(/hidden/);

    // Re-derive the tap point (the resize changed world-to-screen), then tap.
    const spot2 = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).game;
      const e = g.engine;
      const zoomPx = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
      return { x: e.worldToScreenX(g.grid.width / 2), y: e.worldToScreenY(2) + zoomPx / 2 };
    });
    await dispatchTouch(page, "pointerdown", 8002, spot2.x, spot2.y);
    await dispatchTouch(page, "pointerup", 8002, spot2.x, spot2.y);

    // The editor opens with the card's diagnostics folded in (the office has no
    // elevator/stair to floor 2, so the access line is present). The floating
    // hover card is NEVER raised on touch: one panel, not two.
    await expect(page.locator("#editor")).not.toHaveClass(/hidden/);
    await expect(page.locator("#editor")).toContainText("Access:");
    await expect(page.locator("#inspector")).toHaveClass(/hidden/);

    // Tapping empty space (well left of the office, nothing built) closes it.
    const empty = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).game;
      const e = g.engine;
      const zoomPx = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
      return { x: e.worldToScreenX(g.grid.width / 2 - 30), y: e.worldToScreenY(2) + zoomPx / 2 };
    });
    await dispatchTouch(page, "pointerdown", 8003, empty.x, empty.y);
    await dispatchTouch(page, "pointerup", 8003, empty.x, empty.y);
    await expect(page.locator("#editor")).toHaveClass(/hidden/);
    await expect(page.locator("#inspector")).toHaveClass(/hidden/);

    expect(errors).toEqual([]);
  });
});

/** True camera zoom (screen px per world px): the on-screen height of one floor
 *  divided by its world height (FLOOR = 44). */
async function trueZoom(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = (window as any).game.engine;
    return Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2)) / 44;
  });
}

/** Drive one pinch-OUT gesture (fingers start far apart, close toward the
 *  center) about the canvas midpoint, then lift both. */
async function pinchOut(
  page: import("@playwright/test").Page,
  cx: number,
  cy: number,
  id: number,
): Promise<void> {
  await dispatchTouch(page, "pointerdown", id, cx - 130, cy);
  await dispatchTouch(page, "pointerdown", id + 1, cx + 130, cy);
  await dispatchTouch(page, "pointermove", id, cx - 30, cy);
  await dispatchTouch(page, "pointermove", id + 1, cx + 30, cy);
  await dispatchTouch(page, "pointerup", id, cx - 30, cy);
  await dispatchTouch(page, "pointerup", id + 1, cx + 30, cy);
}

test.describe("mobile pinch: zoom out frames the whole tower", () => {
  test("a tall tower can be pulled fully into frame, and the floor holds (no void drift)", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto("/");
    await page.waitForFunction(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).game;
      const canvas = document.querySelector<HTMLCanvasElement>("#view");
      return Boolean(g?.sim && g.engine && canvas && canvas.width > 0 && canvas.height > 0);
    });

    // Freeze time, fund, and build an 82-floor tower straight through the Tower
    // API: a ground lobby plus a single supported column of floors up to 82. The
    // dynamic zoom floor only needs the tower's built floor extent, which this
    // gives us without hand-placing a whole city.
    const top = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).game;
      document.getElementById("splash")?.remove();
      g.speed = 0;
      g.sim.money = 1e9;
      const t = g.sim.tower;
      const x = Math.floor(g.grid.width / 2);
      t.place("lobby", 1, x);
      for (let f = 2; f <= 82; f++) t.place("floor", f, x);
      return t.highestFloor as number;
    });
    expect(top).toBe(82);

    const cx = await page.evaluate(() => (document.getElementById("view") as HTMLCanvasElement).clientWidth / 2);
    const cy = await page.evaluate(() => (document.getElementById("view") as HTMLCanvasElement).clientHeight / 2);

    // Pinch out hard several times to drive the camera down to its floor.
    let id = 7100;
    for (let round = 0; round < 8; round++) await pinchOut(page, cx, cy, (id += 2));

    // The tower-aware floor is far past the old fixed 0.3 minimum...
    const floorZoom = await trueZoom(page);
    expect(floorZoom).toBeLessThan(0.3);

    // ...and at it, the whole 82-floor tower is within the viewport.
    const visibleFloors = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = (window as any).game.engine;
      const canvas = document.getElementById("view") as HTMLCanvasElement;
      return canvas.clientHeight / Math.abs(e.worldToScreenY(1) - e.worldToScreenY(2));
    });
    expect(visibleFloors).toBeGreaterThan(82);

    // Pinching out again does NOT keep shrinking the tower into empty sky: the
    // floor holds. (Old behavior would either stop early at 0.3 or, with a naive
    // fix, drift on out into void.)
    const before = await trueZoom(page);
    await pinchOut(page, cx, cy, 7300);
    const after = await trueZoom(page);
    expect(after).toBeCloseTo(before, 2);

    expect(errors).toEqual([]);
  });
});
