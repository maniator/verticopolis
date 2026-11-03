import { dayName, formatClock, formatRetroDate } from "../presentation/clockText";
import { makeRules, type GameRules } from "../engine/gameRules";
import { ClockReads } from "./clockView";
import type { HeaderView } from "./view";

/**
 * What a panel derives from the view's header instead of reading it off a
 * `Simulation` (facade slice 4, #1211): the clock's day, hour and names, and
 * the tower's rule set. The engine reports the date numbers in the header
 * (day, day of the week, weekend flag, quarter, year, the calendar's week
 * lengths); the names come from `presentation/clockText.ts`.
 */

/** The fields of the header a clock reading needs. */
export type ClockHeader = Pick<
  HeaderView,
  "minutes" | "day" | "dayOfWeek" | "isWeekend" | "quarter" | "year" | "weekDays" | "weekendDays"
>;

/** The clock's readings a panel shows. */
export interface ClockView {
  readonly minutes: number;
  readonly minuteOfDay: number;
  readonly hour: number;
  readonly minute: number;
  readonly day: number;
  readonly dayOfWeek: number;
  readonly isWeekend: boolean;
  readonly quarter: number;
  readonly year: number;
  readonly dayName: string;
  isMorning(): boolean;
  isEvening(): boolean;
  isNight(): boolean;
  format(): string;
  formatRetroDate(): string;
}

/** The clock at the header's minute, on the tower's calendar. */
export function clockOf(h: ClockHeader): ClockView {
  const time = new ClockReads().set(h);
  return {
    minutes: h.minutes,
    minuteOfDay: time.minuteOfDay,
    hour: time.hour,
    minute: time.minute,
    day: h.day,
    dayOfWeek: h.dayOfWeek,
    isWeekend: h.isWeekend,
    quarter: h.quarter,
    year: h.year,
    get dayName() {
      return dayName(h);
    },
    isMorning: () => time.isMorning(),
    isEvening: () => time.isEvening(),
    isNight: () => time.isNight(),
    format: () => formatClock(h, time.hour, time.minute),
    formatRetroDate: () => formatRetroDate(h),
  };
}

/** The tower's calendar lengths, as the engine reports them. */
export function calendarOf(h: Pick<HeaderView, "weekDays" | "weekendDays">): Pick<HeaderView, "weekDays" | "weekendDays"> {
  return h;
}

/** The tower's rule set (a static singleton per mode). */
export function rulesOf(h: Pick<HeaderView, "mode">): GameRules {
  return makeRules(h.mode);
}
