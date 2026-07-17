import { describe, it, expect } from "vitest";
import { emptyOriginRings, foldOrigins, topOriginFloors, peakOriginFloor, ORIGIN_HOURS } from "./scheduleOrigins";

describe("foldOrigins (#465)", () => {
  it("lands a floor's first positive sample at full value in the right day slot", () => {
    const rings = emptyOriginRings();
    foldOrigins(rings, false, 8, new Map([[5, 20]]));
    expect(rings.weekday[8].get(5)).toBe(20);
    expect(rings.weekend[8].size).toBe(0); // never bleeds across day types
    expect(rings.weekday[9].size).toBe(0); // or across hours
  });

  it("EMA-blends repeat samples and decays a floor that goes quiet", () => {
    const rings = emptyOriginRings();
    foldOrigins(rings, false, 8, new Map([[5, 10]]));
    foldOrigins(rings, false, 8, new Map([[5, 20]]));
    expect(rings.weekday[8].get(5)).toBeCloseTo(0.3 * 20 + 0.7 * 10);
    // The floor stops producing riders: it decays toward zero and is pruned.
    for (let i = 0; i < 60; i++) foldOrigins(rings, false, 8, undefined);
    expect(rings.weekday[8].has(5)).toBe(false);
  });

  it("wraps out-of-range hours instead of writing off the ring", () => {
    const rings = emptyOriginRings();
    foldOrigins(rings, true, ORIGIN_HOURS + 3, new Map([[2, 5]]));
    expect(rings.weekend[3].get(2)).toBe(5);
  });
});

describe("topOriginFloors / peakOriginFloor (#465)", () => {
  it("returns the busiest floors first, filtered by share and capped", () => {
    const slot = new Map([
      [1, 10],
      [7, 30],
      [4, 2], // 2/42 < 15%: filtered out
    ]);
    expect(topOriginFloors(slot)).toEqual([7, 1]);
    expect(peakOriginFloor(slot)).toBe(7);
  });

  it("is empty (and undefined) with no measured mass", () => {
    expect(topOriginFloors(undefined)).toEqual([]);
    expect(topOriginFloors(new Map())).toEqual([]);
    expect(peakOriginFloor(new Map())).toBeUndefined();
  });

  it("breaks count ties toward the lower floor for a stable readout", () => {
    const slot = new Map([
      [9, 10],
      [3, 10],
    ]);
    expect(topOriginFloors(slot)).toEqual([3, 9]);
  });
});
