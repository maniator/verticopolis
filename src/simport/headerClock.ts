import { Clock } from "../engine/Clock";
import { resolveCalendar } from "../engine/calendar";
import { makeRules, type GameRules } from "../engine/gameRules";
import type { HeaderView } from "./view";

/**
 * What a panel derives from the view's header instead of reading it off a
 * `Simulation` (facade slice 4, #1211): the clock's day, hour and names, and
 * the tower's rule set. Both are pure functions of fields the header carries
 * (`minutes`, `mode`, `modernCalendar`) and of static tables, so they answer
 * the same on every adapter.
 */

/** The clock's readings a panel shows. */
export type ClockView = Pick<
  Clock,
  "minutes" | "minuteOfDay" | "hour" | "minute" | "day" | "dayOfWeek" | "isWeekend" | "quarter" | "dayName" | "year" | "format" | "formatRetroDate"
>;

/** The clock at the header's minute, on the tower's calendar. */
export function clockOf(h: Pick<HeaderView, "minutes" | "mode" | "modernCalendar">): ClockView {
  const clock = new Clock(h.minutes, resolveCalendar(h.mode, h.modernCalendar));
  // The constructor reads 0 as "a new tower" and starts it at 07:00; the
  // header's minute is exact, so set it again.
  clock.minutes = h.minutes;
  return clock;
}

/** The tower's rule set (a static singleton per mode). */
export function rulesOf(h: Pick<HeaderView, "mode">): GameRules {
  return makeRules(h.mode);
}
