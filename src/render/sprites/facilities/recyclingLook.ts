import { FLOOR, TILE } from "../../scale";

/**
 * The part of the recycling center's art that follows the tower's recycling
 * fill (`drawRecycling` in `recycling.ts`), as one pure function. The routine
 * reads the fill only through {@link recyclingLook}, so two fills with the same
 * look paint the same pixels; the sprite atlas relies on that to find every
 * fill where the picture changes (`atlas/recyclingFill.ts`).
 *
 * Geometry is in the routine's reference build, authored on the live grid
 * (20 tiles by 2 floors at TILE 10 by FLOOR 45, so 200 x 90), where `refMap`
 * is the identity.
 */

/** The reference build's size. */
export const RECYCLING_REF_W = 20 * TILE;
export const RECYCLING_REF_H = 2 * FLOOR;
/** The deck line, 7 rows above the bottom. */
export const RECYCLING_DECK = RECYCLING_REF_H - 7;
/** The pile's first bag column and the pitch between bags. */
export const RECYCLING_PILE_X0 = 25;
export const RECYCLING_PILE_PITCH = 7;
/** A bag is 6 wide, so one pitch leaves a 1px gap to the next. */
export const RECYCLING_BAG_W = 6;
/** The baler's left edge, and the five compacted cubes that wait left of it
 *  (6 wide, the first 4px clear of the baler); the leftmost cube starts at
 *  `RECYCLING_CUBES_X`. */
export const RECYCLING_BALER_X = RECYCLING_REF_W - 47;
export const RECYCLING_CUBE_W = 6;
export const RECYCLING_CUBES_X = RECYCLING_BALER_X - 4 - 4 * RECYCLING_CUBE_W;
/** How many bags the pile holds when full: as many as fit before the
 *  compacted cubes, so the last bag never half covers one. */
export const RECYCLING_PILE_SLOTS = Math.floor((RECYCLING_CUBES_X - RECYCLING_BAG_W - RECYCLING_PILE_X0) / RECYCLING_PILE_PITCH) + 1;
/** The wall gauge's top row and its height in rows. */
export const RECYCLING_GAUGE_TOP = 14;
export const RECYCLING_GAUGE_ROWS = RECYCLING_DECK - 18;

export interface RecyclingLook {
  /** Bags on the deck. */
  bags: number;
  /** Past half full the pile stacks a second row. */
  stacked: boolean;
  /** The gauge turns amber past 0.7. */
  amber: boolean;
  /** At capacity the gauge turns red and shows FULL. */
  full: boolean;
  /** Lit gauge rows. */
  gaugeRows: number;
}

/** The look for a raw fill: clamped to 0..1, a non-finite fill read as 0. */
export function recyclingLook(rawFill: number | undefined): RecyclingLook {
  const raw = rawFill ?? 0;
  const fill = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  return {
    bags: Math.round(fill * RECYCLING_PILE_SLOTS),
    stacked: fill > 0.5,
    amber: fill > 0.7,
    full: fill >= 1,
    gaugeRows: Math.round(RECYCLING_GAUGE_ROWS * fill),
  };
}
