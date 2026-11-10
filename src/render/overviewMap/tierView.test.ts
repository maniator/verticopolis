import { describe, it, expect } from "vitest";
import type { FacilityKind } from "../../engine/types";
import { SKY_HEADROOM_FLOORS } from "../cameraBounds";
import { extentFloors, fitLayout, mapExtent } from "./geometry";
import { MIN_PATTERN_SIDE, type MapPaintContext, type PatternSource } from "./paint";
import type { EvalTier, RentTier } from "../../simport/roomTiers";
import { tiersOf } from "./tierView.fixture";
import { EVAL_LEGEND, EVAL_VIEW_STYLE, paintTierMarks, PRICING_LEGEND, RENT_VIEW_STYLE, TierMarks, type TierRoom } from "./tierView";

const EXTENT = mapExtent({ lotWidth: 375, minFloor: -9, maxFloor: 100 }, SKY_HEADROOM_FLOORS);
/** One map pixel per tile and five per floor, so a 4-tile room carries a pattern. */
const layout = fitLayout(EXTENT, 375, extentFloors(EXTENT) * 5);
const floorsOf = (_kind: FacilityKind) => 1;

const room = (id: number, x = id, width = 4): TierRoom => ({ id, kind: "office", floor: 2, x, width });
/** Place the kept rows on `rooms`, with an id index over the same rooms. */
const placeOn = (marks: TierMarks, rooms: TierRoom[]) => marks.place(layout, rooms, (id) => rooms.find((r) => r.id === id), floorsOf);

function fakeCtx(): MapPaintContext & { fills: Array<{ w: number; style: unknown }> } {
  const fills: Array<{ w: number; style: unknown }> = [];
  let style: unknown = "";
  return {
    fills,
    get fillStyle() {
      return style as string;
    },
    set fillStyle(v) {
      style = v;
    },
    fillRect: (_x, _y, w) => fills.push({ w, style }),
    clearRect: () => {},
  };
}
const tagged: PatternSource = { get: (fill, pattern) => `${pattern}|${fill}` };

describe("the tier views' styles and legends", () => {
  it("paint every rated tier, and leave unrated, unpriced and No Rate rooms as Edit draws them", () => {
    expect(EVAL_VIEW_STYLE.unrated).toBeNull();
    expect(RENT_VIEW_STYLE.unpriced).toBeNull();
    expect(RENT_VIEW_STYLE.noRate).toBeNull();
    for (const tier of ["terrible", "good", "excellent"] as const) expect(EVAL_VIEW_STYLE[tier]).not.toBeNull();
    for (const tier of ["veryLow", "low", "average", "high"] as const) expect(RENT_VIEW_STYLE[tier]).not.toBeNull();
  });

  it("tell a view's tiers apart by pattern as well as by color", () => {
    for (const legend of [EVAL_LEGEND, PRICING_LEGEND]) {
      expect(new Set(legend.map((e) => e.style.fill)).size).toBe(legend.length);
      expect(new Set(legend.map((e) => e.style.pattern)).size).toBe(legend.length);
    }
  });

  it("list the original's swatches in its order", () => {
    expect(EVAL_LEGEND.map((e) => e.label)).toEqual(["Excellent", "Good", "Terrible"]);
    expect(PRICING_LEGEND.map((e) => e.label)).toEqual(["High", "Average", "Low", "Very Low"]);
    expect(EVAL_LEGEND.map((e) => e.style)).toEqual(EVAL_LEGEND.map((e) => EVAL_VIEW_STYLE[e.tier]));
    expect(PRICING_LEGEND.map((e) => e.style)).toEqual(PRICING_LEGEND.map((e) => RENT_VIEW_STYLE[e.tier]));
  });
});

