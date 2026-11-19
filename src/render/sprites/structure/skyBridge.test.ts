import { describe, expect, it } from "vitest";
import { BRIDGE_LOOK, drawBridgeTile, type BridgePart } from "./skyBridge";

/** A stand-in 2D context that records each fill and stroke with the style
 *  it used, the translate that places the tile on its bridge, and the clip,
 *  save and restore calls around them. */
function recorder() {
  const calls: string[] = [];
  const fills: string[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    translate: (x: number, y: number) => calls.push(`translate ${x},${y}`),
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    arc: () => {},
    rect: (x: number, y: number, w: number, h: number) => calls.push(`rect ${x},${y},${w},${h}`),
    clip: () => calls.push("clip"),
    fill: () => fills.push(String(ctx.fillStyle)),
    stroke: () => calls.push(`stroke ${String(ctx.strokeStyle)}`),
    fillRect: (x: number, y: number, w: number, h: number) => fills.push(`${String(ctx.fillStyle)} ${x},${y},${w},${h}`),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  };
  return { g: ctx as unknown as CanvasRenderingContext2D, calls, fills };
}

const W = 10;
const H = 45;
const LOOKS = Object.values(BRIDGE_LOOK);
const PARTS: BridgePart[] = ["deck", "under"];

function drawn(look: string, i: number, n: number, lit: boolean, part: BridgePart) {
  const r = recorder();
  drawBridgeTile(r.g, look, i, n, lit, W, H, part);
  return r;
}

describe("drawBridgeTile", () => {
  it("draws the whole bridge shifted to the tile's place, clipped to its own cell", () => {
    for (const look of LOOKS)
      for (const part of PARTS) {
        const { calls, fills } = drawn(look, 3, 8, false, part);
        expect(calls.slice(0, 4), `${look} ${part}`).toEqual(["save", `rect 0,0,${W},${H}`, "clip", `translate ${-3 * W},0`]);
        expect(calls[calls.length - 1], `${look} ${part}`).toBe("restore");
        expect(fills.length, `${look} ${part}`).toBeGreaterThan(0);
      }
  });

  it("draws nothing for the plain lobby or an unknown look", () => {
    for (const look of ["Lobby", "Moon Gate"])
      for (const part of PARTS) expect(drawn(look, 0, 4, false, part).fills, look).toEqual([]);
  });

  it("draws each look in other colors at night", () => {
    for (const look of LOOKS)
      for (const part of PARTS)
        expect(drawn(look, 1, 6, true, part).fills, `${look} ${part}`).not.toEqual(drawn(look, 1, 6, false, part).fills);
  });

  it("spaces each look's pattern to the bridge's span", () => {
    for (const look of LOOKS) {
      const short = drawn(look, 0, 4, false, "deck").fills;
      const long = drawn(look, 0, 16, false, "deck").fills;
      expect(long, look).not.toEqual(short);
    }
  });
});
