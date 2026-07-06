import { describe, it, expect } from "vitest";
import { craneAnchorTile } from "../render/sprites";
import { facadeGeometry } from "../render/facadeGeometry";
import type { FacilityKind, Unit } from "../engine/types";

/**
 * The rooftop crane perches at {@link craneAnchorTile} along the top floor.
 * The bug it guards against: anchoring to the plain (min,max) midpoint floats
 * the crane over open sky when the top floor is built in disjoint blocks (a
 * setback, or a partly-leased top office row), because the midpoint lands in
 * the gap between blocks. Centering on the widest contiguous run keeps it over
 * real structure.
 */
describe("craneAnchorTile", () => {
  it("centers on a fully-built row exactly like the old midpoint", () => {
    // Tiles 104..216 inclusive → right edge 217 → world midpoint (104+217)/2.
    const tiles = range(104, 216);
    expect(craneAnchorTile(tiles)).toBe((104 + 217) / 2);
  });

  it("stays over the built block, not the gap, on a split top floor", () => {
    // The reported save: two runs [104,148] and [204,216] with a wide gap.
    // The old midpoint (160) sat in the empty gap; the widest run is the left
    // block, whose center is (104 + 149) / 2 = 126.5.
    const tiles = [...range(104, 148), ...range(204, 216)];
    expect(craneAnchorTile(tiles)).toBe(126.5);
    // Sanity: the old behavior would have floated it over the gap.
    const oldMidpoint = (104 + 217) / 2;
    expect(oldMidpoint).toBeGreaterThan(148); // in the gap, past the left run
    expect(oldMidpoint).toBeLessThan(204);
  });

  it("picks the widest run regardless of order", () => {
    // Right block wider than the left one → crane goes right.
    const tiles = [...range(10, 14), ...range(40, 60)];
    expect(craneAnchorTile(tiles)).toBe((40 + 61) / 2);
  });

  it("keeps the leftmost run on a tie", () => {
    const tiles = [...range(0, 4), ...range(20, 24)];
    expect(craneAnchorTile(tiles)).toBe((0 + 5) / 2);
  });

  it("handles a single built tile", () => {
    expect(craneAnchorTile([7])).toBe(7.5);
  });

  it("collapses duplicate indices instead of splitting the run", () => {
    // A repeated tile must not read as a one-wide gap. [1,2,2,3,4] is one run
    // [1..4] → center (1 + 5) / 2 = 3, not the [2..4] a naive scan would pick.
    expect(craneAnchorTile([1, 2, 2, 3, 4])).toBe(3);
  });

  it("does not depend on input ordering", () => {
    const shuffled = [206, 104, 148, 105, 216, 147];
    // Widest run here is [104,105] and [147,148] and [206] and [216] — the two
    // 2-tile runs tie; leftmost wins → [104,105] center 105.
    expect(craneAnchorTile(shuffled)).toBe((104 + 106) / 2);
  });
});

/**
 * Wiring: the crane reads its tiles from {@link facadeGeometry}, which collects
 * the top floor's built columns in the same single pass that builds the escape-
 * stair edges. These tests drive the real units → anchor path headlessly (no
 * Excalibur canvas): the exact class of regression a green {@link craneAnchorTile}
 * unit test can't catch — feeding the anchor math the wrong tiles.
 */
describe("facadeGeometry → crane anchor (integration)", () => {
  it("anchors over built structure, never the gap, on a split top floor", () => {
    // The reported save's top row (57): two blocks with a wide empty gap.
    const units = [...tiles(57, 104, 148), ...tiles(57, 204, 216)];
    const { edges, topTiles } = facadeGeometry(units, 57);

    // Escape-stair edges still span the whole silhouette (min tile … right edge).
    expect(edges.get(57)).toEqual({ min: 104, max: 217 });

    // The crane, however, must land on a real tile — not the bounding-box gap.
    const anchor = craneAnchorTile(topTiles);
    expect(topTiles.has(Math.floor(anchor))).toBe(true); // over structure
    expect(topTiles.has(160)).toBe(false); // the old midpoint — an empty gap
    expect(anchor).toBe(126.5);
  });

  it("counts a multi-floor room's upper story on the top row", () => {
    // A 2-floor cinema based on floor 56 also occupies floor 57 (tiles 100..123).
    const units = tiles(56, 100, 100, "cinema", 24);
    const { topTiles } = facadeGeometry(units, 57);
    expect(topTiles.size).toBe(24);
    expect(topTiles.has(100)).toBe(true);
    expect(topTiles.has(123)).toBe(true);
    expect(topTiles.has(124)).toBe(false); // exclusive right edge
    const anchor = craneAnchorTile(topTiles);
    expect(topTiles.has(Math.floor(anchor))).toBe(true);
  });

  it("yields no top tiles when the top row is empty (crane suppressed)", () => {
    // Basement-only lot: highestFloor reports 1, but nothing is built at/above
    // floor 1, so topTiles is empty and syncCrane shows no crane.
    const units = tiles(-2, 5, 12);
    const { topTiles } = facadeGeometry(units, 1);
    expect(topTiles.size).toBe(0);
  });
});

/** Inclusive integer range [lo, hi]. */
function range(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let x = lo; x <= hi; x++) out.push(x);
  return out;
}

/** One unit per tile across [lo, hi] on `floor` (default a 1×1 floor tile), or
 *  a single `width`-wide room when `width > 1`. Only the fields facadeGeometry
 *  reads are set; the rest are irrelevant to silhouette geometry. */
function tiles(floor: number, lo: number, hi: number, kind: FacilityKind = "floor", width = 1): Unit[] {
  if (width > 1) return [{ floor, x: lo, width, kind } as unknown as Unit];
  return range(lo, hi).map((x) => ({ floor, x, width: 1, kind } as unknown as Unit));
}
