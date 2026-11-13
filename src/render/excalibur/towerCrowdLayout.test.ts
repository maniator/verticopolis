import { describe, it, expect } from "vitest";
import {
  coveredUpperStories,
  ELEVATOR_LANDING_TILES,
  FLIGHT_LANDING_TILES,
  lotCovered,
  SHOP_FRONT_TILES,
  trafficLots,
} from "./towerCrowdLayout";
import type { Unit } from "../../shared/types";
import { catalogFor } from "../../tests/catalogFixture";

const MODERN = catalogFor("modern");

/**
 * Pure layout math for the decorative passer-by builder: the multi-floor-facility
 * exclusion (so figures never float on a facility's upper story) and the
 * traffic lots they keep off (so they never stand where real queues form). These
 * take plain values, so unlike buildWalkers they run without a canvas bake.
 */

const unit = (kind: string, floor: number, x: number, width: number) =>
  ({ kind, floor, x, width } as unknown as Unit);

describe("coveredUpperStories marks the upper floors of multi-floor facilities", () => {
  it("returns no rows when every unit is single-story", () => {
    const rows = coveredUpperStories([unit("office", 3, 10, 6), unit("floor", 3, 16, 1)], MODERN);
    expect(rows.size).toBe(0);
  });

  it("covers the upper story of a two-floor facility, not its base", () => {
    // recycling spans 2 floors: base at -1, upper story at 0.
    const rows = coveredUpperStories([unit("recycling", -1, 112, 20)], MODERN);
    expect(rows.has(-1)).toBe(false); // base story keeps its walkers
    expect(rows.get(0)).toEqual([[112, 132]]);
  });

  it("covers every non-base story of a three-floor facility", () => {
    // metro spans 3 floors: base at -7, upper stories at -6 and -5.
    const rows = coveredUpperStories([unit("metro", -7, 0, 34)], MODERN);
    expect(rows.has(-7)).toBe(false);
    expect(rows.get(-6)).toEqual([[0, 34]]);
    expect(rows.get(-5)).toEqual([[0, 34]]);
  });

  it("accumulates spans from several facilities sharing a covered row", () => {
    const rows = coveredUpperStories([unit("recycling", -1, 10, 20), unit("cinema", -1, 60, 31)], MODERN);
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

describe("trafficLots marks where a player reads real traffic (#2091)", () => {
  const span = (lots: Map<number, Set<number>>, floor: number) => {
    const xs = [...(lots.get(floor) ?? [])].sort((a, b) => a - b);
    return xs.length ? [xs[0], xs[xs.length - 1], xs.length] : null;
  };

  it("clears an elevator's landing on every floor it serves, and no other", () => {
    const lots = trafficLots([{ kind: "elevatorStandard", x: 50, width: 4, bottom: 2, top: 4 }], [], MODERN);
    const want = [50 - ELEVATOR_LANDING_TILES, 53 + ELEVATOR_LANDING_TILES, 4 + 2 * ELEVATOR_LANDING_TILES];
    expect([span(lots, 2), span(lots, 3), span(lots, 4)]).toEqual([want, want, want]);
    expect(span(lots, 1)).toBeNull();
    expect(span(lots, 5)).toBeNull();
  });

  it("clears a narrower margin round a stair or escalator", () => {
    const lots = trafficLots([{ kind: "stairs", x: 10, width: 8, bottom: 4, top: 5 }], [], MODERN);
    expect(span(lots, 4)).toEqual([10 - FLIGHT_LANDING_TILES, 17 + FLIGHT_LANDING_TILES, 8 + 2 * FLIGHT_LANDING_TILES]);
    expect(span(lots, 5)).toEqual(span(lots, 4));
  });

  it("clears a commercial room's front but not an office's", () => {
    const lots = trafficLots([], [unit("shop", 3, 40, 12), unit("office", 6, 40, 9)], MODERN);
    expect(span(lots, 3)).toEqual([40 - SHOP_FRONT_TILES, 51 + SHOP_FRONT_TILES, 12 + 2 * SHOP_FRONT_TILES]);
    expect(span(lots, 6)).toBeNull();
  });
});
