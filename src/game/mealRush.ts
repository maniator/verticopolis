/**
 * Pure decision function for the "Breakfast/Lunch/Dinner rush!" info-log
 * bulletins. Extracted from `emitMealRushes` in `main.ts` so a test can pin its
 * edge cases (NaN clock, huge-frame catch-up, once-per-day latch, weekend skip)
 * without booting a GameApp shell.
 *
 * The function is called once per meal kind per frame. Given:
 *   - `hour`         : the meal's start hour (7, 12, or 18)
 *   - `skipWeekend`  : true for lunch and dinner; false for breakfast (hotels
 *                      serve breakfast on weekends)
 *   - `before`       : `minutesBeforeTicks`, the frame START in absolute minutes
 *   - `after`        : `sim.clock.minutes`, the frame END in absolute minutes
 *   - `weekDays`     : the calendar's week length (7 for real-world, 3 for canon)
 *   - `weekendDays`  : trailing slots of the week that count as weekend
 *   - `lastFiredDay` : the day index the bulletin last fired for this kind
 *                      (`-1` on a fresh session so the first day fires)
 *
 * The function returns `{ fire, dayOfKind }`:
 *   - `fire`      : true iff the bulletin should emit right now
 *   - `dayOfKind` : the day index computed for the crossing; when `fire` is true
 *                    the caller stores this in its per-kind latch
 *
 * NaN inputs are the caller's responsibility (a NaN-guarded save must short-
 * circuit before invoking this).
 */
export function decideMealRush(input: {
  hour: number;
  skipWeekend: boolean;
  before: number;
  after: number;
  weekDays: number;
  weekendDays: number;
  lastFiredDay: number;
}): { fire: boolean; dayOfKind: number } {
  const { hour, skipWeekend, before, after, weekDays, weekendDays, lastFiredDay } = input;
  // The first meal-hour crossing strictly after `before`. Anchoring on the
  // frame start (not the post-tick clock) keeps the crossing check correct for
  // a single frame that leaps past the hour boundary. This mirrors the shipped
  // lunch bulletin's semantics and is a load-bearing invariant: touching it
  // reintroduces the missed-crossing bug near midnight.
  const dayOfKind = Math.floor((before - hour * 60) / 1440) + 1;
  const absMinute = dayOfKind * 1440 + hour * 60;
  if (absMinute > after) return { fire: false, dayOfKind };
  if (skipWeekend && dayOfKind % weekDays >= weekDays - weekendDays) return { fire: false, dayOfKind };
  if (dayOfKind === lastFiredDay) return { fire: false, dayOfKind };
  return { fire: true, dayOfKind };
}
