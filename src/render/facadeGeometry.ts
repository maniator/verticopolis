import { facilityFloors } from "../engine/facilities";
import type { Unit } from "../engine/types";

/** Left/right built extent of one above-ground floor row, in tile columns
 *  (`min` = leftmost tile, `max` = exclusive right edge). */
export interface FloorEdge {
  min: number;
  max: number;
}

/**
 * The tower's exterior silhouette, derived from its units in a SINGLE pass —
 * consumed by the escape stairs (per-floor edges) and the rooftop crane
 * (top-floor tiles). Kept pure and engine-free so it is unit-testable without
 * standing up an Excalibur canvas, and computed once so a structural change
 * doesn't scan the (potentially thousands of) units more than necessary.
 *
 * Every story of a multi-floor room counts on each row it occupies, so a
 * two-story cinema at the edge still dresses its upper row. Basement rows are
 * excluded (edges clamp to floor ≥ 1), matching the above-ground facade.
 */
export interface FacadeGeometry {
  /** Leftmost/rightmost built tile per above-ground floor row. */
  edges: Map<number, FloorEdge>;
  /** Built tile columns on `highestFloor` — where the crane perches. Empty
   *  when the top floor carries no above-ground structure (basement-only or
   *  empty lot), which is exactly when no crane should be shown. */
  topTiles: Set<number>;
}

/**
 * Build {@link FacadeGeometry} for `units`. `highestFloor` is the tower's
 * top occupied floor (passed in so the caller's canonical value drives which
 * row the crane reads, rather than re-deriving it here).
 */
export function facadeGeometry(units: readonly Unit[], highestFloor: number): FacadeGeometry {
  const edges = new Map<number, FloorEdge>();
  const topTiles = new Set<number>();
  for (const u of units) {
    const right = u.x + u.width;
    const top = u.floor + facilityFloors(u.kind);
    for (let f = Math.max(1, u.floor); f < top; f++) {
      const e = edges.get(f);
      if (!e) edges.set(f, { min: u.x, max: right });
      else {
        if (u.x < e.min) e.min = u.x;
        if (right > e.max) e.max = right;
      }
      // Same scan feeds the crane: remember the top row's built columns so
      // syncCrane needn't re-traverse every unit to find them.
      if (f === highestFloor) for (let x = u.x; x < right; x++) topTiles.add(x);
    }
  }
  return { edges, topTiles };
}
