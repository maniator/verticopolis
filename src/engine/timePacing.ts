/**
 * The 1994 original's variable time pacing — the "breathing clock".
 *
 * The original runs a day as 2,600 frames starting at 7:00 AM, and the number
 * of frames it spends per in-game hour varies wildly by period: the noon hour
 * gets as many frames as the whole 7:00–12:00 morning (the clock crawls ~10×
 * while the lunch crowds swarm), and the 1:00–7:00 night gets only 200 (the
 * small hours flash past). Midnight lands exactly on frame 2300 — the frame
 * the original changes the date. See docs/canon/tdt-format.md §3, including
 * why rates are derived from the period SPANS (the upstream per-frame second
 * values are internally inconsistent on the night row).
 *
 * This module is pure presentation math. The simulation keeps its uniform
 * 1,440-minute day; {@link paceFactor} is a multiplier for how fast REAL time
 * feeds sim-minutes to the main loop, normalized so a full day takes exactly
 * as long as it does today — the ×1/×2 speed buttons keep their meaning, the
 * day just spends its real time differently. Nothing here is serialized.
 */

/** Frames in one original-game day. */
export const FRAMES_PER_DAY = 2600;

/** Minute-of-day the original's frame 0 falls on (the 7:00 AM day start). */
export const DAY_START_MINUTE = 7 * 60;

/**
 * The canon pacing periods, in the frame domain and the "minutes since 7:00"
 * domain. Rates are span-derived (canon anchor: minute 1020 since start =
 * midnight = frame 2300).
 */
const PERIODS: readonly { frameEnd: number; minuteEnd: number }[] = [
  { frameEnd: 400, minuteEnd: 300 }, //  7:00–12:00
  { frameEnd: 800, minuteEnd: 330 }, // 12:00–12:30 — the lunch crawl
  { frameEnd: 1200, minuteEnd: 360 }, // 12:30–13:00
  { frameEnd: 1600, minuteEnd: 600 }, // 13:00–17:00
  { frameEnd: 2000, minuteEnd: 840 }, // 17:00–21:00
  { frameEnd: 2400, minuteEnd: 1080 }, // 21:00– 1:00 (midnight = frame 2300)
  { frameEnd: 2600, minuteEnd: 1440 }, //  1:00– 7:00 — the night sprint
];

/** Wrap any finite number into [0, span). */
function wrap(v: number, span: number): number {
  return ((v % span) + span) % span;
}

/**
 * The in-game minute of day (0..1439) the original shows at a given frame of
 * its 2,600-frame day. Frames outside [0, 2600) wrap.
 */
export function minuteOfDayForFrame(frame: number): number {
  const f = wrap(frame, FRAMES_PER_DAY);
  let frameStart = 0;
  let minuteStart = 0;
  for (const p of PERIODS) {
    if (f < p.frameEnd) {
      const rate = (p.minuteEnd - minuteStart) / (p.frameEnd - frameStart);
      const sinceDayStart = minuteStart + (f - frameStart) * rate;
      return Math.floor(wrap(DAY_START_MINUTE + sinceDayStart, 24 * 60));
    }
    frameStart = p.frameEnd;
    minuteStart = p.minuteEnd;
  }
  /* istanbul ignore next -- unreachable: wrap() keeps f < FRAMES_PER_DAY */
  return DAY_START_MINUTE;
}

/**
 * The frame of the original's day (0..2599) at a given minute of day
 * (0..1439). Inverse of {@link minuteOfDayForFrame} up to flooring.
 * Canon tripwire: `frameForMinuteOfDay(0) === 2300` — midnight is the
 * original's date-change frame.
 */
export function frameForMinuteOfDay(minuteOfDay: number): number {
  const m = wrap(minuteOfDay - DAY_START_MINUTE, 24 * 60); // minutes since 7:00
  let frameStart = 0;
  let minuteStart = 0;
  for (const p of PERIODS) {
    if (m < p.minuteEnd) {
      const rate = (p.minuteEnd - minuteStart) / (p.frameEnd - frameStart);
      return Math.floor(frameStart + (m - minuteStart) / rate);
    }
    frameStart = p.frameEnd;
    minuteStart = p.minuteEnd;
  }
  /* istanbul ignore next -- unreachable: wrap() keeps m < 1440 */
  return 0;
}

/**
 * How fast sim-minutes should accumulate per unit of real time at the given
 * minute of day, relative to today's uniform pacing (1.0 everywhere).
 *
 * In the original, frames tick at a constant real-time rate, so a period's
 * pace is proportional to its minutes-per-frame; normalizing by the whole
 * day's average (1440 min / 2600 frames) makes the factors mean out to a
 * bit-exact full day: ∫ 1/paceFactor over the 1,440 minutes = 1,440, so a
 * day takes precisely as much real time as it does with uniform pacing —
 * only its distribution changes (≈1.35× through the morning, ≈0.14× through
 * the lunch crawl, ≈3.25× through the night).
 */
export function paceFactor(minuteOfDay: number): number {
  const m = wrap(minuteOfDay - DAY_START_MINUTE, 24 * 60);
  let frameStart = 0;
  let minuteStart = 0;
  for (const p of PERIODS) {
    if (m < p.minuteEnd) {
      const rate = (p.minuteEnd - minuteStart) / (p.frameEnd - frameStart);
      return rate / ((24 * 60) / FRAMES_PER_DAY);
    }
    frameStart = p.frameEnd;
    minuteStart = p.minuteEnd;
  }
  /* istanbul ignore next -- unreachable: wrap() keeps m < 1440 */
  return 1;
}
