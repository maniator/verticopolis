import { describe, it, expect } from "vitest";
import {
  coerceSchedule,
  scheduleIsEmpty,
  cloneSchedule,
  activeCarCount,
  homeFloorFor,
  dwellMinutesFor,
  waitingResponseFor,
  SCHEDULE_HOURS,
  WAITING_CAR_RESPONSE_MAX,
  STANDARD_FLOOR_DEPARTURE_MAX,
  DWELL_DEFAULT_SECONDS,
} from "./elevatorSchedule";
import type { ElevatorSchedule } from "./elevatorSchedule";

/**
 * The elevator-schedule leaf (elevator-scheduling, #305). The first blocks pin the
 * Phase 1 load-boundary coercion that hardens an untrusted saved schedule and the
 * empty guard the serializer uses; the last block pins the Phase 2 dispatch read
 * accessors, chiefly that each short-circuits to today's behavior for an absent
 * schedule or field (the golden-master invariant rests on that).
 */

const CARS = 8;
const BOTTOM = 1;
const TOP = 30;

describe("coerceSchedule (load trust boundary)", () => {
  it("returns undefined for a non-schedule value", () => {
    expect(coerceSchedule(undefined, CARS, BOTTOM, TOP)).toBeUndefined();
    expect(coerceSchedule(null, CARS, BOTTOM, TOP)).toBeUndefined();
    expect(coerceSchedule(42, CARS, BOTTOM, TOP)).toBeUndefined();
    expect(coerceSchedule("nope", CARS, BOTTOM, TOP)).toBeUndefined();
    expect(coerceSchedule([], CARS, BOTTOM, TOP)).toBeUndefined(); // an array is not a schedule object
  });

  it("returns undefined for an empty or all-absent schedule (never persists nothing)", () => {
    expect(coerceSchedule({}, CARS, BOTTOM, TOP)).toBeUndefined();
    expect(coerceSchedule({ activeCars: {} }, CARS, BOTTOM, TOP)).toBeUndefined();
    expect(coerceSchedule({ activeCars: { weekday: [] } }, CARS, BOTTOM, TOP)).toBeUndefined();
  });

  it("drops a schedule on a car-less transport, and rejects non-finite bounds", () => {
    const real = { waitingCarResponse: 3 };
    expect(coerceSchedule(real, 0, BOTTOM, TOP)).toBeUndefined(); // stairs/escalator: cars 0
    expect(coerceSchedule(real, -1, BOTTOM, TOP)).toBeUndefined();
    expect(coerceSchedule(real, Number.NaN, BOTTOM, TOP)).toBeUndefined();
    expect(coerceSchedule(real, CARS, Number.NaN, TOP)).toBeUndefined();
    expect(coerceSchedule(real, CARS, BOTTOM, Infinity)).toBeUndefined();
  });

  it("truncates an over-length day-type row to 24 hours", () => {
    const long = Array.from({ length: 48 }, () => 1); // twice a day
    const s = coerceSchedule({ activeCars: { weekday: long } }, CARS, BOTTOM, TOP)!;
    expect(s.activeCars?.weekday).toHaveLength(SCHEDULE_HOURS); // hours 24..47 dropped
  });

  it("coerces a day-type row to length 24 with each hour clamped to [0, cars]", () => {
    const raw = { activeCars: { weekday: [-3, 0, 4, 999, 2.9, Number.NaN, Infinity] } };
    const s = coerceSchedule(raw, CARS, BOTTOM, TOP)!;
    expect(s.activeCars?.weekday).toHaveLength(SCHEDULE_HOURS);
    expect(s.activeCars?.weekday?.[0]).toBe(0); // negative clamps up
    expect(s.activeCars?.weekday?.[2]).toBe(4);
    expect(s.activeCars?.weekday?.[3]).toBe(CARS); // huge clamps down to cars
    expect(s.activeCars?.weekday?.[4]).toBe(2); // 2.9 floors
    expect(s.activeCars?.weekday?.[5]).toBe(CARS); // NaN defaults to "all cars run"
    expect(s.activeCars?.weekday?.[6]).toBe(CARS); // Infinity defaults to all cars
    // A missing hour beyond the input length defaults to all cars run.
    expect(s.activeCars?.weekday?.[23]).toBe(CARS);
    expect(s.activeCars?.weekend).toBeUndefined(); // only the present row is stored
  });

  it("clamps the two response tunables and omits non-finite ones", () => {
    const s = coerceSchedule(
      { waitingCarResponse: 999, standardFloorDeparture: -5 },
      CARS,
      BOTTOM,
      TOP,
    )!;
    expect(s.waitingCarResponse).toBe(WAITING_CAR_RESPONSE_MAX);
    expect(s.standardFloorDeparture).toBe(0);
    const rounded = coerceSchedule({ waitingCarResponse: 3.6 }, CARS, BOTTOM, TOP)!;
    expect(rounded.waitingCarResponse).toBe(4); // rounds
    const bad = coerceSchedule(
      { waitingCarResponse: Number.NaN, standardFloorDeparture: "x", homeFloors: [BOTTOM] },
      CARS,
      BOTTOM,
      TOP,
    )!;
    expect(bad.waitingCarResponse).toBeUndefined(); // non-finite omitted, falls back at read time
    expect(bad.standardFloorDeparture).toBeUndefined();
    expect(STANDARD_FLOOR_DEPARTURE_MAX).toBeGreaterThan(0); // sanity on the exported bound
  });

  it("clamps home floors onto the shaft and never keeps more than one per car", () => {
    const raw = { homeFloors: [0, 15, 999, Number.NaN, 5, 6, 7, 8, 9, 10] }; // 10 entries, 8 cars
    const s = coerceSchedule(raw, CARS, BOTTOM, TOP)!;
    expect(s.homeFloors).toHaveLength(CARS); // capped to the car count
    expect(s.homeFloors?.[0]).toBe(BOTTOM); // 0 clamps up to bottom
    expect(s.homeFloors?.[1]).toBe(15);
    expect(s.homeFloors?.[2]).toBe(TOP); // 999 clamps down to top
    expect(s.homeFloors?.[3]).toBe(BOTTOM); // NaN defaults to bottom
  });

  it("passes a valid, in-range schedule through unchanged in meaning", () => {
    const weekday = Array.from({ length: SCHEDULE_HOURS }, (_, h) => (h >= 8 && h < 18 ? CARS : 2));
    const raw: ElevatorSchedule = {
      activeCars: { weekday, weekend: Array(SCHEDULE_HOURS).fill(1) },
      waitingCarResponse: 5,
      standardFloorDeparture: 10,
      homeFloors: [1, 1, 15, 15],
    };
    const s = coerceSchedule(raw, CARS, BOTTOM, TOP)!;
    expect(s.activeCars?.weekday).toEqual(weekday);
    expect(s.activeCars?.weekend).toEqual(Array(SCHEDULE_HOURS).fill(1));
    expect(s.waitingCarResponse).toBe(5);
    expect(s.standardFloorDeparture).toBe(10);
    expect(s.homeFloors).toEqual([1, 1, 15, 15]);
  });
});

