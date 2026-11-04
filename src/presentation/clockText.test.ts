import { describe, expect, it } from "vitest";
import { dayName, formatClock, formatRetroDate, type DateReading } from "./clockText";

const REAL_WORLD = { weekDays: 7, weekendDays: 2 };
const CANON = { weekDays: 3, weekendDays: 1 };

const at = (calendar: { weekDays: number; weekendDays: number }, dayOfWeek: number, quarter = 0, year = 0): DateReading => ({
  ...calendar,
  dayOfWeek,
  isWeekend: dayOfWeek >= calendar.weekDays - calendar.weekendDays,
  quarter,
  year,
});

describe("clock text", () => {
  it("names the days of a seven-day week", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => dayName(at(REAL_WORLD, d)))).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("names the slots of the canon week by weekday and weekend, never Mon/Tue/Wed", () => {
    expect([0, 1, 2].map((d) => dayName(at(CANON, d)))).toEqual(["WD1", "WD2", "WE1"]);
  });

  it("writes the time after the day name", () => {
    expect(formatClock(at(REAL_WORLD, 0), 7, 0)).toBe("Mon 07:00");
    expect(formatClock(at(CANON, 2), 23, 5)).toBe("WE1 23:05");
  });

  it("writes the original game's date stamp", () => {
    expect(formatRetroDate(at(CANON, 1))).toBe("2nd WD/1Q/1st Year");
    expect(formatRetroDate(at(CANON, 2, 3, 106))).toBe("1st WE/4Q/107th Year");
    expect(formatRetroDate(at(REAL_WORLD, 5, 1, 1))).toBe("1st WE/2Q/2nd Year");
    expect(formatRetroDate(at(REAL_WORLD, 4, 0, 10))).toBe("5th WD/1Q/11th Year");
    expect(formatRetroDate(at(CANON, 0, 0, 111))).toBe("1st WD/1Q/112th Year");
  });
});
