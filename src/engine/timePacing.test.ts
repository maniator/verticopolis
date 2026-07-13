import { describe, it, expect } from "vitest";
import {
  DAY_START_MINUTE,
  FRAMES_PER_DAY,
  frameForMinuteOfDay,
  minuteOfDayForFrame,
  paceFactor,
} from "./timePacing";

/** Wrap-aware distance between two minutes-of-day. */
function minuteDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
}

/** The uniform-day baseline the factors are normalized against. */
const MEAN_MINUTES_PER_FRAME = 1440 / FRAMES_PER_DAY;

describe("minuteOfDayForFrame (canon table, tdt-format.md §3)", () => {
  it("maps every period boundary to its canon clock time", () => {
    expect(minuteOfDayForFrame(0)).toBe(7 * 60); // day starts 7:00
    expect(minuteOfDayForFrame(400)).toBe(12 * 60);
    expect(minuteOfDayForFrame(800)).toBe(12 * 60 + 30);
    expect(minuteOfDayForFrame(1200)).toBe(13 * 60);
    expect(minuteOfDayForFrame(1600)).toBe(17 * 60);
    expect(minuteOfDayForFrame(2000)).toBe(21 * 60);
    expect(minuteOfDayForFrame(2400)).toBe(1 * 60);
    expect(minuteOfDayForFrame(FRAMES_PER_DAY)).toBe(DAY_START_MINUTE); // wraps
  });

  it("hits midnight at frame 2300 — the original's date-change frame", () => {
    expect(minuteOfDayForFrame(2300)).toBe(0);
    expect(minuteOfDayForFrame(2299)).toBeGreaterThan(23 * 60); // still yesterday
  });

  it("advances monotonically through the whole day", () => {
    let prev = -1;
    for (let f = 0; f < FRAMES_PER_DAY; f++) {
      // Compare in the minutes-since-7:00 domain so midnight doesn't zigzag.
      const since = (minuteOfDayForFrame(f) - DAY_START_MINUTE + 1440) % 1440;
      expect(since).toBeGreaterThanOrEqual(prev);
      prev = since;
    }
  });

  it("wraps out-of-range frames instead of extrapolating", () => {
    expect(minuteOfDayForFrame(-1)).toBe(minuteOfDayForFrame(FRAMES_PER_DAY - 1));
    expect(minuteOfDayForFrame(FRAMES_PER_DAY + 400)).toBe(minuteOfDayForFrame(400));
  });

  it("falls back to the day start on non-finite input instead of propagating", () => {
    expect(minuteOfDayForFrame(NaN)).toBe(DAY_START_MINUTE);
    expect(minuteOfDayForFrame(Infinity)).toBe(DAY_START_MINUTE);
    expect(minuteOfDayForFrame(-Infinity)).toBe(DAY_START_MINUTE);
  });
});

describe("frameForMinuteOfDay (inverse mapping)", () => {
  it("maps the canon boundaries back to their frames", () => {
    expect(frameForMinuteOfDay(7 * 60)).toBe(0);
    expect(frameForMinuteOfDay(12 * 60)).toBe(400);
    expect(frameForMinuteOfDay(12 * 60 + 30)).toBe(800);
    expect(frameForMinuteOfDay(13 * 60)).toBe(1200);
    expect(frameForMinuteOfDay(21 * 60)).toBe(2000);
    expect(frameForMinuteOfDay(0)).toBe(2300); // midnight = date-change frame
    expect(frameForMinuteOfDay(1 * 60)).toBe(2400);
  });

  it("round-trips every minute of the day within flooring error", () => {
    // Both directions floor, so a round trip can drift by <1 frame plus
    // <1 minute — under 3 minutes even in the fastest (night) period.
    for (let m = 0; m < 1440; m++) {
      const back = minuteOfDayForFrame(frameForMinuteOfDay(m));
      expect(minuteDiff(back, m)).toBeLessThanOrEqual(3);
    }
  });

  it("stays in range for every minute", () => {
    for (let m = 0; m < 1440; m++) {
      const f = frameForMinuteOfDay(m);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(FRAMES_PER_DAY);
    }
  });

  it("falls back to frame 0 on non-finite input instead of propagating", () => {
    expect(frameForMinuteOfDay(NaN)).toBe(0);
    expect(frameForMinuteOfDay(Infinity)).toBe(0);
    expect(frameForMinuteOfDay(-Infinity)).toBe(0);
  });
});

describe("paceFactor (presentation pacing curve)", () => {
  it("matches the canon per-period rates relative to the uniform day", () => {
    // rate (minutes/frame) ÷ (1440/2600) — see tdt-format.md §3 span table.
    expect(paceFactor(8 * 60)).toBeCloseTo(0.75 / MEAN_MINUTES_PER_FRAME, 10); // morning
    expect(paceFactor(12 * 60 + 15)).toBeCloseTo(0.075 / MEAN_MINUTES_PER_FRAME, 10); // lunch
    expect(paceFactor(15 * 60)).toBeCloseTo(0.6 / MEAN_MINUTES_PER_FRAME, 10); // afternoon
    expect(paceFactor(3 * 60)).toBeCloseTo(1.8 / MEAN_MINUTES_PER_FRAME, 10); // night
  });

  it("makes the lunch crawl exactly 10× slower than the morning", () => {
    expect(paceFactor(8 * 60) / paceFactor(12 * 60 + 15)).toBeCloseTo(10, 10);
  });

  it("preserves the day's total real time (harmonic normalization)", () => {
    // Real time spent is ∫ 1/paceFactor over the day's minutes; the canon
    // normalization makes it 1,440 exactly in real arithmetic (float epsilon
    // in practice — hence toBeCloseTo, not toBe): the ×1/×2 speed buttons
    // keep meaning, the day just spends its time differently. The plain
    // average of the factors is deliberately NOT 1 — the invariant is
    // harmonic, so don't "fix" this by renormalizing the arithmetic mean.
    let realMinutes = 0;
    for (let m = 0; m < 1440; m++) realMinutes += 1 / paceFactor(m);
    expect(realMinutes).toBeCloseTo(1440, 6);
  });

  it("is strictly positive everywhere (a stalled clock is a bug)", () => {
    for (let m = 0; m < 1440; m++) {
      expect(paceFactor(m)).toBeGreaterThan(0);
    }
  });

  it("returns neutral pacing (1) on non-finite input", () => {
    expect(paceFactor(NaN)).toBe(1);
    expect(paceFactor(Infinity)).toBe(1);
    expect(paceFactor(-Infinity)).toBe(1);
  });
});
