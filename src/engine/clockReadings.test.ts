import { describe, it, expect } from "vitest";
import { Clock } from "./Clock";
import { CANON, REAL_WORLD, type Calendar } from "./calendar";

/**
 * The date arithmetic the web reads, pinned to the engine's. The Rust test
 * `readings_match_the_web_table` in `engine-rs/src/clock.rs` holds the same
 * rows. Keep the two tables identical.
 */
interface Row {
  readonly name: string;
  readonly calendar: Calendar;
  readonly minutes: number;
  readonly day: number;
  readonly dayOfWeek: number;
  readonly isWeekend: boolean;
  readonly quarter: number;
  readonly year: number;
  readonly hour: number;
  readonly minute: number;
}

const ROWS: readonly Row[] = [
  { name: "canon, tower founded", calendar: CANON, minutes: 420, day: 0, dayOfWeek: 0, isWeekend: false, quarter: 0, year: 0, hour: 7, minute: 0 },
  { name: "canon, weekend slot", calendar: CANON, minutes: 3665, day: 2, dayOfWeek: 2, isWeekend: true, quarter: 0, year: 0, hour: 13, minute: 5 },
  { name: "canon, second quarter", calendar: CANON, minutes: 4380, day: 3, dayOfWeek: 0, isWeekend: false, quarter: 1, year: 0, hour: 1, minute: 0 },
  { name: "canon, year rollover", calendar: CANON, minutes: 17880, day: 12, dayOfWeek: 0, isWeekend: false, quarter: 0, year: 1, hour: 10, minute: 0 },
  { name: "canon, last day of the year", calendar: CANON, minutes: 17220, day: 11, dayOfWeek: 2, isWeekend: true, quarter: 3, year: 0, hour: 23, minute: 0 },
  { name: "real world, tower founded", calendar: REAL_WORLD, minutes: 420, day: 0, dayOfWeek: 0, isWeekend: false, quarter: 0, year: 0, hour: 7, minute: 0 },
  { name: "real world, first Saturday", calendar: REAL_WORLD, minutes: 7710, day: 5, dayOfWeek: 5, isWeekend: true, quarter: 0, year: 0, hour: 8, minute: 30 },
  { name: "real world, second quarter", calendar: REAL_WORLD, minutes: 129660, day: 90, dayOfWeek: 6, isWeekend: true, quarter: 1, year: 0, hour: 1, minute: 0 },
  { name: "real world, year rollover", calendar: REAL_WORLD, minutes: 519120, day: 360, dayOfWeek: 3, isWeekend: false, quarter: 0, year: 1, hour: 12, minute: 0 },
];

describe("Clock readings match the engine's", () => {
  it.each(ROWS)("$name", (row) => {
    const clock = new Clock(row.minutes, row.calendar);
    expect(clock.day).toBe(row.day);
    expect(clock.dayOfWeek).toBe(row.dayOfWeek);
    expect(clock.isWeekend).toBe(row.isWeekend);
    expect(clock.quarter).toBe(row.quarter);
    expect(clock.year).toBe(row.year);
    expect(clock.hour).toBe(row.hour);
    expect(clock.minute).toBe(row.minute);
  });

  it("holds the same calendar spans as the engine", () => {
    expect([CANON.weekDays, CANON.weekendDays, CANON.quarterDays, CANON.yearDays, CANON.maintPeriodDays]).toEqual([3, 1, 3, 12, 3]);
    expect([REAL_WORLD.weekDays, REAL_WORLD.weekendDays, REAL_WORLD.quarterDays, REAL_WORLD.yearDays, REAL_WORLD.maintPeriodDays]).toEqual([7, 2, 90, 360, 30]);
  });
});
