import { describe, it, expect } from "vitest";
import { clampCameraY, fitZoom, FIT_SKY_FLOORS, MIN_FIT_SPAN_FLOORS, MAX_FIT_ZOOM, SKY_HEADROOM_FLOORS } from "./cameraBounds";
import { VIEW_ZOOM_MIN } from "../engine/types";
import { GRID } from "../engine/facilities";
import { CRANE_H } from "./sprites/structure/rooftop";
// Pull the buildable bounds from the real GRID and FLOOR from the pure
// render/scale module so the test can't drift if the tower geometry or the
// render scale changes (the helper itself is parameterized by floorPx).
import { FLOOR } from "./scale";
const MIN_FLOOR = GRID.minFloor; // deepest buildable (B10)
const MAX_FLOOR = GRID.maxFloor;
const VIEW_H = 800;

// The world edges the clamp is built around.
const TOP_Y = -(MAX_FLOOR + SKY_HEADROOM_FLOORS) * FLOOR;
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

  // Regression (crane-rescale review, E1): the sky headroom was a hardcoded
  // 2 floors, sized for the original 76 px crane. The scaled crane perches on
  // the highest built floor (at most MAX_FLOOR - 1; at MAX_FLOOR it comes
  // down) and rises CRANE_H above it, so the clamp ceiling must sit at or
  // above the crane's apex or floors 98-99 play out with the beacon and jib
  // tops unreachable at every legal zoom and pan.
  it("gives the rooftop crane full headroom at the tallest under-construction floor", () => {
    const craneTopY = -(MAX_FLOOR - 1) * FLOOR - CRANE_H; // apex on a 99-floor build
    expect(TOP_Y).toBeLessThanOrEqual(craneTopY);
    // And the camera can actually frame it: panning fully up at a detail zoom
    // puts the visible top edge at (or above) the crane apex.
    const y = clamp(-1e6, 1);
    expect(topEdge(y, 1)).toBeLessThanOrEqual(craneTopY);
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

describe("fitZoom (tower-aware zoom-out floor)", () => {
  const HARD = VIEW_ZOOM_MIN;
  const fit = (viewH: number, span: number) => fitZoom(viewH, span, FLOOR, HARD);
  // How many floors (plus sky) a given zoom frames in a viewport of viewH px.
  const framedFloors = (viewH: number, zoom: number) => viewH / (FLOOR * zoom);

  it("frames a tall tower plus the sky headroom at the floor", () => {
    // An 82-floor tower (the owner's save) on a phone-ish viewport: the fit floor
    // should show the whole tower and the sky margin, and nothing much more.
    const viewH = 567; // measured from the report: ~43 floors at zoom 0.3
    const span = 82;
    const z = fit(viewH, span);
    // Pin the actual zoom to a number worked out by hand, independent of the
    // formula under test: 567 / ((82 + 6) * 45) = 567 / 3960 = 0.143182. A wrong
    // FLOOR or a dropped sky margin would move this; framedFloors alone can't
    // catch that (the FLOOR term cancels out of it). The hand figure tracks the
    // world scale: at the old FLOOR of 44 it read 567 / 3872 = 0.14644.
    expect(z).toBeCloseTo(0.143182, 5);
    expect(framedFloors(viewH, z)).toBeCloseTo(span + FIT_SKY_FLOORS, 5);
    // ...and that is a lot further out than the old fixed 0.3 min.
    expect(z).toBeLessThan(0.3);
  });

  it("counts basements in the span (a deep tower frames its cellars)", () => {
    // Same above-ground height, but ten basements make the tower taller: the fit
    // floor must be MORE zoomed out (smaller) to keep the cellars in frame.
    const viewH = 567;
    const shallow = fit(viewH, 50); // floors 1..50
    const deep = fit(viewH, 60); // floors 1..50 plus B1..B10 -> span 60
    expect(deep).toBeLessThan(shallow);
  });

  it("does not strand a SMALL tower in empty sky (min span framing)", () => {
    // A tiny starter tower frames MIN_FIT_SPAN_FLOORS worth, not its literal 1-2
    // floors, so pinch-out stops at a comfortable frame instead of a thumbnail in
    // an ocean of blue. The floor is the same for any span at or below the min.
    const viewH = 567;
    const empty = fit(viewH, 1);
    const tiny = fit(viewH, 5);
    const atMin = fit(viewH, MIN_FIT_SPAN_FLOORS);
    expect(empty).toBe(tiny);
    expect(empty).toBe(atMin);
    expect(framedFloors(viewH, empty)).toBeCloseTo(MIN_FIT_SPAN_FLOORS + FIT_SKY_FLOORS, 5);
  });

  it("stays finite and framed for an empty tower (no divide-by-zero fling)", () => {
    for (const span of [0, 1, NaN, -Infinity]) {
      const z = fit(567, span);
      expect(Number.isFinite(z)).toBe(true);
      expect(z).toBeGreaterThan(0);
    }
  });

  it("never locks a small tower out of zooming out on a tall screen (ceiling)", () => {
    // A tiny tower on a big portrait tablet: naive fit math would land ABOVE the
    // resting zoom and forbid zoom-out entirely. The ceiling keeps the floor low
    // enough that pulling back always does something.
    const z = fit(2400, 1); // huge viewport, one-floor tower
    expect(z).toBeLessThanOrEqual(MAX_FIT_ZOOM);
  });

  it("never returns below the hard trust-boundary floor", () => {
    // A pathologically tall span on a short screen bottoms out at the hard floor,
    // never underflowing past it.
    const z = fitZoom(200, 5000, FLOOR, HARD);
    expect(z).toBe(HARD);
  });

  it("clamps a non-positive / non-finite viewport to a finite floor", () => {
    for (const bad of [0, -10, NaN, Infinity]) {
      const z = fitZoom(bad, 40, FLOOR, HARD);
      expect(Number.isFinite(z)).toBe(true);
      expect(z).toBeGreaterThanOrEqual(HARD);
    }
  });

  it("the hard floor fits the tallest legal tower, even a small phone in landscape", () => {
    // The whole buildable world (B10..floor 100) with clampCameraY's sky/dirt
    // margins, on a small phone: the fit floor must not be pinned to the hard
    // floor, i.e. the hard floor is low enough to frame it. The manifest allows
    // any orientation, so this has to hold for a SHORT landscape viewport too,
    // not just a tall portrait one.
    const worldSpan = GRID.maxFloor - GRID.minFloor + 1; // 110 floors of building
    for (const viewH of [500 /* portrait-ish */, 360 /* small phone landscape */]) {
      const z = fitZoom(viewH, worldSpan, FLOOR, HARD);
      expect(z).toBeGreaterThan(HARD); // fit math wins, hard floor never clips it
    }
  });
});
