import { describe, expect, it } from "vitest";
import { Clock } from "../engine/Clock";
import type { RenderClock } from "../render/renderSim";
import { ClockReads } from "./clockView";

describe("ClockReads", () => {
  it("is a RenderClock", () => {
    const reads: RenderClock = new ClockReads();
    expect(reads.hour).toBe(0);
  });

  it("answers what Clock answers for every minute of several days", () => {
    const reads = new ClockReads();
    const clock = new Clock();
    for (let m = -2 * 1440; m < 4 * 1440; m++) {
      clock.minutes = m;
      reads.set({ minutes: m });
      expect(reads.minuteOfDay).toBe(clock.minuteOfDay);
      expect(reads.hour).toBe(clock.hour);
      expect(reads.minute).toBe(clock.minute);
      expect(reads.isMorning()).toBe(clock.isMorning());
      expect(reads.isEvening()).toBe(clock.isEvening());
      expect(reads.isNight()).toBe(clock.isNight());
    }
  });

  it("follows a later header without a new instance", () => {
    const reads = new ClockReads();
    expect(reads.set({ minutes: 7 * 60 }).isMorning()).toBe(true);
    expect(reads.set({ minutes: 22 * 60 }).isNight()).toBe(true);
    expect(reads.set({ minutes: 22 * 60 }).isMorning()).toBe(false);
  });
});
