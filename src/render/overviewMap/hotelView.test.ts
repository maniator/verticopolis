import { describe, it, expect } from "vitest";
import type { FacilityKind, UnitState } from "../../shared/types";
import { FACILITY_PRESENTATION } from "../../presentation/facilityPresentation";
import { SKY_HEADROOM_FLOORS } from "../cameraBounds";
import { extentFloors, fitLayout, mapExtent } from "./geometry";
import {
  HOTEL_LEGEND,
  HOTEL_VIEW_STYLE,
  HotelWatch,
  buildHotelMarks,
  housekeepingNeed,
  isHotelKind,
  paintHotelMarks,
  type HotelRoom,
} from "./hotelView";
import { MIN_PATTERN_SIDE, type MapPaintContext, type PatternSource } from "./paint";
import { KIND_GROUP, contrastRatio, hexLuminance } from "./style";

const WORLD = { lotWidth: 375, minFloor: -9, maxFloor: 100 };
const EXTENT = mapExtent(WORLD, SKY_HEADROOM_FLOORS);
/** One map pixel per tile and five per floor, so a 4-tile single carries a pattern. */
const layout = fitLayout(EXTENT, 375, extentFloors(EXTENT) * 5);
const yOfLine = (line: number): number => (EXTENT.topLine - line) * 5;

function room(kind: FacilityKind, x: number, state: UnitState = "occupied", floor = 2): HotelRoom & { state: UnitState } {
  return { kind, floor, x, width: 4, state };
}

function fakeCtx(): MapPaintContext & { fills: Array<{ rect: number[]; style: unknown }> } {
  const fills: Array<{ rect: number[]; style: unknown }> = [];
  let style: unknown = "";
  return {
    fills,
    get fillStyle() {
      return style as string;
    },
    set fillStyle(v) {
      style = v;
    },
    fillRect(x, y, w, h) {
      fills.push({ rect: [x, y, w, h], style });
    },
    clearRect() {},
  };
}

const named: PatternSource = { get: (fill, pattern) => (pattern === "solid" ? fill : `${pattern}:${fill}`) };

describe("the Hotel view's rooms", () => {
  it("marks dirty and infested rooms and nothing else", () => {
    expect(housekeepingNeed("dirty")).toBe("dirty");
    expect(housekeepingNeed("infested")).toBe("infested");
    for (const state of ["construction", "empty", "occupied", "moving_in", "vacating", "asleep", "fire", "gutted"] as UnitState[]) {
      expect(housekeepingNeed(state), state).toBeNull();
    }
    // A forged state from a foreign save is not a need.
    expect(housekeepingNeed("toString" as UnitState)).toBeNull();
  });

  it("knows the hotel kinds from the style table's hotel group", () => {
    const hotels = (Object.keys(KIND_GROUP) as FacilityKind[]).filter(isHotelKind);
    expect(hotels.sort()).toEqual(["hotelDouble", "hotelSingle", "hotelSuite"]);
    expect(isHotelKind("office")).toBe(false);
    expect(isHotelKind("nope" as FacilityKind)).toBe(false);
  });

  it("collects only the hotel rooms, at their real tile and floor", () => {
    const rooms = [room("office", 10), room("hotelSingle", 40), room("hotelSuite", 60, "dirty", 5)];
    const marks = buildHotelMarks(layout, rooms, () => 1);
    expect(marks.map((m) => m.room)).toEqual([rooms[1], rooms[2]]);
    expect(marks[1].rect).toEqual({ x: 60, y: yOfLine(5), w: 4, h: 5 });
  });
});

