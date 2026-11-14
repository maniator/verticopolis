import { describe, it, expect } from "vitest";
import {
  METRO_TRAIN_ARRIVED_AT,
  METRO_TRAIN_DEPARTS_AT,
  METRO_TRAIN_GONE_AT,
  metroLineTimes,
  metroTrainAt,
  metroTrainOffset,
} from "./metroTrainSchedule";

const SPAN = 100;
const at = (hour: number, minute: number, night = false): number => metroTrainOffset(hour * 60 + minute, SPAN, night);

describe("metroTrainOffset", () => {
  it("slides in from the left tunnel, waits, then leaves to the right", () => {
    expect(at(12, 0)).toBe(-SPAN);
    expect(at(12, METRO_TRAIN_ARRIVED_AT / 2)).toBeCloseTo(-SPAN / 2, 6);
    expect(at(12, METRO_TRAIN_ARRIVED_AT)).toBe(0);
    expect(at(12, METRO_TRAIN_DEPARTS_AT - 1)).toBe(0);
    expect(at(12, METRO_TRAIN_DEPARTS_AT)).toBe(0);
    expect(at(12, (METRO_TRAIN_DEPARTS_AT + METRO_TRAIN_GONE_AT) / 2)).toBeCloseTo(SPAN / 2, 6);
  });

  it("is out of sight for the rest of the hour", () => {
    expect(Math.abs(at(12, METRO_TRAIN_GONE_AT))).toBe(SPAN);
    expect(Math.abs(at(12, 45))).toBe(SPAN);
    expect(Math.abs(at(12, 59))).toBe(SPAN);
  });

  it("calls once every daytime hour, the same way each time", () => {
    for (let hour = 6; hour < 21; hour++) {
      const present = Array.from({ length: 60 }, (_, m) => at(hour, m)).filter((x) => Math.abs(x) < SPAN);
      expect(present.length).toBe(METRO_TRAIN_GONE_AT - 1);
      expect(at(hour, 10)).toBe(0);
    }
  });

  it("runs no trains at night", () => {
    for (const hour of [21, 23, 0, 3, 5]) {
      for (let m = 0; m < 60; m += 5) expect(at(hour, m, true)).toBe(-SPAN);
    }
  });
});

describe("metroTrainAt: one train along a line of stations", () => {
  const LINE = [0, 400, 900];
  const where = (minute: number, line: readonly number[] = LINE): number => metroTrainAt(12 * 60 + minute, line, SPAN, false);
  /** The stations the train stands in (overlaps) at `minute`. */
  const calling = (minute: number, line: readonly number[] = LINE): number[] =>
    line.flatMap((x, i) => (Math.abs(where(minute, line) - x) < SPAN ? [i] : []));

  it("is metroTrainOffset for a single station", () => {
    for (let m = 0; m < 60; m++) {
      expect(metroTrainAt(12 * 60 + m, [250], SPAN, false)).toBeCloseTo(250 + metroTrainOffset(12 * 60 + m, SPAN, false), 9);
    }
    expect(metroTrainAt(2 * 60, [250], SPAN, true)).toBe(250 - SPAN);
  });

  it("calls at each station in turn, left to right, and leaves out the right tunnel", () => {
    const { leg, dwell } = metroLineTimes(LINE.length);
    expect(where(0)).toBe(-SPAN);
    let t = leg;
    for (const x of LINE) {
      expect(where(t)).toBe(x);
      expect(where(t + dwell - 0.5)).toBe(x);
      t += dwell + leg;
    }
    expect(where(t - leg / 2)).toBeCloseTo(LINE[2] + SPAN / 2, 6);
    expect(t).toBeLessThanOrEqual(60);
    expect(where(59)).toBe(-SPAN);
  });

  it("never has the train at two stations apart from each other at once", () => {
    for (let m = 0; m < 60; m += 0.25) expect(calling(m).length).toBeLessThanOrEqual(1);
    // It does stand at every station during the hour.
    const seen = new Set<number>();
    for (let m = 0; m < 60; m += 0.25) for (const i of calling(m)) seen.add(i);
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("keeps the run inside the hour however many stations a save holds", () => {
    for (const n of [1, 2, 3, 6, 12]) {
      const { leg, dwell } = metroLineTimes(n);
      expect(leg * (n + 1) + dwell * n).toBeLessThanOrEqual(60);
      expect(dwell).toBeGreaterThan(0);
    }
    expect(metroLineTimes(1)).toEqual({ leg: METRO_TRAIN_ARRIVED_AT, dwell: METRO_TRAIN_DEPARTS_AT - METRO_TRAIN_ARRIVED_AT });
    // Asked every frame, so the same answer comes back without a new object.
    expect(metroLineTimes(3)).toBe(metroLineTimes(3));
  });

  it("waits in the left tunnel overnight", () => {
    expect(metroTrainAt(23 * 60 + 10, LINE, SPAN, true)).toBe(-SPAN);
  });
});
