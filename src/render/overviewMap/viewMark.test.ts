import { describe, it, expect } from "vitest";
import { viewPlacement } from "./extent";
import { fitLayout, type MapLayout } from "./geometry";
import { contrastRatio, hexLuminance, CLASSIC_TOWER_FILL, CLASSIC_SHAFT_FILL } from "./style";
import { FLOOR, TILE } from "../scale";
import { GROUND_LINE, MAP_BACKDROP, VIEW_MARK, groundShare, paintViewMark, viewMarkBand, visibleRect, type ViewMarkContext } from "./viewMark";

/** A context that records what was drawn. */
function recorder() {
  const calls: string[] = [];
  const ctx: ViewMarkContext & { calls: string[] } = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    setLineDash: (d) => calls.push(`dash ${d.join(",")}`),
    clearRect: (x, y, w, h) => calls.push(`clear ${x},${y},${w},${h}`),
    fillRect: (x, y, w, h) => calls.push(`fill ${x},${y},${w},${h} ${String(ctx.fillStyle)}`),
    strokeRect: (x, y, w, h) => calls.push(`stroke ${x},${y},${w},${h} ${String(ctx.strokeStyle)} ${ctx.lineWidth}`),
    beginPath: () => calls.push("path"),
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => calls.push("chevron"),
  };
  return ctx;
}

/** 100 tiles by 100 floor lines (0 to 100) in a 100 by 100 box: one pixel per
 *  tile and per floor. */
const LAYOUT: MapLayout = fitLayout({ width: 100, topLine: 100, bottomLine: 0 }, 100, 100);

function cam(tile: number, floor: number, tiles: number, floors: number) {
  return { posX: tile * TILE, posY: -floor * FLOOR, zoom: 1, viewWidth: tiles * TILE, viewHeight: floors * FLOOR };
}

describe("overview map backdrop", () => {
  it("puts the ground's top edge at the street line, held to the map", () => {
    expect(GROUND_LINE).toBe(0);
    expect(groundShare(fitLayout({ width: 10, topLine: 90, bottomLine: -10 }, 10, 100))).toBeCloseTo(0.9);
    expect(groundShare(LAYOUT)).toBe(1);
    expect(groundShare(fitLayout({ width: 10, topLine: -2, bottomLine: -10 }, 10, 100))).toBe(0);
  });

  it("keeps the Classic gray and the elevator lines readable on the sky and the ground", () => {
    for (const color of [MAP_BACKDROP.classic.sky, MAP_BACKDROP.classic.ground]) {
      const bg = hexLuminance(color)!;
      expect(contrastRatio(bg, hexLuminance(CLASSIC_TOWER_FILL)!), color).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(bg, hexLuminance(CLASSIC_SHAFT_FILL.elevatorStandard!)!), color).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("overview map view mark", () => {
  it("draws Classic's outline dotted in white ink, inside the view (the CSS blend inverts it)", () => {
    const ctx = recorder();
    expect(paintViewMark(ctx, LAYOUT, viewPlacement(LAYOUT, cam(50, 50, 20, 10)), "classic", 1)).toBe("outline");
    expect(ctx.calls).toEqual([
      "clear 0,0,100,100",
      "dash 1,1",
      `stroke 40.5,45.5,19,9 ${VIEW_MARK.ink} 1`,
      "dash ",
    ]);
  });

  it("draws Modern's outline solid over a halo, in device pixels", () => {
    const ctx = recorder();
    paintViewMark(ctx, LAYOUT, viewPlacement(LAYOUT, cam(50, 50, 20, 10)), "modern", 2);
    expect(ctx.calls.filter((c) => c.startsWith("stroke"))).toEqual([
      `stroke 42.5,47.5,15,5 ${VIEW_MARK.halo} 5`,
      `stroke 41,46,18,8 ${VIEW_MARK.ink} 2`,
    ]);
  });

  it("keeps a zoomed-in view visible as a mark of a few pixels", () => {
    expect(visibleRect(LAYOUT, { x: 50, y: 50, w: 1, h: 0.5 }, 4)).toEqual({ x: 48.5, y: 48.25, w: 4, h: 4 });
    expect(visibleRect(LAYOUT, { x: 99.5, y: 0, w: 0.5, h: 0.5 }, 4)).toEqual({ x: 96, y: 0, w: 4, h: 4 });
  });

  it("draws the edge band and its chevron when the whole view is past the top", () => {
    const ctx = recorder();
    const placement = viewPlacement(LAYOUT, cam(50, 120, 20, 10));
    expect(placement.outside).toBe("above");
    expect(paintViewMark(ctx, LAYOUT, placement, "classic", 1)).toBe("band");
    expect(ctx.calls).toEqual(["clear 0,0,100,100", `fill 40,0,20,3 ${VIEW_MARK.ink}`, "path", "chevron"]);
  });

  it("hands the window the band it paints, in whole device pixels", () => {
    const placement = viewPlacement(LAYOUT, cam(50, 120, 20, 2));
    expect(viewMarkBand(LAYOUT, placement, 1.5)).toEqual({ x: 40, y: 0, w: 20, h: 5 });
    expect(viewMarkBand(LAYOUT, viewPlacement(LAYOUT, cam(50, 50, 20, 10)), 1)).toBeNull();
  });

  it("draws the band against the bottom edge for a view below the map", () => {
    const ctx = recorder();
    paintViewMark(ctx, LAYOUT, viewPlacement(LAYOUT, cam(50, -30, 20, 10)), "modern", 1);
    expect(ctx.calls[1]).toBe(`fill 40,97,20,3 ${VIEW_MARK.ink}`);
  });

  it("draws nothing for a view with no area on the map", () => {
    const ctx = recorder();
    expect(paintViewMark(ctx, LAYOUT, viewPlacement(LAYOUT, cam(50, 50, 0, 0)), "classic", 1)).toBe("none");
    expect(ctx.calls).toEqual(["clear 0,0,100,100"]);
  });
});
