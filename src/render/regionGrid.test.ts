import { describe, it, expect } from "vitest";
import { GRID } from "../engine/facilities";
import { FLOOR, TILE } from "./scale";
import {
  REGION_COLS,
  REGION_FLOORS,
  REGION_ROWS,
  REGION_TILES,
  regionCol,
  regionKey,
  regionRect,
  regionRow,
  regionsOf,
} from "./regionGrid";

/**
 * The region grid is pure math with two load-bearing contracts: every region
 * canvas fits under the low-end mobile GPU texture ceiling, and a unit's
 * footprint maps to exactly the regions whose rects it intersects (a wrong
 * mapping paints a room into the wrong canvas or leaves a hole).
 */

describe("region dimensions", () => {
  it("both pixel sides sit at or under the 2048 mobile MAX_TEXTURE_SIZE floor", () => {
    // The TRANSPORT_BAND_FLOORS precedent: a canvas over the GPU cap uploads
    // as a black rectangle on low-end phones, silently.
    expect(REGION_TILES * TILE).toBeLessThanOrEqual(2048);
    expect(REGION_FLOORS * FLOOR).toBeLessThanOrEqual(2048);
  });

  it("the grid bounds the whole lot, basements included", () => {
    expect(REGION_COLS * REGION_TILES).toBeGreaterThanOrEqual(GRID.width);
    expect(REGION_ROWS * REGION_FLOORS).toBeGreaterThanOrEqual(GRID.maxFloor - GRID.minFloor + 1);
  });
});

describe("footprint to region mapping", () => {
  it("an interior unit lands in exactly one region", () => {
    expect(regionsOf(5, 5, 9, 1)).toEqual([regionKey(regionCol(5), regionRow(5))]);
  });

  it("a wide unit straddling a column boundary lands in two regions", () => {
    // Tiles 30..45 with REGION_TILES 32: columns 0 and 1.
    const keys = regionsOf(5, 30, 16, 1);
    expect(keys).toHaveLength(2);
    expect(keys).toContain(regionKey(0, regionRow(5)));
    expect(keys).toContain(regionKey(1, regionRow(5)));
  });

  it("a two-story unit straddling a row boundary lands in two regions", () => {
    // Rows split at minFloor + k*REGION_FLOORS: with minFloor -9 and 20-floor
    // rows, floors 10 and 11 sit in different rows.
    const boundaryFloor = GRID.minFloor + REGION_FLOORS - 1; // top floor of row 0
    const keys = regionsOf(boundaryFloor, 5, 4, 2);
    expect(keys).toHaveLength(2);
    expect(keys).toContain(regionKey(regionCol(5), 0));
    expect(keys).toContain(regionKey(regionCol(5), 1));
  });

  it("the corner case straddles four regions", () => {
    const boundaryFloor = GRID.minFloor + REGION_FLOORS - 1;
    expect(regionsOf(boundaryFloor, 30, 4, 2)).toHaveLength(4);
  });

  it("basement floors map into row 0", () => {
    expect(regionRow(GRID.minFloor)).toBe(0);
    expect(regionRow(0)).toBe(0); // B1
  });

  it("the extreme lot corners stay inside the key space", () => {
    expect(regionCol(GRID.width - 1)).toBe(REGION_COLS - 1);
    expect(regionRow(GRID.maxFloor)).toBe(REGION_ROWS - 1);
    // Top-right-most legal 9-tile footprint hits exactly the last key.
    expect(regionsOf(GRID.maxFloor, GRID.width - 9, 9, 1)).toEqual([REGION_COLS * REGION_ROWS - 1]);
  });

  it("a full-lot-width footprint (the metro) spans every column exactly once", () => {
    const keys = regionsOf(GRID.minFloor, 0, GRID.width, 3);
    expect(keys).toHaveLength(REGION_COLS);
    expect(new Set(keys).size).toBe(REGION_COLS);
  });

  it("every emitted key stays below COLS * ROWS even for off-lot inputs", () => {
    // Column overflow would alias into the next row's keys, corrupting a
    // diagonal neighbor's canvas; the clamp makes that unrepresentable.
    for (const keys of [
      regionsOf(GRID.maxFloor, GRID.width - 1, 50, 5), // spills right and up
      regionsOf(GRID.minFloor - 5, -3, 9, 1), // spills left and below
    ]) {
      for (const k of keys) {
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(REGION_COLS * REGION_ROWS);
      }
    }
  });
});

describe("region rects", () => {
  it("a rect's floors and tiles round-trip through the mapping", () => {
    for (const key of [0, regionKey(3, 2), regionKey(REGION_COLS - 1, REGION_ROWS - 1)]) {
      const r = regionRect(key);
      expect(r.w).toBe(REGION_TILES * TILE);
      expect(r.h).toBe(REGION_FLOORS * FLOOR);
      // The tile at the rect's left edge maps back to this region's column,
      // and the floors at the vertical extremes map back to its row.
      const col = key % REGION_COLS;
      const row = Math.floor(key / REGION_COLS);
      expect(regionCol(r.x / TILE)).toBe(col);
      const topFloor = -r.y / FLOOR;
      const bottomFloor = topFloor - REGION_FLOORS + 1;
      expect(regionRow(topFloor)).toBe(row);
      expect(regionRow(bottomFloor)).toBe(row);
    }
  });

  it("vertically adjacent regions abut exactly (no gap, no overlap)", () => {
    const below = regionRect(regionKey(0, 0));
    const above = regionRect(regionKey(0, 1));
    // World y grows downward; the row above sits at more negative y and its
    // bottom edge meets the lower row's top edge.
    expect(above.y + above.h).toBe(below.y);
  });

  it("horizontally adjacent regions abut exactly", () => {
    const left = regionRect(regionKey(0, 0));
    const right = regionRect(regionKey(1, 0));
    expect(left.x + left.w).toBe(right.x);
  });
});