describe("HotelWatch", () => {
  it("says a new set of rooms changed, then only when a room's need does", () => {
    const rooms = [room("hotelSingle", 40, "asleep"), room("hotelDouble", 50, "occupied")];
    const watch = new HotelWatch();
    watch.watch(buildHotelMarks(layout, rooms, () => 1));
    expect(watch.check()).toBe(true);
    expect(watch.check()).toBe(false);
    // Asleep to occupied needs nothing of housekeeping: nothing to repaint.
    rooms[0].state = "occupied";
    expect(watch.check()).toBe(false);
    rooms[0].state = "dirty";
    expect(watch.check()).toBe(true);
    expect(watch.rooms("dirty")).toBe(1);
    expect(watch.rooms("infested")).toBe(0);
    rooms[1].state = "infested";
    expect(watch.check()).toBe(true);
    expect(watch.rooms("infested")).toBe(1);
    expect(watch.needAt(0)).toBe("dirty");
    expect(watch.needAt(1)).toBe("infested");
    watch.clear();
    expect(watch.size).toBe(0);
  });

  it("says new rooms changed even when there are none, so the legend count drops to 0", () => {
    const watch = new HotelWatch();
    watch.watch([]);
    expect(watch.check()).toBe(true);
    expect(watch.rooms("dirty")).toBe(0);
    expect(watch.check()).toBe(false);
    // The last dirty room is demolished: the next set is empty, and that is news.
    watch.watch(buildHotelMarks(layout, [room("hotelSingle", 40, "dirty")], () => 1));
    expect(watch.check()).toBe(true);
    expect(watch.rooms("dirty")).toBe(1);
    watch.watch([]);
    expect(watch.check()).toBe(true);
    expect(watch.rooms("dirty")).toBe(0);
  });
});

describe("paintHotelMarks", () => {
  it("paints only the rooms needing housekeeping, in each need's style", () => {
    const rooms = [room("hotelSingle", 40, "dirty"), room("hotelSingle", 50, "occupied"), room("hotelDouble", 60, "infested")];
    const watch = new HotelWatch();
    watch.watch(buildHotelMarks(layout, rooms, () => 1));
    watch.check();
    const ctx = fakeCtx();
    expect(paintHotelMarks(ctx, watch, named)).toBe(2);
    expect(ctx.fills.map((f) => f.style)).toEqual([
      `${HOTEL_VIEW_STYLE.dirty.pattern}:${HOTEL_VIEW_STYLE.dirty.fill}`,
      `${HOTEL_VIEW_STYLE.infested.pattern}:${HOTEL_VIEW_STYLE.infested.fill}`,
    ]);
    expect(ctx.fills[0].rect).toEqual([40, yOfLine(2), 4, 5]);
  });

  it("paints a room too small for a pattern plain", () => {
    const small = fitLayout(EXTENT, 200, 288);
    const watch = new HotelWatch();
    watch.watch(buildHotelMarks(small, [room("hotelSingle", 40, "dirty")], () => 1));
    watch.check();
    const ctx = fakeCtx();
    paintHotelMarks(ctx, watch, named);
    const [w, h] = ctx.fills[0].rect.slice(2);
    expect(Math.min(w, h)).toBeLessThan(MIN_PATTERN_SIDE);
    expect(ctx.fills[0].style).toBe(HOTEL_VIEW_STYLE.dirty.fill);
  });
});

describe("the Hotel view's styles", () => {
  const lum = (c: string) => hexLuminance(c)!;

  it("tells dirty from infested by lightness and by pattern, one legend entry each", () => {
    const { dirty, infested } = HOTEL_VIEW_STYLE;
    expect(dirty.pattern).not.toBe(infested.pattern);
    expect(lum(dirty.fill)).toBeGreaterThan(lum(infested.fill));
    expect(HOTEL_LEGEND.map((e) => e.needs)).toEqual([["dirty"], ["infested"]]);
  });

  it("keeps every mark 3:1 against what it covers, so it reads without color", () => {
    for (const need of ["dirty", "infested"] as const) {
      for (const kind of ["hotelSingle", "hotelDouble", "hotelSuite"] as const) {
        expect(contrastRatio(lum(HOTEL_VIEW_STYLE[need].fill), lum(FACILITY_PRESENTATION[kind].color)), `${need} on ${kind}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("gives every mark a pattern for the rooms big enough to carry one", () => {
    for (const need of ["dirty", "infested"] as const) expect(HOTEL_VIEW_STYLE[need].pattern).not.toBe("solid");
  });
});
