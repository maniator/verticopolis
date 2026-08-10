import { FLOOR, TILE } from "./scale";

/**
 * Box geometry for the two sprite-review pages, `preview.html` and
 * `gallery.html`.
 *
 * Both pages exist so a person can judge room art at the proportions the game
 * actually draws, which is why neither may carry its own idea of a tile or a
 * floor. They each grew one anyway and then drifted (issue #814): the world
 * moved to 10 x 45 while the preview still drew 12 x 44 and the gallery 18 x 52,
 * so every sprite vetted through them was vetted at 3.67 and 2.9 tiles per floor
 * against a world of 4.5. Deriving both from `scale.ts` through this one helper
 * is what keeps that from happening a third time.
 *
 * A review page may draw LARGER than the world, because small art is hard to
 * judge, but only by a whole multiple of it, so the aspect survives the
 * magnification. A footprint too big for its cell then shrinks uniformly, which
 * costs size but never shape.
 */

/** One sprite box, sized for a cell. */
export interface CatalogBox {
  /** Box width in on-screen pixels. */
  w: number;
  /** Box height in on-screen pixels. */
  h: number;
  /** On-screen pixels per tile, for callers that place details by tile. */
  tile: number;
  /** How much of the world scale the box got: `mag` when the cell had room for
   *  it, less when the footprint had to shrink to fit. */
  scale: number;
}

/**
 * Fit a `tiles` x `floors` footprint into a `maxW` x `maxH` cell at the world's
 * aspect, drawn at up to `mag` times the world scale.
 *
 * Pass `Infinity` for a budget the caller does not want to bind on (the metro's
 * platform art composes itself into whatever width it is handed, so the gallery
 * takes only its height from here and lets it fill the cell).
 */
export function fitAtGameScale(tiles: number, floors: number, maxW: number, maxH: number, mag = 1): CatalogBox {
  // A degenerate footprint has no box rather than a NaN one: both budgets can be
  // zero on a very narrow viewport, and 0 / 0 would poison every coordinate
  // downstream instead of simply drawing nothing.
  // A degenerate or non-finite footprint has no box rather than a NaN one. The
  // comparison alone would let NaN through (every comparison against NaN is
  // false), which is the exact coordinate poisoning this guard exists to stop.
  if (!Number.isFinite(tiles) || !Number.isFinite(floors) || tiles <= 0 || floors <= 0) {
    return { w: 0, h: 0, tile: 0, scale: 0 };
  }
  // Magnification is a WHOLE multiple of world scale, enforced here rather than
  // trusted to callers: this module exists to hold that invariant, and a
  // fractional mag would put half a world tile on screen.
  const whole = Math.max(1, Math.floor(Number.isFinite(mag) ? mag : 1));
  const scale = Math.max(0, Math.min(whole, maxW / (tiles * TILE), maxH / (floors * FLOOR)));
  return { w: tiles * TILE * scale, h: floors * FLOOR * scale, tile: TILE * scale, scale };
}
