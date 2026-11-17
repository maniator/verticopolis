import { describe, expect, it, vi } from "vitest";
import { CROWD_CULL_ZOOM, CROWD_SHOW_ZOOM } from "./crowdCull";
import { frameWindow, NO_PEOPLE, peopleWindow, WINDOW_MARGIN } from "./peopleWindow";
import { focusPerson, setFollow } from "./personFocus";

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

describe("frameWindow", () => {
  /** The camera above, at `zoom`, with the cull latch as the last frame left it. */
  function engine(zoom: number, crowdCulled: boolean) {
    return { ...camera(), cam: { zoom }, crowdCulled } as unknown as Parameters<typeof frameWindow>[0];
  }

  it("is the screen's window while the crowd is drawn", () => {
    expect(frameWindow(engine(1, false))).toEqual(peopleWindow(camera()));
  });

  it("sends nobody once this frame's zoom culls the crowd, before the latch moves", () => {
    expect(frameWindow(engine(CROWD_CULL_ZOOM / 2, false))).toBe(NO_PEOPLE);
    expect(frameWindow(engine(CROWD_CULL_ZOOM / 2, true))).toBe(NO_PEOPLE);
    // Between the two thresholds the latch decides, as the cull does.
    const between = (CROWD_CULL_ZOOM + CROWD_SHOW_ZOOM) / 2;
    expect(frameWindow(engine(between, true))).toBe(NO_PEOPLE);
    expect(frameWindow(engine(between, false))).toEqual(peopleWindow(camera()));
  });

  it("reads the screen on the frame the cull lifts", () => {
    expect(frameWindow(engine(CROWD_SHOW_ZOOM, true))).toEqual(peopleWindow(camera()));
  });

  it("keeps the window for a followed person at any zoom", () => {
    const e = engine(CROWD_CULL_ZOOM / 2, true);
    focusPerson(e as never, 7);
    expect(frameWindow(e)).toBe(NO_PEOPLE);
    setFollow(e as never, true);
    expect(frameWindow(e)).toEqual(peopleWindow(camera()));
  });

  it("holds nobody: a finite window far below any floor", () => {
    expect([NO_PEOPLE.floorLo, NO_PEOPLE.floorHi, NO_PEOPLE.xLo, NO_PEOPLE.xHi].every(Number.isFinite)).toBe(true);
    expect(NO_PEOPLE.floorHi).toBeLessThan(-1000);
  });
});
