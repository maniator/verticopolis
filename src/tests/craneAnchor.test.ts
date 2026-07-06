import { describe, it, expect } from "vitest";
import { craneAnchorTile } from "../render/sprites";

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

/** Inclusive integer range [lo, hi]. */
function range(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let x = lo; x <= hi; x++) out.push(x);
  return out;
}
