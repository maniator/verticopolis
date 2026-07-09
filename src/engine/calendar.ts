import type { GameMode } from "./types";

/**
 * Calendar model: the lengths of a week, quarter and year, plus the weekend
 * rule and the maintenance period. It is the ONE place the two time systems
 * diverge.
 *
 * SimTower's real 1994 calendar is compressed: a year is 12 days, a quarter is
 * 3 days, and a week is also 3 days (2 weekday slots + 1 weekend). The day
 * counter rolls at 11,987 (999 years). This is validated against the retail
 * game's own Finance window and load screen (see `docs/canon/tdt-format.md` §3
 * and `gdd-classic-calendar-parity-2026-07-08`): e.g. `currentDay` 1280 reads as
 * "Year 107", which the game shows and our old 360-day calendar rendered as
 * "Year 4".
 *
 * Our long-standing calendar is the familiar real-world 7-day week / 90-day
 * quarter / 360-day year. Classic runs the canon calendar for parity; Modern
 * picks one at New Tower (see {@link resolveCalendar}).
 *
 * A "day" is 1440 minutes in EVERY calendar. Only these derived spans change;
 * {@link Clock.day}, `minutes`, the rush-hour windows and every `day + N` delta
 * timer are calendar-independent by design.
 */
export interface Calendar {
  readonly kind: CalendarKind;
  /** Days per week. Weekend = the trailing {@link weekendDays} slots. */
  readonly weekDays: number;
  /** How many trailing days of the week are the weekend. */
  readonly weekendDays: number;
  /** Days per quarter, the office-rent collection period. */
  readonly quarterDays: number;
  /** Days per year (= 4 quarters). */
  readonly yearDays: number;
  /**
   * Days between recurring maintenance charges. Canon has no calendar "month"
   * (a whole year is only 12 days), so maintenance rides the quarter; the
   * real-world calendar keeps the 30-day month it has always used.
   */
  readonly maintPeriodDays: number;
}

/** A calendar identity. Also the value persisted for a Modern tower's choice. */
export type CalendarKind = "canon" | "realWorld";

/**
 * The real 1994 SimTower calendar. Weekend is the LAST of the 3 day-slots
 * (WD, WD, WE), matching the canon "2 weekday + 1 weekend" week.
 *
 * NOTE (harness-validated 2026-07-08, backlog `classic-calendar-parity`): the
 * weekend *phase* relative to `currentDay` 0 was CONFIRMED against the retail
 * game via the Wine harness (see arch §5.1). Loading `my_tower.TDT` and reading
 * the game's date stamp at two independent points pinned the canon week as
 * `[1st WD, 2nd WD, WE]` with the weekend on the TRAILING slot
 * (`weekendDays: 1`, so `Clock.isWeekend` is `dayOfWeek === 2`). `weekendDays`
 * sets HOW MANY trailing slots are the weekend, not WHICH slot, so this model
 * can only express a trailing weekend (the natural shape of the canon
 * "2 weekday + 1 weekend" week). If a future retail-save observation ever shows
 * a NON-trailing weekend phase, the trailing model cannot represent it: that
 * needs an explicit weekend-phase offset added to the calendar + `Clock`
 * arithmetic, tracked as a contingent follow-up on the `classic-calendar-parity`
 * backlog row. Do not silently reinterpret the field.
 */
export const CANON: Calendar = {
  kind: "canon",
  weekDays: 3,
  weekendDays: 1,
  quarterDays: 3,
  yearDays: 12,
  maintPeriodDays: 3,
};

/**
 * Our real-world calendar: the shipped 7 / 90 / 360 behavior with a 30-day
 * maintenance month. This is the byte-identical "nothing changes" path, a
 * Modern tower left on the default, and every bare `new Clock()`, reads exactly
 * this. Do not fold these constants into {@link CANON}.
 */
export const REAL_WORLD: Calendar = {
  kind: "realWorld",
  weekDays: 7,
  weekendDays: 2,
  quarterDays: 90,
  yearDays: 360,
  maintPeriodDays: 30,
};

/** Coerce a persisted Modern calendar choice; anything unrecognized (including a
 *  missing field on an old save) reads as the safe default, real-world. */
export function coerceCalendarKind(raw: unknown): CalendarKind {
  return raw === "canon" ? "canon" : "realWorld";
}

/**
 * Resolve the calendar a tower runs on. Classic is ALWAYS canon (its whole point
 * is 1994 parity). Modern honors the player's New-Tower choice, defaulting to
 * real-world so a Modern player who never touches the toggle sees no change.
 */
export function resolveCalendar(mode: GameMode, modernCalendar: CalendarKind): Calendar {
  if (mode === "classic") return CANON;
  return modernCalendar === "canon" ? CANON : REAL_WORLD;
}
