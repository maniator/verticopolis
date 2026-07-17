import { describe, it, expect } from "vitest";
import { dayOriginTotals, emptyOriginRings, foldOrigins, topOriginFloors, peakOriginFloor, ORIGIN_HOURS } from "./scheduleOrigins";

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

  it("blends a returning floor in at sample weight instead of re-seeding full (#465)", () => {
    // Only an EMPTY slot takes the full-value seed; a floor joining an active
    // slot (including one that decayed out) blends in, so an intermittent
    // floor cannot oscillate between full weight and pruned.
    const rings = emptyOriginRings();
    foldOrigins(rings, false, 8, new Map([[5, 10]])); // empty slot: full seed
    expect(rings.weekday[8].get(5)).toBe(10);
    foldOrigins(rings, false, 8, new Map([[5, 10], [7, 10]])); // active slot: 7 blends
    expect(rings.weekday[8].get(7)).toBeCloseTo(3);
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

describe("dayOriginTotals (#465)", () => {
  it("sums a day's boarding mass across every hour slot, floor by floor", () => {
    const rings = emptyOriginRings();
    foldOrigins(rings, false, 8, new Map([[1, 20]]));
    foldOrigins(rings, false, 17, new Map([[9, 12]]));
    foldOrigins(rings, false, 18, new Map([[9, 6]]));
    const totals = dayOriginTotals(rings.weekday);
    expect(totals.get(1)).toBe(20);
    expect(totals.get(9)).toBe(18); // 12 + 6 across two slots
    expect(dayOriginTotals(rings.weekend).size).toBe(0);
  });
});
