import type { CatalogMetroTrain } from "../catalog/catalogTypes";

/**
 * Where the Metro's train is, on game time, drawn from the engine's timetable
 * (the catalog's `world.metroTrain`, which riders leaving by train keep too).
 * One train runs each line and calls each game hour from `firstHour` to
 * `lastHour`; none runs overnight. It slides in from the left tunnel mouth,
 * waits at each station in turn, then leaves out the right one. Pure, so the
 * schedule is pinned without a renderer.
 */

/** Each timetable's line timings by line length, worked out once. */
const lineTimes = new WeakMap<CatalogMetroTrain, Map<number, Readonly<{ leg: number; dwell: number }>>>();

/** How long the train takes between two calls (or a tunnel mouth and a call)
 *  and how long it waits at each, on a line of `stops` stations. One station
 *  waits the timetable's full dwell; more stations share the hour, so the
 *  train waits less at each and is gone before the next hour's run. The
 *  engine works out the same (`crowd::metro_train::line_times`). */
export function metroLineTimes(timetable: CatalogMetroTrain, stops: number): Readonly<{ leg: number; dwell: number }> {
  const n = Math.max(1, stops);
  // Asked every frame for every station, so each line length's answer is kept.
  let known = lineTimes.get(timetable);
  if (!known) lineTimes.set(timetable, (known = new Map()));
  const kept = known.get(n);
  if (kept) return kept;
  const { legMinutes: leg, dwellMinutes, runMinutes } = timetable;
  const dwell = Math.min(dwellMinutes, Math.floor((runMinutes - leg * (n + 1)) / n));
  const even = runMinutes / (2 * n + 1);
  const times = Object.freeze(dwell >= 1 ? { leg, dwell } : { leg: even, dwell: even });
  known.set(n, times);
  return times;
}

/**
 * Where the one train on a line is at `minuteOfDay`: the left edge it would
 * have in a station's canvas, in the same units as `stops`, the left edges of
 * the stations along the line from left to right. It comes out of the left
 * tunnel into the first station, waits, runs through the tunnel to the next,
 * and so on, then leaves out the right tunnel past the last. Only one station
 * has the train at a time. Outside the timetable's hours, and once it has
 * gone, it waits in the tunnel `span` left of the first station.
 */
export function metroTrainAt(minuteOfDay: number, stops: readonly number[], span: number, timetable: CatalogMetroTrain): number {
  const first = stops[0] ?? 0;
  const hour = Math.floor((((minuteOfDay % 1440) + 1440) % 1440) / 60);
  if (hour < timetable.firstHour || hour > timetable.lastHour || stops.length === 0) return first - span;
  const { leg, dwell } = metroLineTimes(timetable, stops.length);
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
