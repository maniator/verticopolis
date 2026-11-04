/**
 * The words for a date. The engine reports the numbers (day of the week,
 * weekend flag, quarter, year, the calendar's week and weekend lengths); this
 * file only turns them into the names the header strip and the stats panel
 * show. It does no date arithmetic.
 */

/** What the engine reports about one moment of the game clock. */
export interface DateReading {
  /** 0-based day of the week on the tower's calendar. */
  readonly dayOfWeek: number;
  readonly isWeekend: boolean;
  /** 0-based quarter and year. */
  readonly quarter: number;
  readonly year: number;
  /** The calendar's week and weekend lengths in days. */
  readonly weekDays: number;
  readonly weekendDays: number;
}

/** A week this long has the familiar weekday names. */
const NAMED_WEEK_DAYS = 7;
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * "Mon" on the seven-day week. The compressed canon week has no such names, and
 * reusing Mon/Tue/Wed would label its weekend slot "Wed" while the retro date
 * says WE, so it reads "WD1", "WD2", "WE1": the weekday slots, then the weekend ones.
 */
export function dayName(d: Pick<DateReading, "dayOfWeek" | "isWeekend" | "weekDays" | "weekendDays">): string {
  if (d.weekDays === NAMED_WEEK_DAYS) return WEEKDAY_NAMES[d.dayOfWeek];
  const weekdayCount = d.weekDays - d.weekendDays;
  return d.isWeekend ? `WE${d.dayOfWeek - weekdayCount + 1}` : `WD${d.dayOfWeek + 1}`;
}

/** "Mon 07:00". */
export function formatClock(d: Parameters<typeof dayName>[0], hour: number, minute: number): string {
  return `${dayName(d)} ${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

const ordinal = (n: number): string => {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]);
};

/** The original game's date stamp, e.g. "2nd WD/1Q/1st Year". */
export function formatRetroDate(d: DateReading): string {
  const weekdayCount = d.weekDays - d.weekendDays;
  const slot = d.isWeekend ? `${ordinal(d.dayOfWeek - weekdayCount + 1)} WE` : `${ordinal(d.dayOfWeek + 1)} WD`;
  return `${slot}/${d.quarter + 1}Q/${ordinal(d.year + 1)} Year`;
}
