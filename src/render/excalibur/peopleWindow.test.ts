import { describe, expect, it, vi } from "vitest";
import { peopleWindow, WINDOW_MARGIN } from "./peopleWindow";

/** A camera whose screen edges map to known tiles and floors: tiles 100 to
 *  180 across 800 pixels, floors 30 (top) down to 12 (bottom) over 600. */
function camera() {
  return {
    viewWidth: 800,
    viewHeight: 600,
    screenToTile: vi.fn((sx: number) => 100 + sx / 10),
    screenToFloor: vi.fn((sy: number) => 30 - sy * 0.03),
  };
}

describe("peopleWindow", () => {
  it("is the screen's tiles and floors plus the margin", () => {
    const c = camera();
    expect(peopleWindow(c)).toEqual({
      floorLo: 12 - WINDOW_MARGIN.floors,
      floorHi: 30 + WINDOW_MARGIN.floors,
      xLo: 100 - WINDOW_MARGIN.tiles,
      xHi: 180 + WINDOW_MARGIN.tiles,
    });
    expect(c.screenToTile.mock.calls).toEqual([[0], [800]]);
    expect(c.screenToFloor.mock.calls).toEqual([[600], [0]]);
  });

  it("reaches past the screen on every side", () => {
    expect(WINDOW_MARGIN.tiles).toBeGreaterThan(0);
    expect(WINDOW_MARGIN.floors).toBeGreaterThan(0);
  });
});