describe("TierMarks", () => {
  it("matches rows to rooms in lockstep, skipping rooms with no row, and counts each tier", () => {
    const marks = new TierMarks();
    marks.take(
      tiersOf([
        [2, "excellent", "average"],
        [4, "terrible", "high"],
      ]),
    );
    placeOn(marks, [room(1), room(2), room(3), room(4)]);
    expect(marks.rowCount).toBe(2);
    expect(marks.size).toBe(2);
    expect(marks.styleAt(0, "eval")).toBe(EVAL_VIEW_STYLE.excellent);
    expect(marks.styleAt(1, "pricing")).toBe(RENT_VIEW_STYLE.high);
    expect(marks.rectAt(0).x).toBeLessThan(marks.rectAt(1).x);
    expect(marks.evalRooms("excellent")).toBe(1);
    expect(marks.evalRooms("good")).toBe(0);
    expect(marks.rentRooms("average")).toBe(1);
    expect(marks.rentRooms("high")).toBe(1);
  });

  it("drops a row whose room is gone, and matches the rest through an id map once the walk loses step", () => {
    const marks = new TierMarks();
    // Row 9 has no room; the walk runs out on it, and rows 3 and 1 (out of
    // the rooms' order, as after a repeated revision) still match by id.
    marks.take(
      tiersOf([
        [2, "good", "low"],
        [9, "good", "low"],
        [3, "terrible", "veryLow"],
        [1, "excellent", "high"],
      ]),
    );
    placeOn(marks, [room(1), room(2), room(3)]);
    expect(marks.size).toBe(3);
    expect([0, 1, 2].map((i) => marks.styleAt(i, "eval"))).toEqual([EVAL_VIEW_STYLE.good, EVAL_VIEW_STYLE.terrible, EVAL_VIEW_STYLE.excellent]);
    expect(marks.evalRooms("good")).toBe(1);
  });

  it("says whether a read differs from the rows it kept", () => {
    const marks = new TierMarks();
    const rows: Array<[number, EvalTier, RentTier]> = [
      [1, "good", "low"],
      [2, "good", "low"],
    ];
    expect(marks.take(tiersOf(rows))).toBe(true);
    expect(marks.take(tiersOf(rows))).toBe(false);
    expect(marks.take(tiersOf([rows[0], [2, "good", "high"]]))).toBe(true);
    expect(marks.take(tiersOf([rows[0]]))).toBe(true);
    expect(marks.take(tiersOf([[1, "good", "low"]], () => [3, 1]))).toBe(true);
  });

  it("drops a kept row whose room now stands somewhere else", () => {
    const marks = new TierMarks();
    marks.take(tiersOf([[1, "good", "low"], [2, "good", "low"]]));
    placeOn(marks, [room(1), { ...room(2), x: 40 }]);
    expect(marks.size).toBe(1);
    placeOn(marks, [room(1), { ...room(2), floor: 3 }]);
    expect(marks.size).toBe(1);
  });

  it("places the kept rows again on new rooms and drops a room that cannot be drawn", () => {
    const marks = new TierMarks();
    marks.take(
      tiersOf([
        [1, "good", "low"],
        [2, "good", "low"],
      ]),
    );
    placeOn(marks, [room(1), room(2)]);
    expect(marks.size).toBe(2);
    placeOn(marks, [room(1), { ...room(2), width: Number.NaN }]);
    expect(marks.size).toBe(1);
    expect(marks.rentRooms("low")).toBe(1);
    marks.clear();
    expect(marks.rowCount).toBe(0);
    expect(marks.size).toBe(0);
    expect(marks.rentRooms("low")).toBe(0);
  });
});

describe("paintTierMarks", () => {
  it("paints the rated rooms in the chosen view's style, plain when too small for a pattern", () => {
    const marks = new TierMarks();
    marks.take(
      tiersOf([
        [10, "unrated", "high"],
        [20, "terrible", "noRate"],
        [30, "excellent", "average"],
      ]),
    );
    placeOn(marks, [room(10), room(20, 20, 1), room(30)]);
    const evalCtx = fakeCtx();
    expect(paintTierMarks(evalCtx, marks, "eval", tagged)).toBe(2);
    expect(marks.rectAt(1).w).toBeLessThan(MIN_PATTERN_SIDE);
    expect(evalCtx.fills.map((f) => f.style)).toEqual([`solid|${EVAL_VIEW_STYLE.terrible!.fill}`, `solid|${EVAL_VIEW_STYLE.excellent!.fill}`]);
    const priceCtx = fakeCtx();
    expect(paintTierMarks(priceCtx, marks, "pricing", tagged)).toBe(2);
    expect(priceCtx.fills.map((f) => f.style)).toEqual([`${RENT_VIEW_STYLE.high!.pattern}|${RENT_VIEW_STYLE.high!.fill}`, `solid|${RENT_VIEW_STYLE.average!.fill}`]);
  });
});
