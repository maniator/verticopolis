/**
 * When the metro train is in the station, on game time. One train calls each
 * game hour from 6:00 to 20:59 and none run overnight (the sim's night is
 * 21:00 to 5:59). It slides in from the left tunnel mouth, waits at the
 * platform, then leaves out the right one. The offsets are in the train's
 * station-wide canvas: -span is fully inside the left tunnel, +span fully inside
 * the right. Pure, so the schedule is pinned without a renderer.
 */

/** Minutes past the hour the train finishes sliding in. */
export const METRO_TRAIN_ARRIVED_AT = 6;
/** Minutes past the hour it starts to pull out. */
export const METRO_TRAIN_DEPARTS_AT = 20;
/** Minutes past the hour it has fully left. */
export const METRO_TRAIN_GONE_AT = 26;

/** Where the train sits at `minuteOfDay`: `-span` to `span`, 0 at the platform. */
export function metroTrainOffset(minuteOfDay: number, span: number, night: boolean): number {
  if (night) return -span;
  const m = ((minuteOfDay % 60) + 60) % 60;
  if (m < METRO_TRAIN_ARRIVED_AT) return -span * (1 - m / METRO_TRAIN_ARRIVED_AT);
  if (m < METRO_TRAIN_DEPARTS_AT) return 0;
  if (m < METRO_TRAIN_GONE_AT) return span * ((m - METRO_TRAIN_DEPARTS_AT) / (METRO_TRAIN_GONE_AT - METRO_TRAIN_DEPARTS_AT));
  return -span;
}
