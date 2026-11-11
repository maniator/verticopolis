import { describe, expect, it } from "vitest";
import type { RenderClock } from "../render/renderSim";
import { ClockReads } from "./clockView";

/** The clock windows as the engine defines them: morning 07:00 to 09:59,
 *  evening 17:00 to 20:59, night 21:00 to 05:59. */
function expected(minutes: number) {
  const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(minuteOfDay / 60);
  return {
    minuteOfDay,
    hour,
    minute: Math.floor(minuteOfDay % 60),
    morning: hour >= 7 && hour < 10,
    evening: hour >= 17 && hour < 21,
    night: hour >= 21 || hour < 6,
  };
}

function readsOf(reads: ClockReads) {
  return {
    minuteOfDay: reads.minuteOfDay,
    hour: reads.hour,
    minute: reads.minute,
    morning: reads.isMorning(),
    evening: reads.isEvening(),
    night: reads.isNight(),
  };
}

describe("ClockReads", () => {
  it("is a RenderClock", () => {
    const reads: RenderClock = new ClockReads();
    expect(reads.hour).toBe(0);
  });

  it("pins the window edges", () => {
    const reads = new ClockReads();
    const at = (h: number, m: number) => readsOf(reads.set({ minutes: 1440 + h * 60 + m }));
    expect([at(6, 59).morning, at(7, 0).morning, at(9, 59).morning, at(10, 0).morning]).toEqual([false, true, true, false]);
    expect([at(16, 59).evening, at(17, 0).evening, at(20, 59).evening, at(21, 0).evening]).toEqual([false, true, true, false]);
    expect([at(20, 59).night, at(21, 0).night, at(5, 59).night, at(6, 0).night]).toEqual([false, true, true, false]);
    expect(readsOf(reads.set({ minutes: -1 }))).toEqual({ minuteOfDay: 1439, hour: 23, minute: 59, morning: false, evening: false, night: true });
  });

  it("answers the engine's windows for every minute of several days", () => {
    const reads = new ClockReads();
    for (let m = -2 * 1440; m < 4 * 1440; m++) expect(readsOf(reads.set({ minutes: m })), `minute ${m}`).toEqual(expected(m));
  });

  it("answers the same windows for fractional minutes", () => {
    const reads = new ClockReads();
    for (let m = -1440; m < 2 * 1440; m += 7) {
      for (const frac of [0.5, 59.999 / 60]) expect(readsOf(reads.set({ minutes: m + frac })), `minute ${m + frac}`).toEqual(expected(m + frac));
    }
    expect(readsOf(reads.set({ minutes: 600.5 }))).toMatchObject({ minuteOfDay: 600.5, hour: 10, minute: 0 });
  });

  it("follows a later header without a new instance", () => {
    const reads = new ClockReads();
    expect(reads.set({ minutes: 7 * 60 }).isMorning()).toBe(true);
    expect(reads.set({ minutes: 22 * 60 }).isNight()).toBe(true);
    expect(reads.set({ minutes: 22 * 60 }).isMorning()).toBe(false);
  });
});
