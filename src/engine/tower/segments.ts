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

/** The segment id a transport attaches to on `floor`: the run containing the
 *  first structural tile under its footprint (scanned left to right for a
 *  deterministic choice), or its own leftmost column when the floor has no
 *  structure under the shaft. Every validly built shaft has structure at each
 *  stop (validateTransport requires it), so the fallback is only reached by a
 *  hand-edited save.
 *
 *  Known limitation (tracked follow-up): if a shaft footprint straddles a gap and
 *  overlaps TWO runs on one floor (a gap narrower than the shaft, structure on
 *  both sides), only the first run is linked, so a tenant on the far overlapped
 *  run reads stranded though the shaft physically reaches them. This fails safe
 *  (it under-connects, never letting anyone cross a gap) and cannot occur on a
 *  gap-free floor, so it does not affect the byte-identical golden property. */
export function landingSeg(tower: Tower, t: Transport, floor: number): number {
  for (let i = 0; i < t.width; i++) {
    if (tower.hasStructure(floor, t.x + i)) return segAt(tower, floor, t.x + i);
  }
  return segId(floor, t.x);
}
