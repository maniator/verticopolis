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
 * judge, but only by a whole multiple of it, so every world pixel lands on a
 * whole block of screen pixels. A footprint too big for the requested multiple
 * steps down to the largest whole multiple that fits. Only a footprint too big
 * to fit even at the world scale shrinks by a fraction; that keeps its shape but
 * softens its edges, so a page should size its cells to make that the rare case.
 */

/** One sprite box, sized for a cell. */
export interface CatalogBox {
  /** Box width in on-screen pixels. */
  w: number;
  /** Box height in on-screen pixels. */
  h: number;
  /** How much of the world scale the box got: a whole number from 1 to `mag`
   *  when the footprint fits at the world scale, a fraction below 1 when it
   *  does not, and 0 for an empty box. */
  scale: number;
}

const EMPTY: CatalogBox = { w: 0, h: 0, scale: 0 };

/**
 * Fit a `tiles` x `floors` footprint into a `maxW` x `maxH` cell at the world's
 * aspect, drawn at up to `mag` times the world scale. `mag` is a whole multiple:
 * a fraction is floored, and anything below 1 (or not finite) counts as 1.
 *
 * Pass `Infinity` for a budget the caller does not want to bind on (the metro's
 * platform art composes itself into whatever width it is handed, so the gallery
 * takes only its height from here and lets it fill the cell).
 */
export function fitAtGameScale(tiles: number, floors: number, maxW: number, maxH: number, mag = 1): CatalogBox {
  // A degenerate or non-finite footprint, or a budget that is not a number, has
  // no box rather than a NaN one. A comparison alone would let NaN through
  // (every comparison against NaN is false), and a NaN box poisons every
  // coordinate downstream instead of simply drawing nothing. Infinity is a
  // legal budget, so the budgets are checked for NaN only.
  if (!Number.isFinite(tiles) || !Number.isFinite(floors) || tiles <= 0 || floors <= 0) return EMPTY;
  if (Number.isNaN(maxW) || Number.isNaN(maxH)) return EMPTY;
  const whole = Math.max(1, Math.floor(Number.isFinite(mag) ? mag : 1));
  const fit = Math.min(maxW / (tiles * TILE), maxH / (floors * FLOOR));
  if (!(fit > 0)) return EMPTY;
  // Step down through whole multiples; fall below 1 only when nothing else fits.
  const scale = fit >= 1 ? Math.min(whole, Math.floor(fit)) : fit;
  return { w: tiles * TILE * scale, h: floors * FLOOR * scale, scale };
}
