import { describe, it, expect } from "vitest";
import { CRANE_SCALE, CRANE_W, CRANE_H } from "./rooftop";
import { FLOOR } from "../../scale";

/**
 * Guards from the crane-rescale review (spec-crane-scale): the scale is a
 * free-standing constant, so nothing structural stops a retune from breaking
 * the invariants the rest of the render relies on. Pin them at the cheapest
 * tier instead.
 */
describe("crane raster dimensions", () => {
  it("stay integers, so the ex.Canvas backing store never truncates a fractional row", () => {
    // A scale like 2.4 would yield 76 * 2.4 = 182.4: the canvas height setter
    // truncates to 182 while ctx.scale still paints 182.4 px of content,
    // silently clipping the roof pad off the bottom edge.
    expect(Number.isInteger(CRANE_W)).toBe(true);
    expect(Number.isInteger(CRANE_H)).toBe(true);
  });

  it("keep the crane at or above the spec's legibility floor (CAP-1)", () => {
    expect(CRANE_SCALE).toBeGreaterThanOrEqual(2);
    expect(CRANE_H / FLOOR).toBeGreaterThanOrEqual(3.4);
  });
});
