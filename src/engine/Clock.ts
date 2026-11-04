import { REAL_WORLD, type Calendar } from "./calendar";

/**
 * Game clock. Tracks elapsed in-game minutes and exposes day/time helpers.
 *
 * SimTower runs distinct weekday/weekend behavior, a morning rush, a lunch peak
 * and an evening exodus. One in-game day is 24h in every mode; the length of a
 * week/quarter/year comes from the injected {@link Calendar} (canon 3/3/12 for
 * Classic, real-world 7/90/360 by default). See `src/engine/calendar.ts`.
 */
export class Clock {
  /** Total elapsed in-game minutes since the tower was founded. */
  minutes: number;

  /** The week/quarter/year model this clock reads. Defaults to real-world so a
   *  bare `new Clock()` (tests, tooling) keeps the shipped 7/90/360 behavior. */
  readonly calendar: Calendar;

  constructor(minutes = 0, calendar: Calendar = REAL_WORLD) {
    // Start the world at 07:00 on the first day so the morning rush is imminent.
    this.minutes = minutes === 0 ? 7 * 60 : minutes;
    this.calendar = calendar;
  }

  /** Minute within the current day, 0..1439. */
  get minuteOfDay(): number {
    return ((this.minutes % 1440) + 1440) % 1440;
  }

  get hour(): number {
    return Math.floor(this.minuteOfDay / 60);
  }

  get minute(): number {
    return Math.floor(this.minuteOfDay % 60);
  }

  /** Days elapsed (0-indexed). */
  get day(): number {
    return Math.floor(this.minutes / 1440);
  }

  /** Day-of-week index, 0-based within the calendar's week (real-world: 0=Mon..6=Sun). */
  get dayOfWeek(): number {
    return this.day % this.calendar.weekDays;
  }

  get isWeekend(): boolean {
    // The weekend is the trailing `weekendDays` slots of the week (real-world:
    // Sat+Sun of 7; canon: the last 1 of 3).
    return this.dayOfWeek >= this.calendar.weekDays - this.calendar.weekendDays;
  }

  /** Quarter index 0..3 used for office rent collection. */
  get quarter(): number {
    return Math.floor((this.day % this.calendar.yearDays) / this.calendar.quarterDays);
  }

  get dayName(): string {
    // Real-world keeps the familiar weekday names (a 7-day week). A compressed
    // calendar has no such names, and reusing Mon/Tue/Wed would label the canon
    // weekend slot "Wed" while `isWeekend`/`formatRetroDate` say WE; instead label
    // the weekday/weekend slots so every date surface agrees.
    if (this.calendar.weekDays === 7) {
      return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][this.dayOfWeek];
    }
    const dow = this.dayOfWeek;
    const weekdayCount = this.calendar.weekDays - this.calendar.weekendDays;
    return this.isWeekend ? `WE${dow - weekdayCount + 1}` : `WD${dow + 1}`;
  }

  /** Year index (0-based); a game "year" is `calendar.yearDays`, matching the quarters. */
  get year(): number {
    return Math.floor(this.day / this.calendar.yearDays);
  }

  /** Original-SimTower-style date stamp, e.g. "2nd WD/1Q/1st Year". The weekday
   *  slots read WD 1st.. and the weekend slots WE 1st.., derived from the
   *  calendar (real-world: 5 weekday + 2 weekend of 7; canon: 2 weekday + 1
   *  weekend of 3). */
  formatRetroDate(): string {
    const ord = (n: number): string => {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
    };
    const dow = this.dayOfWeek;
    const weekdayCount = this.calendar.weekDays - this.calendar.weekendDays;
    const slot = this.isWeekend ? `${ord(dow - weekdayCount + 1)} WE` : `${ord(dow + 1)} WD`;
    return `${slot}/${this.quarter + 1}Q/${ord(this.year + 1)} Year`;
  }

  /** Advance the clock by a number of minutes. */
  advance(min: number): void {
    this.minutes += min;
  }

  /** Formatted clock e.g. "Mon 07:00". */
  format(): string {
    const h = this.hour.toString().padStart(2, "0");
    const m = this.minute.toString().padStart(2, "0");
    return `${this.dayName} ${h}:${m}`;
  }

  /** True once per new day boundary crossing handled by Simulation. */
  isMorning(): boolean {
    return this.hour >= 7 && this.hour < 10;
  }

  isLunch(): boolean {
    return this.hour >= 11 && this.hour < 14;
  }

  isEvening(): boolean {
    return this.hour >= 17 && this.hour < 21;
  }

  isNight(): boolean {
    return this.hour >= 21 || this.hour < 6;
  }
}
