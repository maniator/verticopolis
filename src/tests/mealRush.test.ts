import { describe, it, expect } from "vitest";
import { decideMealRush } from "../game/mealRush";

/**
 * Guards the "Breakfast/Lunch/Dinner rush!" bulletin decision logic against
 * the edge cases the shipped lunch-rush code has always covered plus the two
 * new meals: NaN clock (upstream-guarded before this fn is called), huge-frame
 * catch-up that leaps across the hour boundary, weekend skip for workday
 * meals only, and the once-per-day latch.
 *
 * Real-world calendar is used throughout: weekDays 7, weekendDays 2.
 * Day-of-week convention: `dayOfKind % 7 >= 5` counts as weekend, which for
 * the shipped Clock at start-of-tower minute 420 puts Saturday at day 6 and
 * Sunday at day 7 (both weekend).
 */
const REAL_WORLD = { weekDays: 7, weekendDays: 2 };
const NEVER_FIRED = -1;

describe("decideMealRush: cadence + once-per-day latch", () => {
  it("lunch fires when the frame crosses noon and the latch is fresh", () => {
    // Day 1: `before` sits at 11:00 (day1 minute 660 + 420 start offset), `after`
    // is 13:00 (day1 minute 780 + 420). The first noon strictly after `before`
    // is day 1 12:00 (absolute minute 12 * 60 = 720 within day 1 = 720 + 1440*0
    // referenced from day 0 07:00 start). Using the shipped algebra directly.
    const before = 11 * 60; // 11:00 on day 0
    const after = 13 * 60; // 13:00 on day 0
    const r = decideMealRush({
      ...REAL_WORLD, hour: 12, skipWeekend: false, before, after, lastFiredDay: NEVER_FIRED,
    });
    expect(r.fire).toBe(true);
    expect(r.dayOfKind).toBe(0);
  });

  it("does not fire when the frame hasn't reached the hour boundary yet", () => {
    // Frame 11:00 to 11:59: noon hasn't been crossed.
    const r = decideMealRush({
      ...REAL_WORLD, hour: 12, skipWeekend: false,
      before: 11 * 60, after: 11 * 60 + 59, lastFiredDay: NEVER_FIRED,
    });
    expect(r.fire).toBe(false);
  });

  it("does not fire twice on the same day", () => {
    // First fire at noon; second call in the same day is silent.
    const first = decideMealRush({
      ...REAL_WORLD, hour: 12, skipWeekend: false,
      before: 11 * 60, after: 13 * 60, lastFiredDay: NEVER_FIRED,
    });
    expect(first.fire).toBe(true);
    const second = decideMealRush({
      ...REAL_WORLD, hour: 12, skipWeekend: false,
      before: 14 * 60, after: 15 * 60, lastFiredDay: first.dayOfKind,
    });
    expect(second.fire).toBe(false);
  });

  it("fires again the next day (latch does not persist across days)", () => {
    const day1 = decideMealRush({
      ...REAL_WORLD, hour: 12, skipWeekend: false,
      before: 11 * 60, after: 13 * 60, lastFiredDay: NEVER_FIRED,
    });
    // Frame on day 2 (24 hours later) crossing noon.
    const day2 = decideMealRush({
      ...REAL_WORLD, hour: 12, skipWeekend: false,
      before: 24 * 60 + 11 * 60, after: 24 * 60 + 13 * 60,
      lastFiredDay: day1.dayOfKind,
    });
    expect(day2.fire).toBe(true);
    expect(day2.dayOfKind).toBe(day1.dayOfKind + 1);
  });
});

describe("decideMealRush: huge-frame catch-up crosses multiple meal boundaries", () => {
  it("a single frame that leaps across noon AND 18:00 lets both bulletins fire", () => {
    // Frame from 09:00 to 20:00 on day 0. Both meal hours 12 and 18 fall in it.
    // Two independent decisions with per-kind latches: lunch fires, then dinner
    // fires on the SAME frame using its own fresh latch.
    const before = 9 * 60;
    const after = 20 * 60;
    const lunch = decideMealRush({
      ...REAL_WORLD, hour: 12, skipWeekend: false, before, after, lastFiredDay: NEVER_FIRED,
    });
    const dinner = decideMealRush({
      ...REAL_WORLD, hour: 18, skipWeekend: false, before, after, lastFiredDay: NEVER_FIRED,
    });
    expect(lunch.fire).toBe(true);
    expect(dinner.fire).toBe(true);
  });
});

describe("decideMealRush: weekend skip fires only for skipWeekend=true meals", () => {
  it("lunch (skipWeekend) is silent on Saturday (day 5 under weekDays 7)", () => {
    // dayOfKind = 5 (Saturday). weekDays 7 - weekendDays 2 = 5; 5 >= 5 is true.
    // 24*60*5 = 7200. Frame from 11:00 on Saturday to 13:00 on Saturday.
    const dayStart = 5 * 24 * 60;
    const r = decideMealRush({
      ...REAL_WORLD, hour: 12, skipWeekend: true,
      before: dayStart + 11 * 60, after: dayStart + 13 * 60, lastFiredDay: NEVER_FIRED,
    });
    expect(r.fire).toBe(false);
  });

  it("breakfast (NOT skipWeekend) still fires on Saturday", () => {
    const dayStart = 5 * 24 * 60;
    const r = decideMealRush({
      ...REAL_WORLD, hour: 7, skipWeekend: false,
      before: dayStart + 6 * 60, after: dayStart + 8 * 60, lastFiredDay: NEVER_FIRED,
    });
    expect(r.fire).toBe(true);
  });

  it("dinner (skipWeekend) is silent on Sunday (day 6 under weekDays 7)", () => {
    const dayStart = 6 * 24 * 60;
    const r = decideMealRush({
      ...REAL_WORLD, hour: 18, skipWeekend: true,
      before: dayStart + 17 * 60, after: dayStart + 19 * 60, lastFiredDay: NEVER_FIRED,
    });
    expect(r.fire).toBe(false);
  });

  it("weekday lunch fires (control)", () => {
    // Day 2 (weekday under weekDays 7, dayOfKind % 7 = 2 < 5).
    const dayStart = 2 * 24 * 60;
    const r = decideMealRush({
      ...REAL_WORLD, hour: 12, skipWeekend: true,
      before: dayStart + 11 * 60, after: dayStart + 13 * 60, lastFiredDay: NEVER_FIRED,
    });
    expect(r.fire).toBe(true);
  });
});

describe("decideMealRush: canon calendar (3-day week, weekend = trailing slot)", () => {
  // Canon: weekDays 3, weekendDays 1. Day 2 is weekend, days 0 and 1 are weekday.
  it("lunch fires on canon weekdays (day 0, day 1)", () => {
    for (const day of [0, 1]) {
      const dayStart = day * 24 * 60;
      const r = decideMealRush({
        weekDays: 3, weekendDays: 1, hour: 12, skipWeekend: true,
        before: dayStart + 11 * 60, after: dayStart + 13 * 60, lastFiredDay: NEVER_FIRED,
      });
      expect(r.fire).toBe(true);
    }
  });

  it("lunch is silent on canon weekend (day 2)", () => {
    const dayStart = 2 * 24 * 60;
    const r = decideMealRush({
      weekDays: 3, weekendDays: 1, hour: 12, skipWeekend: true,
      before: dayStart + 11 * 60, after: dayStart + 13 * 60, lastFiredDay: NEVER_FIRED,
    });
    expect(r.fire).toBe(false);
  });
});
