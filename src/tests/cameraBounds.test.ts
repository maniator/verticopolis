import { describe, it, expect } from "vitest";
import { clampCameraY } from "../render/cameraBounds";
import { GRID } from "../engine/facilities";
// Pull the buildable bounds from the real GRID and FLOOR from the pure
// render/scale module so the test can't drift if the tower geometry or the
// render scale changes (the helper itself is parameterized by floorPx).
import { FLOOR } from "../render/scale";
const MIN_FLOOR = GRID.minFloor; // deepest buildable (B10)
const MAX_FLOOR = GRID.maxFloor;
const VIEW_H = 800;

// The world edges the clamp is built around.
const TOP_Y = -(MAX_FLOOR + 2) * FLOOR;
const BOTTOM_Y = -(MIN_FLOOR - 2) * FLOOR;

const clamp = (y: number, zoom: number) =>
  clampCameraY(y, VIEW_H, zoom, FLOOR, MIN_FLOOR, MAX_FLOOR);
const bottomEdge = (y: number, zoom: number) => y + VIEW_H / 2 / zoom;
const topEdge = (y: number, zoom: number) => y - VIEW_H / 2 / zoom;

describe("clampCameraY", () => {
  // The bug being fixed: zoomed/panned out, the view showed empty void below
  // the deepest buildable basement. The visible bottom edge must never drop
  // below the world bottom, at ANY zoom.
  it("never reveals void below the buildable basement, across all zoom levels", () => {
    for (const zoom of [0.3, 0.5, 0.9, 1, 1.5, 2, 3]) {
      const y = clamp(1e6, zoom); // try to pan all the way down
      expect(bottomEdge(y, zoom)).toBeLessThanOrEqual(BOTTOM_Y + 1e-6);
    }
  });

  it("never scrolls past the sky cap above the top floor", () => {
    for (const zoom of [0.3, 0.9, 1, 2, 3]) {
      const y = clamp(-1e6, zoom); // try to pan all the way up
      expect(topEdge(y, zoom)).toBeGreaterThanOrEqual(TOP_Y - 1e-6);
    }
  });

  it("leaves an in-bounds target untouched when zoomed in", () => {
    // Zoomed in, a centered target well inside the world should pass through.
    const y = -20 * FLOOR;
    expect(clamp(y, 2)).toBeCloseTo(y);
  });

  it("pins the ground to the bottom when the world is shorter than the viewport", () => {
    // Extremely zoomed out: half-height exceeds the whole world height, so the
    // ground is pinned to the bottom edge (sky fills the rest) — no floating.
    const tinyZoom = 0.05;
    const y = clamp(0, tinyZoom);
    expect(bottomEdge(y, tinyZoom)).toBeCloseTo(BOTTOM_Y);
  });

  it("stays finite for a zero / negative / NaN zoom", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const y = clamp(0, bad);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("stays finite for a non-finite desired Y", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(Number.isFinite(clamp(bad, 1))).toBe(true);
    }
  });

  it("regression: the old center-only clamp would have exposed void", () => {
    // The previous clamp bounded the camera *center* at (2 - minFloor)*FLOOR and
    // ignored zoom, so the bottom edge sank far past the basement when zoomed
    // out. Confirm the new clamp sits strictly higher (less void) in that case.
    const zoom = 0.3;
    const oldCenterMax = (2 - MIN_FLOOR) * FLOOR;
    const newY = clamp(1e6, zoom);
    expect(newY).toBeLessThan(oldCenterMax);
    expect(bottomEdge(newY, zoom)).toBeLessThan(bottomEdge(oldCenterMax, zoom));
  });
});
