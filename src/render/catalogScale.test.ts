import { describe, it, expect } from "vitest";
import { fitAtGameScale } from "./catalogScale";
import { FLOOR, TILE } from "./scale";

/**
 * The fitter the two sprite-review pages size their boxes with. Everything here
 * is about SHAPE: a box may come out any size the cell allows, but the floor
 * pitch it implies has to be the world's, whatever the magnification and however
 * hard the cell squeezes it. Literal pixel sizes are deliberately not pinned;
 * pinning them would just move the drift this helper exists to stop.
 */

/** Tiles per floor the fitted box implies. This is the number that went wrong:
 *  the preview drew 3.67 and the gallery 2.9 against a world of 4.5. */
function tilesPerFloor(tiles: number, floors: number, w: number, h: number): number {
  return h / floors / (w / tiles);
}

/** Footprints spanning what the catalog holds: a 1-tile corridor, an office, a
 *  two-floor cinema, the full-lot metro. */
const FOOTPRINTS: Array<[tiles: number, floors: number]> = [
  [1, 1],
  [4, 1],
  [9, 1],
  [24, 1],
  [31, 2],
  [375, 3],
];

describe("fitAtGameScale", () => {
  it.each(FOOTPRINTS)("keeps the world's tiles per floor for a %i x %i footprint", (tiles, floors) => {
    // Across cells that fit the footprint, cells that squeeze its width, and
    // cells that squeeze its height, at every magnification the pages use.
    for (const mag of [1, 2, 3]) {
      for (const [maxW, maxH] of [[4000, 4000], [276, 166], [90, 500], [500, 40], [1, 1]] as const) {
        const box = fitAtGameScale(tiles, floors, maxW, maxH, mag);
        expect(tilesPerFloor(tiles, floors, box.w, box.h)).toBeCloseTo(FLOOR / TILE, 8);
        expect(box.w).toBeLessThanOrEqual(maxW);
        expect(box.h).toBeLessThanOrEqual(maxH);
      }
    }
  });

  it("draws at exactly the requested whole multiple when the cell has room", () => {
    const box = fitAtGameScale(4, 1, 10_000, 10_000, 3);
    expect(box.scale).toBe(3);
    expect(box.tile).toBe(3 * TILE);
    expect(box.w).toBe(4 * 3 * TILE);
    expect(box.h).toBe(3 * FLOOR);
  });

  it("shrinks uniformly against whichever budget binds", () => {
    // Width binds: the box fills the width and the height follows it down.
    const wide = fitAtGameScale(20, 1, 100, 10_000, 1);
    expect(wide.w).toBe(100);
    expect(wide.h).toBeCloseTo(FLOOR * (100 / (20 * TILE)), 8);
    // Height binds: the same in the other direction.
    const tall = fitAtGameScale(2, 3, 10_000, 90, 1);
    expect(tall.h).toBe(90);
    expect(tall.w).toBeCloseTo(2 * TILE * (90 / (3 * FLOOR)), 8);
  });

  it("treats an unbounded budget as no constraint at all", () => {
    // How the gallery sizes the metro: its platform art fills whatever width it
    // is handed, so only the height comes from the fitter.
    const box = fitAtGameScale(375, 3, Infinity, 166, 2);
    expect(box.h).toBe(166);
    expect(Number.isFinite(box.w)).toBe(true);
  });

  it("returns an empty box for a degenerate footprint or cell, never NaN", () => {
    // A zero-width cell is reachable: the gallery's column width is computed
    // from the container, and a NaN box would spread through every coordinate
    // instead of simply drawing nothing.
    for (const box of [fitAtGameScale(0, 1, 100, 100), fitAtGameScale(4, 0, 100, 100), fitAtGameScale(4, 1, 0, 0)]) {
      expect(box.w).toBe(0);
      expect(box.h).toBe(0);
      expect(Number.isNaN(box.scale)).toBe(false);
    }
  });
});
