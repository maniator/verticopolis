import type { Tower } from "../Tower";
import type { Transport } from "../types";
import { GRID } from "../facilities";

/**
 * Contiguous-floor-SEGMENT geometry for pedestrian pathfinding (#647).
 *
 * A person walks only within a contiguous run of structural (floor/lobby) tiles
 * on one floor: an unbroken segment. A gap between two runs on the same floor is
 * a real, un-walkable void, so the routing graph node is a SEGMENT, not a whole
 * floor number. This leaf owns the pure segment math (packing a (floor, startX)
 * into one integer id, and finding the run a tile belongs to) plus a per-tower,
 * per-revision cache of each floor's runs so routing never rescans tiles per
 * person per frame.
 *
 * SAFETY PROPERTY: a gap-free floor is exactly ONE segment, so {@link segId} is a
 * bijection with the floor there and the segment graph is isomorphic to the old
 * floor graph. That keeps a contiguous tower's routes (and the rng they draw)
 * byte-identical, which the golden-master test pins.
 */

/** Added to a floor before packing so basements (down to {@link GRID.minFloor})
 *  stay non-negative in the id. */
const FLOOR_OFFSET = -GRID.minFloor;

/** Pack a segment's (floor, leftmost x) into one non-negative integer id. The
 *  inverse {@link floorOfSeg} is exact only while `startX` stays in
 *  `[0, GRID.width)`, which every placed tile does (placement validation bounds x
 *  to the grid); a hand-edited save with an out-of-range x is the only way to
 *  collide two floors' ids. */
export function segId(floor: number, startX: number): number {
  return (floor + FLOOR_OFFSET) * GRID.width + startX;
}

/** The floor a segment id belongs to (inverse of {@link segId}). */
export function floorOfSeg(seg: number): number {
  return Math.floor(seg / GRID.width) - FLOOR_OFFSET;
}

interface SegCache {
  rev: number;
  /** floor -> sorted, disjoint structural runs `[start, end]` (inclusive x). */
  byFloor: Map<number, Array<[number, number]>>;
}

// Per-tower cache keyed by tower.revision (the same key routing/stops memoize
// on: every structural edit bumps it). A WeakMap so a discarded tower never
// pins its cache.
const cache = new WeakMap<Tower, SegCache>();

function cacheFor(tower: Tower): SegCache {
  const hit = cache.get(tower);
  if (hit && hit.rev === tower.revision) return hit;
  const fresh: SegCache = { rev: tower.revision, byFloor: new Map() };
  cache.set(tower, fresh);
  return fresh;
}

/**
 * The contiguous structural runs on `floor`, each `[start, end]` inclusive in x,
 * left to right and disjoint. Built by scanning the floor's structural (floor /
 * lobby) tiles once and merging adjacent x's, then memoized per
 * {@link Tower.revision}. Empty when the floor has no structure at all.
 */
export function segmentsOf(tower: Tower, floor: number): Array<[number, number]> {
  const c = cacheFor(tower);
  const cached = c.byFloor.get(floor);
  if (cached) return cached;
  const xs: number[] = [];
  for (const u of tower.units) {
    if ((u.kind === "floor" || u.kind === "lobby") && u.floor === floor) {
      for (let i = 0; i < u.width; i++) xs.push(u.x + i);
    }
  }
  xs.sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (i > 0 && x === xs[i - 1]) continue; // overlapping footprints: dedupe
    const last = runs[runs.length - 1];
    if (last && x === last[1] + 1) last[1] = x;
    else runs.push([x, x]);
  }
  c.byFloor.set(floor, runs);
  return runs;
}

/** The leftmost x of the contiguous structural run containing `(floor, x)`. A
 *  tile with no structure under it is its own lone segment, so its own x is
 *  returned. */
export function segmentStartX(tower: Tower, floor: number, x: number): number {
  for (const [start, end] of segmentsOf(tower, floor)) {
    if (x < start) break; // runs are sorted, so no later run can contain x
    if (x <= end) return start;
  }
  return x;
}

/**
 * The segment id for a position on `floor`. With an explicit `x`, the segment
 * containing that tile (or the lone-tile segment when `x` sits over a gap).
 * Without `x`, the floor's leftmost segment as a stable floor-level
 * representative: on a gap-free floor that is THE one segment, so a floor-only
 * caller lands on the same node the old floor graph used.
 */
export function segAt(tower: Tower, floor: number, x?: number): number {
  if (x !== undefined) return segId(floor, segmentStartX(tower, floor, x));
  const runs = segmentsOf(tower, floor);
  return segId(floor, runs.length > 0 ? runs[0][0] : 0);
}

/**
 * Every DISTINCT segment id the transport's footprint attaches to on `floor`,
 * ascending. A wide shaft (elevators are 4 wide, express 6, stairs/escalators 8)
 * whose footprint straddles a gap sits over TWO runs at once, and a rider on
 * either can board it, so BOTH must be linked or the far run reads stranded
 * though the shaft physically reaches it (#662). Scanned left to right, deduped,
 * and sorted so the list is a canonical, deterministic bank key. Falls back to
 * the shaft's own leftmost column when the floor has no structure under it at all
 * (only reachable by a hand-edited save; validateTransport requires structure at
 * each stop).
 *
 * On a gap-free floor the footprint touches the floor's single segment, so this
 * returns exactly one id, and the routing graph and shaft banks built from it are
 * byte-identical to the old floor-keyed behavior (the golden-master invariant).
 */
export function landingSegs(tower: Tower, t: Transport, floor: number): number[] {
  const segs: number[] = [];
  for (let i = 0; i < t.width; i++) {
    if (tower.hasStructure(floor, t.x + i)) {
      const s = segAt(tower, floor, t.x + i);
      if (!segs.includes(s)) segs.push(s);
    }
  }
  if (segs.length === 0) return [segId(floor, t.x)];
  return segs.sort((a, b) => a - b);
}

/**
 * The x a rider steps off `t` onto at `floor`, heading toward `towardX` (their
 * next shaft or final unit). Normally the shaft center, but a shaft whose
 * footprint straddles a gap lands on TWO runs (#662): stepping off at the center
 * can drop the rider on the WRONG run (a wide express/stair center can sit on the
 * near run while the destination is the far one), where the walk guard then pins
 * them at that run's edge and they never reach their unit. So when the footprint
 * covers more than one run, alight on the structural column NEAREST `towardX`,
 * i.e. the run that leads onward. On a single-run footprint (every gap-free
 * floor) this returns the plain center, byte-identical to before.
 */
export function alightX(tower: Tower, t: Transport, floor: number, towardX: number): number {
  const center = t.x + t.width / 2;
  if (landingSegs(tower, t, floor).length <= 1) return center;
  let best = center;
  let bestDist = Infinity;
  for (let i = 0; i < t.width; i++) {
    const c = t.x + i;
    if (!tower.hasStructure(floor, c)) continue;
    const d = Math.abs(c - towardX);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}
