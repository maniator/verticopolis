import { describe, it, expect } from "vitest";
import { SKY_HEADROOM_FLOORS } from "../cameraBounds";
import { extentFloors, fitLayout, mapExtent } from "./geometry";
import { HEAT_BAD_FROM, HEAT_MIDDLING_FROM, HEAT_MODE_OF_VIEW, HEAT_VIEW_STYLE, HeatMarks, heatBand, OCCUPANCY_LEGEND, paintHeatMarks, TRAFFIC_LEGEND, type HeatBand } from "./heatView";
import type { MapPaintContext, PatternSource } from "./paint";
import { contrastRatio, hexLuminance, patternInk } from "./style";
import { MAP_BACKDROP } from "./viewMark";

const EXTENT = mapExtent({ lotWidth: 375, minFloor: -9, maxFloor: 100 }, SKY_HEADROOM_FLOORS);
const layout = fitLayout(EXTENT, 375, extentFloors(EXTENT) * 5);
const BANDS: HeatBand[] = ["good", "middling", "bad"];

const cell = (floor: number, severity: number, minX = 10, maxX = 40) => ({ floor, minX, maxX, severity });

describe("the heat views' bands", () => {
  it("paints the engine's congestion on Traffic and its occupancy on Occupancy", () => {
    expect(HEAT_MODE_OF_VIEW).toEqual({ traffic: "congestion", occupancy: "occupancy" });
  });

  it("splits the severity in thirds, with the churn point (two thirds) bad", () => {
    expect(HEAT_MIDDLING_FROM).toBeCloseTo(1 / 3);
    expect(HEAT_BAD_FROM).toBeCloseTo(2 / 3);
    expect(heatBand(0)).toBe("good");
    expect(heatBand(HEAT_MIDDLING_FROM - 1e-9)).toBe("good");
    expect(heatBand(HEAT_MIDDLING_FROM)).toBe("middling");
    expect(heatBand(2 / 3)).toBe("bad");
    expect(heatBand(1)).toBe("bad");
  });

  it("reads a severity that is not a number, or below 0, as good", () => {
    expect(heatBand(Number.NaN)).toBe("good");
    expect(heatBand(-1)).toBe("good");
    expect(heatBand(Number.POSITIVE_INFINITY)).toBe("bad");
  });

  it("gives each band its own pattern, ink that shows on it, and 3 to 1 on the backdrop", () => {
    expect(new Set(BANDS.map((b) => HEAT_VIEW_STYLE[b].pattern)).size).toBe(3);
    for (const band of BANDS) {
      const { fill, pattern } = HEAT_VIEW_STYLE[band];
      const lum = hexLuminance(fill)!;
      if (pattern !== "solid") expect(contrastRatio(lum, hexLuminance(patternInk(fill))!), band).toBeGreaterThanOrEqual(3);
      for (const [where, color] of Object.entries(MAP_BACKDROP)) expect(contrastRatio(lum, hexLuminance(color)!), `${band} on the ${where}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("lists each band once in each legend, best first", () => {
    expect(TRAFFIC_LEGEND.map((e) => [e.label, e.band])).toEqual([["Clear", "good"], ["Busy", "middling"], ["Jammed", "bad"]]);
    expect(OCCUPANCY_LEGEND.map((e) => [e.label, e.band])).toEqual([["Mostly full", "good"], ["Half full", "middling"], ["Mostly empty", "bad"]]);
    for (const e of [...TRAFFIC_LEGEND, ...OCCUPANCY_LEGEND]) expect(e.style).toBe(HEAT_VIEW_STYLE[e.band]);
  });
});

describe("HeatMarks", () => {
  it("keeps a read, and says whether a later read shows anything new", () => {
    const marks = new HeatMarks();
    expect(marks.take([cell(1, 0), cell(2, 0.5)])).toBe(true);
    expect(marks.take([cell(1, 0.1), cell(2, 0.6)])).toBe(false);
    expect(marks.take([cell(1, 0.1), cell(2, 0.7)])).toBe(true);
    expect(marks.take([cell(1, 0.1), cell(2, 0.7, 10, 41)])).toBe(true);
    expect(marks.take([cell(1, 0.1)])).toBe(true);
    expect(marks.take([])).toBe(true);
    expect(marks.take([])).toBe(false);
  });

  it("places each floor over its span on the map and counts the floors by band", () => {
    const marks = new HeatMarks();
    marks.take([cell(1, 0), cell(2, 0.5), cell(3, 0.9), cell(4, 1), cell(5000, 1)]);
    marks.place(layout);
    expect(marks.size).toBe(4);
    expect([marks.floorsIn("good"), marks.floorsIn("middling"), marks.floorsIn("bad")]).toEqual([1, 1, 2]);
    expect(marks.bandAt(1)).toBe("middling");
    const rect = marks.rectAt(0);
    expect(rect.w).toBe(Math.round((41 - EXTENT.leftTile) * layout.pxPerTile) - Math.round((10 - EXTENT.leftTile) * layout.pxPerTile));
    expect(rect.h).toBeGreaterThan(0);
    expect(marks.rectAt(1).y).toBeLessThan(rect.y);
  });

  it("forgets everything on clear", () => {
    const marks = new HeatMarks();
    marks.take([cell(1, 0.9)]);
    marks.place(layout);
    marks.clear();
    expect(marks.size).toBe(0);
    expect(marks.floorsIn("bad")).toBe(0);
    expect(marks.take([cell(1, 0.9)])).toBe(true);
  });

  it("paints each placed floor once, in its band's fill, plain where too small for a pattern", () => {
    const marks = new HeatMarks();
    marks.take([cell(1, 0), cell(2, 0.9)]);
    marks.place(layout);
    const asked: Array<[string, string]> = [];
    const patterns: PatternSource = { get: (fill, pattern) => (asked.push([fill, pattern]), `${fill}/${pattern}`) };
    const fills: unknown[] = [];
    const ctx: MapPaintContext = { fillStyle: "", fillRect: (...a: number[]) => fills.push(a), clearRect: () => {} };
    expect(paintHeatMarks(ctx, marks, patterns)).toBe(2);
    expect(fills).toHaveLength(2);
    const tall = marks.rectAt(1).h >= 4;
    expect(asked[1]).toEqual([HEAT_VIEW_STYLE.bad.fill, tall ? HEAT_VIEW_STYLE.bad.pattern : "solid"]);
  });
});
