import { describe, it, expect } from "vitest";
import { anchorBeside } from "./UI";

describe("anchorBeside — world-anchored panel placement", () => {
  const size = { w: 200, h: 120 };

  it("prefers the facility's right side when there is room", () => {
    const { left, top } = anchorBeside({ x: 100, y: 50, w: 44 }, size, 1000, 760);
    expect(left).toBe(100 + 44 + 8); // right edge + gap
    expect(top).toBe(50);
  });

  it("flips to the left when the right side would overflow", () => {
    const { left } = anchorBeside({ x: 900, y: 50, w: 44 }, size, 1000, 760);
    expect(left).toBe(900 - 200 - 8); // placed to the left of the rect
  });

  it("clamps so the panel never leaves the viewport", () => {
    // Tiny viewport: flipping left still goes off-screen → clamp to the gap.
    const left = anchorBeside({ x: 5, y: 0, w: 10 }, size, 200, 760).left;
    expect(left).toBe(8);
    // A low facility pushes the panel up so its bottom stays on screen.
    const top = anchorBeside({ x: 100, y: 750, w: 44 }, size, 1000, 760).top;
    expect(top).toBe(760 - 120 - 8);
  });
});
