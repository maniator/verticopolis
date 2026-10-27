import type { HeaderView } from "./view";

/**
 * The clock reads the renderer makes (hour, minute, and the morning, evening
 * and night windows), derived from the header's `minutes` alone (facade
 * slice 3, #1210). The windows are the same ones `Clock` answers; the test
 * pins every minute of several days against `Clock`, so the two cannot drift.
 *
 * One instance is meant to be reused: `set` takes the header's minute and the
 * getters answer for it, so a frame reads the clock without allocating.
 */
export class ClockReads {
  /** The game clock in minutes since the start. */
  minutes = 0;

  /** Follow the header; returns this so a caller can chain a read. */
  set(h: Pick<HeaderView, "minutes">): this {
    this.minutes = h.minutes;
    return this;
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

  isMorning(): boolean {
    return this.hour >= 7 && this.hour < 10;
  }

  isEvening(): boolean {
    return this.hour >= 17 && this.hour < 21;
  }

  isNight(): boolean {
    return this.hour >= 21 || this.hour < 6;
  }
}