describe("scheduleIsEmpty", () => {
  it("is true for undefined, {}, and empty rows; false once anything is set", () => {
    expect(scheduleIsEmpty(undefined)).toBe(true);
    expect(scheduleIsEmpty({})).toBe(true);
    expect(scheduleIsEmpty({ activeCars: { weekday: [] } })).toBe(true);
    expect(scheduleIsEmpty({ waitingCarResponse: 3 })).toBe(false);
    expect(scheduleIsEmpty({ homeFloors: [1] })).toBe(false);
    expect(scheduleIsEmpty({ activeCars: { weekday: [1] } })).toBe(false);
  });
});

describe("cloneSchedule", () => {
  it("deep-copies rows and home floors so the snapshot cannot alias the source", () => {
    const src: ElevatorSchedule = {
      activeCars: { weekday: [1, 2, 3], weekend: [4, 5] },
      homeFloors: [1, 2],
      waitingCarResponse: 3,
    };
    const copy = cloneSchedule(src);
    expect(copy).toEqual(src);
    copy.activeCars!.weekday![0] = 99;
    copy.homeFloors![0] = 99;
    expect(src.activeCars!.weekday![0]).toBe(1); // source untouched
    expect(src.homeFloors![0]).toBe(1);
  });
});

describe("dispatch read accessors (Phase 2)", () => {
  const CARS8 = 8;

  describe("activeCarCount", () => {
    it("returns all cars for an absent schedule or absent day-type row", () => {
      expect(activeCarCount(undefined, false, 9, CARS8)).toBe(CARS8);
      expect(activeCarCount({}, false, 9, CARS8)).toBe(CARS8);
      expect(activeCarCount({ activeCars: { weekend: [0] } }, false, 9, CARS8)).toBe(CARS8); // weekday absent
    });

    it("reads the live day-type row at the given hour", () => {
      const s: ElevatorSchedule = {
        activeCars: {
          weekday: Array.from({ length: SCHEDULE_HOURS }, (_, h) => (h === 17 ? 6 : 2)),
          weekend: Array(SCHEDULE_HOURS).fill(1),
        },
      };
      expect(activeCarCount(s, false, 17, CARS8)).toBe(6); // weekday 5pm
      expect(activeCarCount(s, false, 3, CARS8)).toBe(2); // weekday off-peak
      expect(activeCarCount(s, true, 17, CARS8)).toBe(1); // weekend uses its own row
    });

    it("re-clamps to [0, cars] and treats a non-finite or missing hour as all cars", () => {
      const s: ElevatorSchedule = { activeCars: { weekday: [99, -4] } }; // out of range, short row
      expect(activeCarCount(s, false, 0, CARS8)).toBe(CARS8); // 99 clamps down to cars
      expect(activeCarCount(s, false, 1, CARS8)).toBe(0); // -4 clamps up to 0
      expect(activeCarCount(s, false, 9, CARS8)).toBe(CARS8); // past the short row: all cars
      // A shrunken fleet clamps a stored count that the load coercion never re-checked.
      expect(activeCarCount({ activeCars: { weekday: [6] } }, false, 0, 4)).toBe(4);
    });

    it("wraps an out-of-range hour into the 24-hour row", () => {
      const s: ElevatorSchedule = { activeCars: { weekday: Array.from({ length: SCHEDULE_HOURS }, (_, h) => h % 8) } };
      expect(activeCarCount(s, false, 24, CARS8)).toBe(activeCarCount(s, false, 0, CARS8));
      expect(activeCarCount(s, false, 25, CARS8)).toBe(activeCarCount(s, false, 1, CARS8));
    });
  });

  describe("homeFloorFor", () => {
    it("falls back to the derived idle floor when absent, short, or non-finite", () => {
      expect(homeFloorFor(undefined, 0, 3)).toBe(3);
      expect(homeFloorFor({}, 0, 3)).toBe(3);
      expect(homeFloorFor({ homeFloors: [10, 20] }, 5, 3)).toBe(3); // index past the list
    });
    it("returns the authored per-car home floor", () => {
      const s: ElevatorSchedule = { homeFloors: [1, 12, 30] };
      expect(homeFloorFor(s, 0, 3)).toBe(1);
      expect(homeFloorFor(s, 1, 3)).toBe(12);
      expect(homeFloorFor(s, 2, 3)).toBe(30);
    });
    it("rounds a fractional home floor so dispatch parks on a discrete floor", () => {
      expect(homeFloorFor({ homeFloors: [12.6] }, 0, 3)).toBe(13); // an un-coerced in-memory edit
    });
  });

  describe("dwellMinutesFor", () => {
    it("returns the passed default when unset", () => {
      expect(dwellMinutesFor(undefined, 0.8)).toBe(0.8);
      expect(dwellMinutesFor({}, 0.8)).toBe(0.8);
    });
    it("converts stored game-seconds to game-minutes, with the default anchor round-tripping", () => {
      expect(dwellMinutesFor({ standardFloorDeparture: DWELL_DEFAULT_SECONDS }, 0.8)).toBeCloseTo(0.8, 10);
      expect(dwellMinutesFor({ standardFloorDeparture: 30 }, 0.8)).toBeCloseTo(0.5, 10);
      expect(dwellMinutesFor({ standardFloorDeparture: 0 }, 0.8)).toBe(0); // a minimal hold, never negative
    });
    it("clamps a huge or negative in-memory hold to the sane range (never freezes a shaft)", () => {
      const maxMinutes = STANDARD_FLOOR_DEPARTURE_MAX / 60;
      expect(dwellMinutesFor({ standardFloorDeparture: 100_000 }, 0.8)).toBeCloseTo(maxMinutes, 10);
      expect(dwellMinutesFor({ standardFloorDeparture: -50 }, 0.8)).toBe(0);
    });
  });

  describe("waitingResponseFor", () => {
    it("is undefined when unset (dispatcher keeps its un-gated response)", () => {
      expect(waitingResponseFor(undefined)).toBeUndefined();
      expect(waitingResponseFor({})).toBeUndefined();
      expect(waitingResponseFor({ waitingCarResponse: Number.NaN })).toBeUndefined();
    });
    it("returns the non-negative floor threshold when set", () => {
      expect(waitingResponseFor({ waitingCarResponse: 5 })).toBe(5);
      expect(waitingResponseFor({ waitingCarResponse: 0 })).toBe(0);
    });
    it("rounds and clamps an in-memory value to [0, WAITING_CAR_RESPONSE_MAX]", () => {
      expect(waitingResponseFor({ waitingCarResponse: 999 })).toBe(WAITING_CAR_RESPONSE_MAX);
      expect(waitingResponseFor({ waitingCarResponse: 3.6 })).toBe(4);
      expect(waitingResponseFor({ waitingCarResponse: -2 })).toBe(0);
    });
  });
});
