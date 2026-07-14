import { describe, it, expect } from "vitest";
import { coveredUpperStories, lotCovered, lobbyLaneSpan } from "./towerCrowdLayout";
import type { Unit } from "../../engine/types";

/**
 * Pure layout math for the ambient-walker builder: the multi-floor-facility
 * exclusion (so figures never float on a facility's upper story) and the lobby
 * lane split (so a busy concourse fans figures out instead of clumping). These
 * take plain values, so unlike buildWalkers they run without a canvas bake.
 */

const unit = (kind: string, floor: number, x: number, width: number) =>
  ({ kind, floor, x, width } as unknown as Unit);

describe("coveredUpperStories marks the upper floors of multi-floor facilities", () => {
  it("returns no rows when every unit is single-story", () => {
    const rows = coveredUpperStories([unit("office", 3, 10, 6), unit("floor", 3, 16, 1)]);
    expect(rows.size).toBe(0);
  });

  it("covers the upper story of a two-floor facility, not its base", () => {
    // recycling spans 2 floors: base at -1, upper story at 0.
    const rows = coveredUpperStories([unit("recycling", -1, 112, 20)]);
    expect(rows.has(-1)).toBe(false); // base story keeps its walkers
    expect(rows.get(0)).toEqual([[112, 132]]);
  });

  it("covers every non-base story of a three-floor facility", () => {
    // metro spans 3 floors: base at -7, upper stories at -6 and -5.
    const rows = coveredUpperStories([unit("metro", -7, 0, 34)]);
    expect(rows.has(-7)).toBe(false);
    expect(rows.get(-6)).toEqual([[0, 34]]);
    expect(rows.get(-5)).toEqual([[0, 34]]);
  });

  it("accumulates spans from several facilities sharing a covered row", () => {
    const rows = coveredUpperStories([unit("recycling", -1, 10, 20), unit("cinema", -1, 60, 31)]);
    expect(rows.get(0)).toEqual([[10, 30], [60, 91]]);
  });
});

describe("lotCovered tests a lot against the covered spans (half-open)", () => {
  const rows = new Map<number, Array<[number, number]>>([[0, [[10, 30]]]]);

  it("is true inside a span and false outside it", () => {
    expect(lotCovered(rows, 0, 10)).toBe(true); // left edge included
    expect(lotCovered(rows, 0, 29)).toBe(true);
    expect(lotCovered(rows, 0, 9)).toBe(false);
    expect(lotCovered(rows, 0, 30)).toBe(false); // right edge excluded (half-open)
  });

  it("is false on a row with no covered spans", () => {
    expect(lotCovered(rows, 5, 15)).toBe(false);
  });
});

describe("lobbyLaneSpan splits a concourse run into non-inverting lanes", () => {
  it("keeps every lane within the run and never inverts, for any count", () => {
    for (const count of [1, 2, 5, 8, 20]) {
      for (let i = 0; i < count; i++) {
        const [a, b] = lobbyLaneSpan(i, count, 100, 400);
        expect(a).toBeGreaterThanOrEqual(100);
        expect(b).toBeLessThanOrEqual(400);
        expect(b).toBeGreaterThanOrEqual(a); // segment never inverts
      }
    }
  });

  it("places lanes at evenly spaced, distinct anchors across the run", () => {
    const count = 8;
    const mids: number[] = [];
    for (let i = 0; i < count; i++) {
      const [a, b] = lobbyLaneSpan(i, count, 0, 800);
      mids.push((a + b) / 2);
    }
    // Midpoints climb monotonically and span the run, so figures fan across the
    // width instead of sharing a lane.
    for (let i = 1; i < count; i++) expect(mids[i]).toBeGreaterThan(mids[i - 1]);
    expect(new Set(mids).size).toBe(count);
  });

  it("never collapses figures into one lane, even when count is a multiple of 7", () => {
    // A stride-based interleave (i * 7 mod count) would map every figure to the
    // same lane at count 7 or 14; the even split must keep them distinct.
    for (const count of [7, 14]) {
      const mids = new Set<number>();
      for (let i = 0; i < count; i++) {
        const [a, b] = lobbyLaneSpan(i, count, 0, 800);
        mids.add((a + b) / 2);
      }
      expect(mids.size).toBe(count);
    }
  });
});
