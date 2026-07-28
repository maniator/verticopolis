import type { Tower } from "../Tower";
import type { Person } from "./person";
import { WALK_SPEED } from "./person";
import { segmentsOf } from "../tower/segments";

/**
 * On-foot horizontal movement for the crowd state machine, with the #647
 * structural guard baked in so a rendered person can never glide across a gap.
 *
 * A person walks only within one contiguous run of floor/lobby tiles. The
 * routing fixes make every leg land on the walker's own run, so in practice
 * `walkTo` always has an intra-run target; the guard is the last line of defense
 * for any residual path (or a mid-walk bulldoze that opens a gap under a moving
 * figure): if the target lies beyond the run the walker currently stands on, it
 * stops at that run's edge and reports "arrived" rather than interpolating over
 * the void, so the caller finishes or dwells gracefully.
 */

/** The contiguous run `[start, end]` (inclusive x) containing `x` on `floor`, or
 *  undefined when `x` sits over a gap or the story has no floor tiles at all (a
 *  metro platform deck). Runs are sorted left to right, so the scan stops early. */
function runAt(tower: Tower, floor: number, x: number): [number, number] | undefined {
  for (const run of segmentsOf(tower, floor)) {
    if (x < run[0]) return undefined; // x sits in the gap before this run
    if (x <= run[1]) return run;
  }
  return undefined;
}

/**
 * Walk toward a tile x on the current floor; returns true once arrived.
 *
 * Structural guard: when the walker stands on a real run and `targetX` lies
 * beyond that run's edge (across a gap), it stops at the edge and reports
 * arrived, so it never advances x over an unbuilt hole. A gap-free floor is one
 * run spanning every reachable tile, so a legitimate target is always inside it
 * and the guard never fires (byte-identical motion). A story with no runs (a
 * metro platform deck) yields no bounding run, so the guard is skipped and the
 * deck walk proceeds; the guard only ever engages when LEAVING solid ground.
 *
 * The `Math.round(p.x)` the guard keys on stays inside the walker's run: every
 * target is an in-run integer tile and the final step clamps `p.x` to it rather
 * than overshooting, so `p.x` never drifts fractionally past an edge to slip the
 * guard.
 */
export function walkTo(p: Person, targetX: number, dt: number, tower: Tower): boolean {
  const dir = Math.sign(targetX - p.x);
  if (dir !== 0) {
    const run = runAt(tower, p.floor, Math.round(p.x));
    if (run) {
      const [start, end] = run;
      if (dir > 0 && targetX > end) {
        p.x = end;
        return true;
      }
      if (dir < 0 && targetX < start) {
        p.x = start;
        return true;
      }
    }
  }
  const dx = targetX - p.x;
  const step = WALK_SPEED * dt;
  if (Math.abs(dx) <= step) {
    p.x = targetX;
    return true;
  }
  p.x += dir * step;
  return false;
}
