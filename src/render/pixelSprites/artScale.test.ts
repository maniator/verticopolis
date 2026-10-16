import { describe, it, expect } from "vitest";
import { ART_TILE, artRow } from "./artScale";
import { TILE } from "../scale";

/**
 * The room-art scale seam on its own terms, split from `roomCapacity.test.ts`
 * so both stay under the line ceiling. That file proves the ROOMS come out
 * right; this one pins the arithmetic they all lean on.
 */

/** The authored capacity of a row: how many items of `pitch` fit across `span`
 *  AUTHORED pixels once the row's own margins come off.
 *
 *  This restates the helper's own arithmetic, so the first case below is close
 *  to a tautology on purpose: what it adds is that the SCREEN geometry never
 *  reduces the count. `roomCapacity.test.ts` carries the real spec, the counts
 *  measured off the art as it stood before the tile changed, and keeps its own
 *  copy of this line. Correct one and you must correct the other. */
const authoredSeats = (authoredSpan: number, margins: number, pitch: number): number =>
  Math.max(0, Math.floor((authoredSpan - margins) / pitch) + 1);

describe("artRow measures capacity by the authored room, not by the tile", () => {
  it("counts a room by the tiles it covers, so a narrower tile cannot cost a slot", () => {
    // The invariant issue #813 broke. At the 11px tile a 12-tile bay fitted 18
    // browsing customers at a 7px pitch; counting those 7px slots off the
    // 10px-tile pixel width returned 16. Every width from 1 to 24 tiles is
    // checked, so a formula that is one margin adrift cannot hide between the
    // widths a sample happened to pick.
    for (let tiles = 1; tiles <= 24; tiles++) {
      const w = tiles * TILE;
      const authoredRun = tiles * ART_TILE - 7 - 3;
      expect(artRow(authoredRun, 7, w - 3, 7).length, `${tiles} tiles`).toBe(authoredSeats(tiles * ART_TILE, 7 + 3, 7));
    }
  });

  it("counts a row whose authored run divides exactly by its pitch", () => {
    // The boundary a 24-tile nightclub sat on. Re-deriving the authored run from
    // an already-rounded screen width left it a fraction short of 162, and the
    // row lost a whole dancer to that fraction.
    expect(artRow(162, 7, 153, 6).length).toBe(28);
    expect(artRow(114, 6, 108, 7).length).toBe(17); // a 12-tile bar's stools
  });

  it("keeps every anchor inside the run, in either direction", () => {
    for (const [from, limit, dir] of [[0, 100, 1], [100, 0, -1], [7, 7, 1]] as const) {
      const spots = artRow(110, from, limit, 12, dir);
      expect(spots.length).toBeGreaterThan(0);
      for (const s of spots) {
        expect(s).toBeGreaterThanOrEqual(Math.min(from, limit));
        expect(s).toBeLessThanOrEqual(Math.max(from, limit));
      }
      expect(spots.every(Number.isInteger)).toBe(true); // integer pixels only
    }
  });

  it("draws nothing when the room cannot hold the row", () => {
    // A limit that has crossed the start means the room is too narrow. The row
    // has to disappear, not reverse: reversing walked a mini golf bay's watchers
    // out through the far wall and drew MORE of them as the bay shrank.
    expect(artRow(50, 32, 13, 12)).toEqual([]);
    expect(artRow(30, 6 - 7, 3, 7, -1)).toEqual([]);
    expect(artRow(100, 0, Number.NaN, 7)).toEqual([]);
    expect(artRow(-1, 0, 100, 7)).toEqual([]); // a negative authored run
  });

  it("refuses a pitch that is not a positive number instead of throwing", () => {
    // `authoredRun / 0` is Infinity, and `Array.from({ length: Infinity })`
    // throws RangeError inside the render path.
    for (const pitch of [0, -7, Number.NaN]) expect(artRow(100, 0, 100, pitch)).toEqual([]);
  });

  it("never stacks two anchors on one pixel when the screen run is the shorter one", () => {
    // The authored run can promise more slots than the screen run physically
    // holds, because only the room shrank and the margins did not.
    expect(artRow(120, 50, 50, 7)).toEqual([50]);
    for (const spots of [artRow(120, 50, 53, 7)]) expect(new Set(spots).size).toBe(spots.length);
  });

  it("keeps fractional inputs inside the run, and distinct (the preview pages produce them)", () => {
    // Distinctness is the load-bearing half. With fractional ends the first
    // anchor rounds while the far edge floors, which let the column window come
    // out one wider than the run, and the row repeated its last anchor: two
    // people drawn on one pixel, reading as one. `artRow(100, 2.6, 2.6, 7)`
    // returned [3, 3].
    for (const [from, limit] of [[2.4, 2.6], [2.6, 2.6], [3.5, 97.5], [97.5, 3.5], [0.5, 1.4]] as const) {
      const dir = limit < from ? -1 : 1;
      const spots = artRow(110, from, limit, 7, dir);
      expect(new Set(spots).size, `${from}..${limit} repeated an anchor`).toBe(spots.length);
      for (const s of spots) {
        expect(s).toBeGreaterThanOrEqual(Math.floor(Math.min(from, limit)));
        expect(s).toBeLessThanOrEqual(Math.ceil(Math.max(from, limit)));
      }
    }
  });
});
