/**
 * World-scale render constants, in a pure module (no Excalibur import) so unit
 * tests can pin the invariants that TowerEngine's drawing depends on.
 */

/** World pixels per tile. */
export const TILE = 11;

/** World pixels per floor. A floor is exactly one standard-elevator width of
 *  tiles (4 x 11 = 44px) so the 4-tile-wide car reads square, as in the 1994
 *  original. `renderScale.test.ts` pins this against the catalog width. */
export const FLOOR = 4 * TILE;

/** Max floors drawn into a single shaft-graphic band. A shaft's backing bitmap
 *  is `floors * FLOOR` px tall; a mobile GPU's MAX_TEXTURE_SIZE is often 4096
 *  and sometimes 2048, and a bitmap past that fails to upload (renders black).
 *  45 floors -> 1980px, safely under both, so tall shafts are split into bands.
 *  `renderScale.test.ts` pins the product against the 2048px cap. */
export const TRANSPORT_BAND_FLOORS = 45;
