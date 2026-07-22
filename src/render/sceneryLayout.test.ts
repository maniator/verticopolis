import { describe, it, expect } from "vitest";
import { GRID } from "../engine/facilities";
import type { Unit } from "../engine/types";
import {
  APRON_PAD_TILES,
  FORECOURT_TILES,
  FOUNTAIN_TILE,
  PLAZA_LAMP_TILES,
  PLAZA_SIDEWALK_TILES,
  ROAD_START,
  ROUNDABOUT_START,
  ROUNDABOUT_TILES,
  SIDEWALK_START,
  apronRange,
  hash01,
  plantSpots,
  plantVisible,
  skylineRects,
} from "./sceneryLayout";

/** A minimal ground-floor unit for apron math; only floor/x/width are read. */
function u(x: number, width: number, floor = 1): Unit {
  return { x, width, floor } as Unit;
}

describe("sceneryLayout", () => {
  it("is deterministic: the same seed lays the same city", () => {
    expect(skylineRects(4400)).toEqual(skylineRects(4400));
    expect(plantSpots(4400)).toEqual(plantSpots(4400));
    // And a different tower gets a different one.
    expect(JSON.stringify(plantSpots(4400))).not.toBe(JSON.stringify(plantSpots(4401)));
  });

  it("hash01 stays in the unit interval and spreads neighboring keys", () => {
    const seen = new Set<number>();
    for (let i = -50; i < 50; i++) {
      const h = hash01(i * 13);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      seen.add(h);
    }
    // Integer bit-mixing must decorrelate consecutive keys, not step smoothly.
    expect(seen.size).toBe(100);
  });

  it("runs the skyline continuously past both lot edges, in two depths", () => {
    const rects = skylineRects(7);
    expect(rects.some((r) => r.tile < 0)).toBe(true);
    expect(rects.some((r) => r.tile + r.w > GRID.width)).toBe(true);
    // The band behind the tower itself is populated too (the owner call:
    // the city is always back there, the building just covers part of it).
    expect(rects.some((r) => r.tile > 100 && r.tile < 275)).toBe(true);
    expect(new Set(rects.map((r) => r.depth))).toEqual(new Set([0, 1]));
    for (const r of rects) expect(r.hFloors).toBeGreaterThan(0);
  });

  it("keeps plants inside the lot and clear of both edges", () => {
    for (const seed of [1, 4400, 999999]) {
      for (const p of plantSpots(seed)) {
        expect(p.tile).toBeGreaterThanOrEqual(2);
        expect(p.tile).toBeLessThanOrEqual(GRID.width - 2);
      }
    }
  });

  it("apronRange pads the built ground floor and clamps to the lot", () => {
    expect(apronRange([])).toBeNull();
    // Upper floors alone leave the lot unpaved.
    expect(apronRange([u(100, 8, 2)])).toBeNull();
    expect(apronRange([u(100, 8)])).toEqual({ min: 100 - APRON_PAD_TILES, max: 108 + APRON_PAD_TILES });
    // Two separate stubs pave one shared span (min..max), like a forecourt.
    expect(apronRange([u(50, 4), u(90, 4)])).toEqual({ min: 50 - APRON_PAD_TILES, max: 94 + APRON_PAD_TILES });
    // A wall-to-wall lobby clamps to the lot bounds.
    expect(apronRange([u(0, GRID.width)])).toEqual({ min: 0, max: GRID.width });
  });

  it("plants stand on grass and fall to the apron", () => {
    const spot = { tile: 100, scale: 1, kind: "tree" as const };
    expect(plantVisible(spot, null)).toBe(true);
    expect(plantVisible(spot, { min: 120, max: 200 })).toBe(true);
    expect(plantVisible(spot, { min: 90, max: 110 })).toBe(false);
    // The pad matters: paving right up to the trunk fells the tree.
    expect(plantVisible(spot, { min: 101, max: 140 })).toBe(false);
    expect(plantVisible(spot, { min: 103, max: 140 })).toBe(true);
    // A bush claims the same footprint (a max-scale bush spans 2.4 tiles).
    const bush = { tile: 100, scale: 1.2, kind: "bush" as const };
    expect(plantVisible(bush, { min: 101, max: 140 })).toBe(false);
    expect(plantVisible(bush, { min: 103, max: 140 })).toBe(true);
  });

  it("street geometry starts beyond the lot: forecourt, then sidewalk, then road", () => {
    expect(SIDEWALK_START).toBe(GRID.width + FORECOURT_TILES);
    expect(ROAD_START).toBeGreaterThan(SIDEWALK_START);
  });

  it("plaza geometry sits fully left of the lot: sidewalk, then the roundabout", () => {
    expect(PLAZA_SIDEWALK_TILES).toBeGreaterThan(0);
    // The roundabout's drive ends flush against the sidewalk's left edge.
    expect(ROUNDABOUT_START + ROUNDABOUT_TILES).toBe(-PLAZA_SIDEWALK_TILES);
    // The fountain stands inside the roundabout, lamps flank the drive.
    expect(FOUNTAIN_TILE).toBeGreaterThan(ROUNDABOUT_START);
    expect(FOUNTAIN_TILE).toBeLessThan(ROUNDABOUT_START + ROUNDABOUT_TILES);
    for (const lamp of PLAZA_LAMP_TILES) {
      expect(lamp).toBeGreaterThanOrEqual(ROUNDABOUT_START + 1);
      expect(lamp).toBeLessThan(0);
    }
  });
});
