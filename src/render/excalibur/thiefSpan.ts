import type { UnitView } from "../../simport/view";

/** The tile span of a floor's rooms: left edge, right edge (exclusive). The
 *  run the thief takes across one tower's part of a floor (#1886). */
export interface ThiefSpan {
  readonly left: number;
  readonly right: number;
}

/** The tile span of the rooms on `floor` (left edge, right edge), or null
 *  when it has none. Bare floor and lobby tiles do not count, the same span
 *  the bomb search's guards walk. Given `x`, only the rooms on the run of
 *  floor and lobby tiles holding that tile count: one tower's part of the
 *  floor on a lot with several. One pass over the units, made once when a
 *  thief appears (at most once a game day), never per frame. */
export function floorRoomSpan(
  units: ReadonlyArray<Pick<UnitView, "kind" | "floor" | "x" | "width">>,
  floor: number,
  x?: number,
): ThiefSpan | null {
  const run = x === undefined || !Number.isFinite(x) ? null : structuralRun(units, floor, x);
  let span: ThiefSpan | null = null;
  for (const u of units) {
    if (u.floor !== floor || u.kind === "floor" || u.kind === "lobby") continue;
    if (run && (u.x > run.right || u.x + u.width <= run.left)) continue;
    if (!span) span = { left: u.x, right: u.x + u.width };
    else span = { left: Math.min(span.left, u.x), right: Math.max(span.right, u.x + u.width) };
  }
  return span;
}

/** The run of floor and lobby tiles on `floor` that holds tile `x`, as its
 *  first and last tiles, or null when no such tile is there. */
function structuralRun(
  units: ReadonlyArray<Pick<UnitView, "kind" | "floor" | "x" | "width">>,
  floor: number,
  x: number,
): ThiefSpan | null {
  const pieces: Array<[number, number]> = [];
  for (const u of units) {
    if (u.floor === floor && (u.kind === "floor" || u.kind === "lobby")) pieces.push([u.x, u.x + u.width - 1]);
  }
  pieces.sort((a, b) => a[0] - b[0]);
  let run: ThiefSpan | null = null;
  for (const [first, last] of pieces) {
    if (run && first <= run.right + 1) run = { left: run.left, right: Math.max(run.right, last) };
    else if (run && run.left <= x && x <= run.right) return run;
    else run = { left: first, right: last };
  }
  return run && run.left <= x && x <= run.right ? run : null;
}

/** Where the thief is, in tiles, a fraction `p` of the way through his run:
 *  he comes off the emergency stairs just left of the floor's rooms (where
 *  the guards climb) and runs the rooms to their right edge. */
export function thiefX(span: ThiefSpan, p: number): number {
  const from = span.left - 1;
  return from + (span.right - from) * Math.min(1, Math.max(0, p));
}
