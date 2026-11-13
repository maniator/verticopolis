import { describe, expect, it } from "vitest";
import { wholePixelClip } from "./screenshotCropClip.ts";

/**
 * A crop shot keeps only the pixels its element covers completely, so
 * no row or column of the shot blends in what is painted behind the element
 * (the dimmed tower behind a dialog, which differs between runs).
 */
describe("the screenshot crop rectangle", () => {
  it("keeps a box that sits on whole pixels as it is", () => {
    expect(wholePixelClip({ x: 10, y: 20, width: 300, height: 150 })).toEqual({ x: 10, y: 20, width: 300, height: 150 });
  });

  it("drops the half-covered row and column a dialog centered on a half pixel has", () => {
    // A 154.5 px box starting 0.5 px down: its first row is half backdrop.
    expect(wholePixelClip({ x: 120.5, y: 300.5, width: 558, height: 154.5 })).toEqual({ x: 121, y: 301, width: 557, height: 154 });
  });

  it("rounds a quarter-pixel edge inward to a whole CSS pixel", () => {
    // On a 2x page a quarter CSS pixel is half a device pixel; the crop still
    // keeps whole CSS pixels only, so the capture never widens it back.
    expect(wholePixelClip({ x: 10.25, y: 10.75, width: 100, height: 50 })).toEqual({ x: 11, y: 11, width: 99, height: 49 });
  });

  it("treats float error at an edge as a whole pixel", () => {
    expect(wholePixelClip({ x: 0.1 + 0.2 - 0.3, y: 12.000000001, width: 40, height: 30 })).toEqual({ x: 0, y: 12, width: 40, height: 30 });
  });

  it("refuses an element too small to keep a pixel", () => {
    expect(() => wholePixelClip({ x: 1.2, y: 1.2, width: 0.6, height: 5 })).toThrow(/covers no whole pixel/);
  });
});
