import type { Tower } from "../Tower";
import type { Transport } from "../types";
import { isElevatorKind } from "../facilities";
import type { Crowd } from "../Crowd";
import type { Person } from "./person";

/**
 * Elevator-landing queue geometry for the crowd, pulled out of `motion.ts` as a
 * friend function that takes the {@link Crowd} instance. It derives, per slice,
 * the tile x each waiting person should stand at so waiters fan into a readable
 * line at the doors instead of stacking on the shaft center. A pure visual
 * placement: position never gates boarding, so it draws no rng and touches no
 * serialized state.
 */

// Elevator-landing queue geometry, in tiles: the front stands QUEUE_GAP off the
// shaft face and each waiter behind is QUEUE_SPACING further out. A rendered
// figure is a bit under one tile wide, so a spacing above that clears it and the
// row reads as distinct people rather than a solid mass.
const QUEUE_GAP = 0.8;
const QUEUE_SPACING = 1.1;

// Max tiles a landing line spreads across, from the shaft face. Bounds the
// contiguous-structure scan below (a floor can be hundreds of tiles wide) and
// caps the line so a congested landing (waiters accumulate to MAX_PEOPLE) forms
// a long readable row before it compresses, rather than trailing on forever.
const QUEUE_REACH = 30;

/** Length of the contiguous built (floor/lobby) run starting at `startX` and
 *  stepping by `dir`, capped at {@link QUEUE_REACH}. Used to pick the roomier
 *  side of a shaft and to keep the line on solid ground: unlike a floor-wide
 *  min/max, this stops at the first gap, so a floor with disjoint segments never
 *  seats a waiter over an unbuilt hole. `hasStructure` is an O(1) tile lookup,
 *  and the run is bounded, so no per-tower-units scan runs on the hot path. */
function builtRun(tower: Tower, floor: number, startX: number, dir: number): number {
  let n = 0;
  for (let x = startX; n < QUEUE_REACH && tower.hasStructure(floor, x); x += dir) n++;
  return n;
}

/** The tile x each person waiting at an elevator landing should stand at, keyed
 *  by person id, so waiters fan into a line at the doors instead of stacking on
 *  the shaft center. The longest-waiting person holds the front, so the order
 *  reflects arrival, not spawn, and a fresh arrival (wait 0) joins the back
 *  rather than shoving those ahead outward. The line extends onto whichever side
 *  of the shaft has the longer contiguous run of built floor and compresses its
 *  spacing to fit that run, so it never trails into unbuilt space (shaft x is a
 *  lot coordinate, not tower-relative, so the side must come from the real
 *  layout, not a fixed threshold). Only `waiting` people are placed; people still walking in
 *  (`toShaft`) head to the shaft face and fan out once they arrive, so this
 *  never changes the toShaft -> waiting timing the sim depends on. Stairs and
 *  escalators are walked, not queued. */
export function landingSlots(crowd: Crowd, tower: Tower): Map<number, number> {
  const slots = new Map<number, number>();
  // Resolve each shaft to an elevator (or not) once per slice, so a busy
  // landing does not repeat the lookup and kind-check per waiter.
  const elevatorOf = new Map<number, Transport | null>();
  const resolve = (id: number): Transport | null => {
    const cached = elevatorOf.get(id);
    if (cached !== undefined) return cached;
    const shaft = tower.getTransport(id);
    const ok = shaft && isElevatorKind(shaft.kind) ? shaft : null;
    elevatorOf.set(id, ok);
    return ok;
  };
  // Group waiting people per (shaft, floor) landing. Nested numeric maps keep
  // the grouping allocation-light on the per-slice hot path.
  const byShaft = new Map<number, Map<number, { shaft: Transport; people: Person[] }>>();
  for (const p of crowd.people) {
    if (p.state !== "waiting" || p.shaftId == null) continue;
    const shaft = resolve(p.shaftId);
    if (!shaft) continue;
    let byFloor = byShaft.get(p.shaftId);
    if (!byFloor) byShaft.set(p.shaftId, (byFloor = new Map()));
    let g = byFloor.get(p.floor);
    if (!g) byFloor.set(p.floor, (g = { shaft, people: [] }));
    g.people.push(p);
  }
  if (byShaft.size === 0) return slots;
  for (const [, byFloor] of byShaft) {
    for (const [floor, g] of byFloor) {
      // Longest-waiting at the front; break ties by id so equal waits (several
      // riders arriving in one slice) never reorder or flicker across runtimes.
      g.people.sort((a, b) => b.wait - a.wait || a.id - b.id);
      const leftFace = g.shaft.x;
      const rightFace = g.shaft.x + g.shaft.width;
      // Contiguous built run just outside each shaft face (the right run starts
      // at rightFace, the left one tile further out at leftFace - 1). The line
      // lays out on whichever side has the longer run and stays within it; the
      // distribution below compresses the spacing to fit that run rather than
      // trailing off the built floor or bunching the tail on one tile.
      const leftRun = builtRun(tower, floor, leftFace - 1, -1);
      const rightRun = builtRun(tower, floor, rightFace, 1);
      const side = rightRun >= leftRun ? 1 : -1;
      const run = side > 0 ? rightRun : leftRun;
      const face = side > 0 ? rightFace : leftFace;
      // Lay the line from the shaft face outward. It wants QUEUE_GAP for the
      // front rider then QUEUE_SPACING per waiter behind, but if that overruns
      // the built run the step compresses so the WHOLE line still fits on solid
      // floor: a jammed landing packs its waiters tighter (down to shoulder to
      // shoulder) rather than piling the overflow on the last tile. This is what
      // "runs out of space" does on a narrow floor, not a stack at the wall.
      const n = g.people.length;
      // The front rider stands QUEUE_GAP off the face, but never past the built
      // run: a degenerate shaft with no floor beside it (run 0) keeps everyone on
      // the face rather than one gap out over unbuilt space.
      const front = Math.min(QUEUE_GAP, run);
      const naturalDepth = front + Math.max(0, n - 1) * QUEUE_SPACING;
      const maxDepth = Math.min(naturalDepth, run);
      const step = n > 1 ? (maxDepth - front) / (n - 1) : 0;
      g.people.forEach((p, rank) => {
        slots.set(p.id, face + side * (front + rank * step));
      });
    }
  }
  return slots;
}
