import { describe, it, expect } from "vitest";
import { anchorBeside } from "./UI";
import { anchorInspector } from "./uiPanels";
import type { UI } from "./UI";

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

describe("anchorInspector: flip-aware card placement", () => {
  function fakeUi() {
    const inspector = document.createElement("div");
    return { ui: { el: { inspector }, inspectorSize: { w: 240, h: 80 } } as unknown as UI, inspector };
  }

  it("prefers the facility's right side when there is room", () => {
    const { ui, inspector } = fakeUi();
    anchorInspector(ui, { x: 100, y: 50, w: 44 }, 1000, 760);
    expect(inspector.style.left).toBe(`${100 + 44 + 12}px`);
    expect(inspector.style.top).toBe("50px");
  });

  it("flips to the facility's left at the right viewport edge (the peek card must clear the held finger)", () => {
    // A 240px card for a facility ending at x=352 in a 360px viewport: the old
    // clamp slid the card back over the room and the finger holding the peek;
    // the flip puts it on the facility's other side instead.
    const { ui, inspector } = fakeUi();
    anchorInspector(ui, { x: 308, y: 50, w: 44 }, 360, 760);
    expect(inspector.style.left).toBe(`${308 - 240 - 12}px`);
  });

  it("clamps after the flip so the card never leaves the viewport", () => {
    const { ui, inspector } = fakeUi();
    anchorInspector(ui, { x: 5, y: 900, w: 10 }, 200, 760);
    expect(inspector.style.left).toBe("8px");
    expect(inspector.style.top).toBe(`${760 - 80 - 8}px`);
  });
});
