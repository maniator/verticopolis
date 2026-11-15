import { describe, it, expect } from "vitest";
import type { CatalogMetroTrain } from "../catalog/catalogTypes";
import { metroLineTimes, metroTrainAt } from "./metroTrainSchedule";

/** The catalog's `world.metroTrain` as the engine publishes it, the canned
 *  answer these pure functions read. */
const TIMETABLE: CatalogMetroTrain = { firstHour: 6, lastHour: 20, legMinutes: 6, dwellMinutes: 14, runMinutes: 54 };
const SPAN = 100;

describe("metroTrainAt: one station", () => {
  const at = (hour: number, minute: number): number => metroTrainAt(hour * 60 + minute, [0], SPAN, TIMETABLE);

  it("slides in from the left tunnel, waits, then leaves to the right", () => {
    expect(at(12, 0)).toBe(-SPAN);
    expect(at(12, 3)).toBeCloseTo(-SPAN / 2, 6);
    expect(at(12, 6)).toBe(0);
    expect(at(12, 19.5)).toBe(0);
    expect(at(12, 23)).toBeCloseTo(SPAN / 2, 6);
  });

  it("is out of sight for the rest of the hour", () => {
    expect(Math.abs(at(12, 26))).toBe(SPAN);
    expect(Math.abs(at(12, 45))).toBe(SPAN);
    expect(Math.abs(at(12, 59))).toBe(SPAN);
  });

  it("calls once every hour of the timetable, the same way each time", () => {
    for (let hour = TIMETABLE.firstHour; hour <= TIMETABLE.lastHour; hour++) {
      const present = Array.from({ length: 60 }, (_, m) => at(hour, m)).filter((x) => Math.abs(x) < SPAN);
      expect(present.length).toBe(25);
      expect(at(hour, 10)).toBe(0);
    }
  });

  it("runs no trains outside the timetable's hours", () => {
    for (const hour of [21, 23, 0, 3, 5]) {
      for (let m = 0; m < 60; m += 5) expect(at(hour, m)).toBe(-SPAN);
    }
  });

  it("follows the timetable it is given", () => {
    const late: CatalogMetroTrain = { ...TIMETABLE, firstHour: 8, legMinutes: 4, dwellMinutes: 10 };
    expect(metroTrainAt(7 * 60 + 10, [0], SPAN, late)).toBe(-SPAN);
    expect(metroTrainAt(8 * 60 + 4, [0], SPAN, late)).toBe(0);
    expect(metroTrainAt(8 * 60 + 16, [0], SPAN, late)).toBeCloseTo(SPAN / 2, 6);
  });
});

describe("metroTrainAt: one train along a line of stations", () => {
  const LINE = [0, 400, 900];
  const where = (minute: number, line: readonly number[] = LINE): number => metroTrainAt(12 * 60 + minute, line, SPAN, TIMETABLE);
  /** The stations the train stands in (overlaps) at `minute`. */
  const calling = (minute: number, line: readonly number[] = LINE): number[] =>
    line.flatMap((x, i) => (Math.abs(where(minute, line) - x) < SPAN ? [i] : []));

  it("calls at each station in turn, left to right, and leaves out the right tunnel", () => {
    const { leg, dwell } = metroLineTimes(TIMETABLE, LINE.length);
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
      const { leg, dwell } = metroLineTimes(TIMETABLE, n);
      expect(leg * (n + 1) + dwell * n).toBeLessThanOrEqual(60);
      expect(dwell).toBeGreaterThan(0);
    }
    expect(metroLineTimes(TIMETABLE, 1)).toEqual({ leg: 6, dwell: 14 });
    expect(metroLineTimes(TIMETABLE, 3)).toEqual({ leg: 6, dwell: 10 });
    // Asked every frame, so the same answer comes back without a new object.
    expect(metroLineTimes(TIMETABLE, 3)).toBe(metroLineTimes(TIMETABLE, 3));
  });

  it("waits in the left tunnel overnight", () => {
    expect(metroTrainAt(23 * 60 + 10, LINE, SPAN, TIMETABLE)).toBe(-SPAN);
  });
});
