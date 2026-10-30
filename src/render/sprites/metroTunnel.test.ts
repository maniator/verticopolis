import { describe, expect, it } from "vitest";
import { FLOOR } from "../scale";
import { METRO_TUNNEL_TILE, drawMetroTunnel } from "./facilities";
import { METRO_PORTAL_W, drawMetroPortal } from "./facilities/vehicles";

/** A recording context: each fillRect keeps the style and alpha it painted with. */
function rects() {
  const painted: { x: number; y: number; w: number; h: number; style: string; alpha: number }[] = [];
  const state = {
    fillStyle: "",
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      painted.push({ x, y, w, h, style: String(state.fillStyle), alpha: state.globalAlpha });
    },
  };
  const ctx = state as unknown as CanvasRenderingContext2D;
  return { ctx, painted };
}

describe("the metro tunnel row", () => {
  it("paints one repeat the width of the tile and one floor tall, steel over a rail bed", () => {
    const { ctx, painted } = rects();
    drawMetroTunnel(ctx);
    expect(painted.length).toBeGreaterThan(0);
    for (const r of painted) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(METRO_TUNNEL_TILE);
      expect(r.y + r.h).toBeLessThanOrEqual(FLOOR);
    }
    expect(painted.some((r) => r.style === "#5E6166" && r.w === METRO_TUNNEL_TILE && r.h === FLOOR)).toBe(true);
    expect(painted.some((r) => r.style === "#26282E" && r.y + r.h === FLOOR)).toBe(true);
  });

  it("repeats on the panel cadence, so spans cut at any tile boundary join up", () => {
    const { ctx, painted } = rects();
    drawMetroTunnel(ctx);
    const seams = painted.filter((r) => r.style === "#3A3C40").map((r) => r.x);
    expect(seams.length).toBe(METRO_TUNNEL_TILE / 64);
    expect(seams.every((x) => x % 64 === 0)).toBe(true);
  });
});

describe("the metro portals", () => {
  const darkness = (side: "left" | "right") => {
    const { ctx, painted } = rects();
    drawMetroPortal(ctx, METRO_PORTAL_W, 63, side);
    return painted.filter((r) => r.style === "#0C0D10");
  };

  it("fades from dark at the tunnel side to clear at the platform side", () => {
    const left = darkness("left");
    const right = darkness("right");
    expect(left.length).toBe(right.length);
    // Left portal: the dark starts beside the jamb (x = 5) and thins to the right.
    expect(left[0].alpha).toBeGreaterThan(left[left.length - 1].alpha);
    expect(left[0].x).toBeLessThan(left[left.length - 1].x);
    // Right portal mirrors it: darkest at the right end.
    const darkest = right.reduce((a, b) => (b.alpha > a.alpha ? b : a));
    expect(darkest.x).toBe(METRO_PORTAL_W - 5 - 1);
  });

  it("puts the steel jamb on the station's outer edge", () => {
    const jamb = (side: "left" | "right") => {
      const { ctx, painted } = rects();
      drawMetroPortal(ctx, METRO_PORTAL_W, 63, side);
      return painted.find((r) => r.style === "#2A2C30" && r.w === 5 && r.h === 63)!;
    };
    expect(jamb("left").x).toBe(0);
    expect(jamb("right").x).toBe(METRO_PORTAL_W - 5);
  });
});
