import { describe, expect, it, vi } from "vitest";
import type { CatalogNoise } from "../../catalog/catalogTypes";
import { FLOOR, TILE } from "../scale";
import type { RingView } from "./towerHaloRings";
import { drawNoiseReach, openTiles, type NoiseTiles } from "./towerNoiseReach";

/**
 * The noise reach painted while a room is placed (Modern, #1980): out from
 * each edge as far as the catalog says, stopped at a lobby tile or a gap the
 * way the engine's scan stops, on every story a noisy room fills and on the
 * lowest story only for what a room hears.
 */

const OFFICE: CatalogNoise[] = [
  { role: "hears", tiles: 11, kinds: ["fastFood"] },
  { role: "carries", tiles: 21, kinds: ["condo"] },
];

/** Floors `built` laid from tile 0 to 199, with a lobby run on `lobbies`. */
function tower(built: number[], lobbies: Array<[number, number]> = []): NoiseTiles & { reads: ReturnType<typeof vi.fn> } {
  const reads = vi.fn();
  const inLot = (floor: number, x: number) => built.includes(floor) && x >= 0 && x < 200;
  return {
    reads,
    structureKindAt: (floor, x) => {
      reads(floor, x);
      if (!inLot(floor, x)) return undefined;
      return lobbies.some(([f, at]) => f === floor && at === x) ? "lobby" : "floor";
    },
    hasStructure: (floor, x) => inLot(floor, x),
    // Only a room stands off the structure; these floors have none.
    unitAt: vi.fn(() => undefined),
  };
}

function recorder() {
  const fills: { x: number; y: number; w: number; color: string; alpha: number }[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    fillRect: vi.fn((x: number, y: number, w: number) => fills.push({ x, y, w, color: ctx.fillStyle, alpha: ctx.globalAlpha })),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
  };
  return { ctx, fills, draw: ctx as unknown as CanvasRenderingContext2D };
}

/** Zoom 1, tile x at screen x, floor f's top edge at y = -f * 100. */
const VIEW: RingView = { worldToScreenX: (x) => x * TILE, worldToScreenY: (f) => -f * 100, cam: { zoom: 1 } };

describe("noise reach while placing", () => {
  it("walks out to the limit on an open floor and stops at a lobby tile or a gap", () => {
    expect(openTiles(tower([5]), 5, 100, 9, 22)).toEqual({ left: 22, right: 22 });
    expect(openTiles(tower([5], [[5, 95]]), 5, 100, 9, 22)).toEqual({ left: 4, right: 22 });
    // The lot's edge is a gap.
    expect(openTiles(tower([5]), 5, 5, 9, 22)).toEqual({ left: 5, right: 22 });
    expect(openTiles(tower([]), 5, 100, 9, 22)).toEqual({ left: 0, right: 0 });
  });

  it("asks for a room only where there is no structure, and walks on over a room standing in a gap", () => {
    const t = tower([5]);
    expect(openTiles(t, 5, 100, 9, 22)).toEqual({ left: 22, right: 22 });
    expect(t.unitAt).not.toHaveBeenCalled();
    const bridged = { ...tower([]), unitAt: vi.fn((_f: number, x: number) => (x === 109 ? ({ kind: "office" } as ReturnType<NoiseTiles["unitAt"]>) : undefined)) };
    expect(openTiles(bridged, 5, 100, 9, 22)).toEqual({ left: 0, right: 1 });
  });

  it("paints what an office hears amber and how far it carries violet, each to its own reach", () => {
    const { draw, fills, ctx } = recorder();
    drawNoiseReach(draw, OFFICE, { floor: 5, floors: 1, x: 100, width: 9 }, tower([5]), VIEW);
    expect(fills).toEqual([
      { x: 88 * TILE, y: -500, w: 12 * TILE, color: "#e0a040", alpha: 0.22 },
      { x: 109 * TILE, y: -500, w: 12 * TILE, color: "#e0a040", alpha: 0.22 },
      { x: 78 * TILE, y: -500, w: 22 * TILE, color: "#a46ad8", alpha: 0.22 },
      { x: 109 * TILE, y: -500, w: 22 * TILE, color: "#a46ad8", alpha: 0.22 },
    ]);
    expect(ctx.strokeRect).toHaveBeenCalledWith(78 * TILE + 0.5, -500 + 0.5, (22 + 9 + 22) * TILE - 1, FLOOR - 1);
    expect(ctx.strokeStyle).toBe("#a46ad8");
    expect(ctx.setLineDash).toHaveBeenLastCalledWith([]);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("cuts a band short at a lobby, as the engine's scan does", () => {
    const { draw, fills } = recorder();
    drawNoiseReach(draw, OFFICE, { floor: 5, floors: 1, x: 100, width: 9 }, tower([5], [[5, 115]]), VIEW);
    const right = fills.filter((f) => f.x === 109 * TILE).map((f) => f.w / TILE);
    expect(right).toEqual([6, 6]);
  });

  it("carries a tall room's noise on each story but hears only on its lowest", () => {
    const { draw, fills } = recorder();
    drawNoiseReach(draw, OFFICE, { floor: 5, floors: 2, x: 100, width: 9 }, tower([5, 6]), VIEW);
    expect(fills.filter((f) => f.y === -600).map((f) => f.color)).toEqual(["#a46ad8", "#a46ad8"]);
    expect(fills.filter((f) => f.y === -500)).toHaveLength(4);
  });

  it("paints nothing for a room with no noise reach, the Classic catalog's answer", () => {
    const { draw, fills, ctx } = recorder();
    const t = tower([5]);
    drawNoiseReach(draw, [], { floor: 5, floors: 1, x: 100, width: 9 }, t, VIEW);
    expect(fills).toEqual([]);
    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(t.reads).not.toHaveBeenCalled();
  });

  it("paints no outline on a floor with nothing built beside the room", () => {
    const { draw, fills, ctx } = recorder();
    drawNoiseReach(draw, OFFICE, { floor: 5, floors: 1, x: 100, width: 9 }, tower([]), VIEW);
    expect(fills).toEqual([]);
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });
});
