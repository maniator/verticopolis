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

/** Minutes in the daytime hour a train has for its run along a line. */
const RUN_MINUTES = 54;

/** Each line length's timing, worked out once. */
const lineTimes = new Map<number, Readonly<{ leg: number; dwell: number }>>();

/** How long the train takes between two calls (or a tunnel mouth and a call)
 *  and how long it waits at each, on a line of `stops` stations. One station
 *  keeps the schedule above; more stations share the hour, so the train waits
 *  less at each and is gone before the next hour's run. */
export function metroLineTimes(stops: number): Readonly<{ leg: number; dwell: number }> {
  const n = Math.max(1, stops);
  // Asked every frame for every station, so each line length's answer is kept.
  const known = lineTimes.get(n);
  if (known) return known;
  const leg = METRO_TRAIN_ARRIVED_AT;
  const usual = METRO_TRAIN_DEPARTS_AT - METRO_TRAIN_ARRIVED_AT;
  const dwell = Math.min(usual, Math.floor((RUN_MINUTES - leg * (n + 1)) / n));
  const even = RUN_MINUTES / (2 * n + 1);
  const times = Object.freeze(dwell >= 1 ? { leg, dwell } : { leg: even, dwell: even });
  lineTimes.set(n, times);
  return times;
}

/**
 * Where the one train on a line is at `minuteOfDay`: the left edge it would
 * have in a station's canvas, in the same units as `stops`, the left edges of
 * the stations along the line from left to right. It comes out of the left
 * tunnel into the first station, waits, runs through the tunnel to the next,
 * and so on, then leaves out the right tunnel past the last. Only one station
 * has the train at a time. Overnight, and once it has gone, it waits in the
 * tunnel `span` left of the first station. With one station this is that
 * station's left edge plus `metroTrainOffset`.
 */
export function metroTrainAt(minuteOfDay: number, stops: readonly number[], span: number, night: boolean): number {
  const first = stops[0] ?? 0;
  if (night || stops.length === 0) return first - span;
  const { leg, dwell } = metroLineTimes(stops.length);
  let t = ((minuteOfDay % 60) + 60) % 60;
  if (t < leg) return first - span * (1 - t / leg);
  t -= leg;
  for (let i = 0; i < stops.length; i++) {
    const here = stops[i];
    if (t < dwell) return here;
    t -= dwell;
    const next = i + 1 < stops.length ? stops[i + 1] : here + span;
    if (t < leg) return here + (next - here) * (t / leg);
    t -= leg;
  }
  return first - span;
}
