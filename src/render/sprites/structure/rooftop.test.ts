import { describe, it, expect, vi } from "vitest";
import { CRANE_MAST_ANCHOR_X, CRANE_MIN_ROOF_TILES, CRANE_SCALE, CRANE_W, CRANE_H, craneRoof, drawCrane } from "./rooftop";
import { FLOOR, TILE } from "../../scale";

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

/**
 * The crane stands on a roof. Its actor is anchored at the mast, so the mast
 * and its roof pad sit over the top run's center, and a top narrower than the
 * pad (a spire) gets no crane at all.
 */
describe("where the crane stands", () => {
  /** The roof pad drawCrane paints first, in scaled canvas pixels. */
  function padRect(): { x: number; w: number } {
    const fillRect = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillRect,
    } as unknown as CanvasRenderingContext2D;
    drawCrane(ctx, 0, false);
    const [x, , w] = fillRect.mock.calls[0] as number[];
    return { x: x * CRANE_SCALE, w: w * CRANE_SCALE };
  }

  it("anchors the actor at the middle of the mast's roof pad", () => {
    const pad = padRect();
    expect(CRANE_MAST_ANCHOR_X * CRANE_W).toBe(pad.x + pad.w / 2);
  });

  it("needs a roof at least as wide as the pad", () => {
    const pad = padRect();
    expect(CRANE_MIN_ROOF_TILES * TILE).toBeGreaterThanOrEqual(pad.w);
    expect((CRANE_MIN_ROOF_TILES - 1) * TILE).toBeLessThan(pad.w);
  });

  it("measures the widest top run, so a one-tile spire is too narrow", () => {
    expect(craneRoof([84])).toEqual({ center: 84.5, width: 1 });
    expect(craneRoof([84]).width).toBeLessThan(CRANE_MIN_ROOF_TILES);
    expect(craneRoof([1, 2, 10, 11, 12, 13, 14])).toEqual({ center: 12.5, width: 5 });
  });
});
