import { describe, expect, it } from "vitest";
import type { Unit } from "../engine/types";
import { drawUnit, type DrawCtx } from "./sprites";
import { FLOOR } from "./scale";

/** A 2D context that accepts every call and counts the fills, so the draw runs
 *  without a canvas. */
function countingCtx() {
  let fills = 0;
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (prop === "fillRect" || prop === "fill") return () => void fills++;
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop: () => {} });
      return () => {};
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, fills: () => fills };
}

const hall = { id: 1, kind: "weddingHall", floor: 100, x: 40, width: 28, state: "occupied", satisfaction: 1, occupants: 2 } as Unit;

describe("the five story wedding hall sprite", () => {
  it("paints its garden crown at any x, including left of the sprite origin", () => {
    // A negative x once indexed the bloom colors off the end and killed the frame loop.
    for (const x of [-250, -7, 0, 33]) {
      const c = countingCtx();
      const d: DrawCtx = { ctx: c.ctx, lit: true, anim: 0.5, hour: 20 };
      expect(() => drawUnit(d, hall, x, 20, 240, 5 * FLOOR)).not.toThrow();
      expect(c.fills()).toBeGreaterThan(0);
    }
  });
});
