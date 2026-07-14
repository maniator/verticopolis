import { facilityFloors } from "../../engine/facilities";
import type { Unit } from "../../engine/types";

/**
 * Pure layout math for the ambient-walker builder in {@link buildWalkers}. These
 * helpers take plain values (no Excalibur canvas bake), so `buildWalkers` itself
 * can stay on the Playwright tier while the placement rules are unit-tested here.
 */

/** The x-spans of the UPPER stories of every multi-floor facility (cinema,
 *  party hall, recycling, metro), keyed by floor row. Those rows still carry the
 *  facility's floor lots, but an ambient walker placed there would stand on the
 *  facility's mid-line and float above its real floor, so `buildWalkers` drops
 *  these lots from its runs. */
export function coveredUpperStories(units: readonly Unit[]): Map<number, Array<[number, number]>> {
  const rows = new Map<number, Array<[number, number]>>();
  for (const u of units) {
    const span = facilityFloors(u.kind);
    if (span <= 1) continue;
    for (let k = 1; k < span; k++) {
      const row = u.floor + k;
      let spans = rows.get(row);
      if (!spans) rows.set(row, (spans = []));
      spans.push([u.x, u.x + u.width]);
    }
  }
  return rows;
}

/** True if lot `x` on `floor` sits inside a covered upper-story span (the
 *  half-open `[a, b)` of a multi-floor facility), so `buildWalkers` skips it. */
export function lotCovered(rows: Map<number, Array<[number, number]>>, floor: number, x: number): boolean {
  const spans = rows.get(floor);
  if (!spans) return false;
  for (const [a, b] of spans) if (x >= a && x < b) return true;
  return false;
}

/** The world-x stretch a single concourse walker paces. The run [x0w, x1w] is
 *  split into `count` evenly spaced lanes (lane `i` centered at `(i + 0.5) /
 *  count` of the run) so a busy lobby fans figures across the width instead of
 *  piling them at the ping-pong turnaround ends. Each figure paces its own lane
 *  plus a small symmetric overlap, so figures never all sweep the full run and
 *  bunch. Evenly spaced (not an `i * stride mod count` interleave) so it can
 *  never collapse every figure into one lane when the stride shares a factor
 *  with the count. Returns [segX0, segX1] with segX1 >= segX0 for every
 *  count >= 1. */
export function lobbyLaneSpan(i: number, count: number, x0w: number, x1w: number): [number, number] {
  const runW = x1w - x0w;
  const laneFrac = (i + 0.5) / count;
  const anchor = x0w + laneFrac * runW;
  const half = Math.min(runW / 2, Math.max(18, runW / count));
  return [Math.max(x0w, anchor - half), Math.min(x1w, anchor + half)];
}
