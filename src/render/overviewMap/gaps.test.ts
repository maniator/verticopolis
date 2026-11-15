import { describe, expect, it } from "vitest";
import { buildMapGaps, type MapGapSource } from "./gaps";
import { fitLayout, lineToMapY, tileToMapX } from "./geometry";

// 400 tiles across 300 pixels (0.75 px a tile, as a desktop map at a pixel
// ratio of 1 draws a full lot) and 10 floors at 10 px each.
const layout = fitLayout({ leftTile: 0, width: 400, topLine: 10, bottomLine: 0 }, 300, 100);

type Run = MapGapSource["structure"][number];
const run = (floor: number, x: number, count: number, kind: Run["kind"] = "floor"): Run => ({ kind, floor, x, width: 1, count });

function source(over: Partial<MapGapSource> = {}): MapGapSource {
  return { structure: [], rooms: [], floorsOf: () => 1, tallLobbies: () => [], ...over };
}

describe("buildMapGaps", () => {
  it("widens a three-tile gap between two towers to the minimum, centered on it (split tower on 4.0.0)", () => {
    // Two towers on floor 5, open air at columns 185 to 187: 2.25 px of map.
    const gaps = buildMapGaps(layout, source({ structure: [run(5, 113, 72), run(5, 188, 64)] }), 4);
    expect(gaps).toHaveLength(1);
    const [gap] = gaps;
    expect(gap.w).toBeGreaterThanOrEqual(4);
    const middle = (tileToMapX(layout, 185) + tileToMapX(layout, 188)) / 2;
    expect(Math.abs(gap.x + gap.w / 2 - middle)).toBeLessThanOrEqual(1);
    expect(gap).toMatchObject({ y: lineToMapY(layout, 5), h: 10 });
  });

  it("keeps a gap already wider than the minimum at its true width", () => {
    // Columns 185 to 204: 15 px.
    const [gap] = buildMapGaps(layout, source({ structure: [run(5, 113, 72), run(5, 205, 64)] }), 4);
    expect(gap).toEqual({ x: Math.round(tileToMapX(layout, 185)), y: 50, w: 15, h: 10 });
  });

  it("draws a one-tile gap at least one pixel wide with no minimum", () => {
    const [gap] = buildMapGaps(layout, source({ structure: [run(5, 0, 100), run(5, 101, 100)] }), 0);
    expect(gap.w).toBeGreaterThanOrEqual(1);
  });

  it("takes at most half of a narrow building beside a gap", () => {
    // A two-tile building (1.5 px) between two one-tile gaps.
    const gaps = buildMapGaps(layout, source({ structure: [run(5, 0, 100), run(5, 101, 2), run(5, 104, 100)] }), 8);
    expect(gaps).toHaveLength(2);
    const [left, right] = gaps;
    // The building keeps a pixel of its own between the two gaps.
    expect(right.x - (left.x + left.w)).toBeGreaterThanOrEqual(1);
  });

  it("finds no gap where only one side is built, past a tower's edge", () => {
    expect(buildMapGaps(layout, source({ structure: [run(5, 113, 72), run(6, 200, 10)] }), 4)).toEqual([]);
  });

  it("joins runs that touch, whatever their kind, into one building", () => {
    expect(buildMapGaps(layout, source({ structure: [run(1, 100, 20, "lobby"), run(1, 120, 20, "floor")] }), 4)).toEqual([]);
  });

  it("counts a tall room's upper floors and a tall lobby hall's raised stories as built", () => {
    // Floor 6 has tiles only at the towers' ends; a two-floor room from floor 5
    // and a three-story hall from floor 4 fill the rest of each tower.
    const structure = [run(4, 0, 50, "lobby"), run(4, 60, 50, "lobby"), run(5, 0, 50), run(5, 60, 50), run(6, 0, 10), run(6, 100, 10)];
    const gaps = buildMapGaps(
      layout,
      source({
        structure,
        rooms: [{ kind: "cinema", floor: 5, x: 10, width: 40 }],
        floorsOf: (kind) => (kind === "cinema" ? 2 : 1),
        tallLobbies: () => [{ floor: 4, x0: 60, x1: 109, height: 3 }],
      }),
      0,
    );
    // One gap, columns 50 to 59, on floors 4 to 6: one rectangle.
    expect(gaps).toEqual([{ x: 38, y: lineToMapY(layout, 6), w: 7, h: 30 }]);
  });

  it("makes one rectangle for a gap that repeats floor over floor, and a new one where it moves", () => {
    const structure = [];
    for (let floor = 1; floor <= 6; floor++) structure.push(run(floor, 0, 100), run(floor, floor <= 4 ? 120 : 130, 50));
    const gaps = buildMapGaps(layout, source({ structure }), 0);
    expect(gaps).toEqual([
      { x: 75, y: lineToMapY(layout, 4), w: 15, h: 40 },
      { x: 75, y: lineToMapY(layout, 6), w: 23, h: 20 },
    ]);
  });

  it("skips a run with a bad count or a coordinate that is not finite", () => {
    const structure = [run(5, 0, 100), { ...run(5, 150, 10), count: 0 }, run(5, Number.NaN, 5), run(5, 200, 100)];
    const gaps = buildMapGaps(layout, source({ structure }), 0);
    expect(gaps).toEqual([{ x: 75, y: 50, w: 75, h: 10 }]);
  });

});
