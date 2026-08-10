/**
 * World-scale render constants, in a pure module (no Excalibur import) so unit
 * tests can pin the invariants that TowerEngine's drawing depends on.
 */

/** World pixels per tile. */
export const TILE = 10;

/** Tiles per floor. The 1994 original is 8px tiles and a 36px floor pitch, both
 *  measured off a retail render (the Wine harness, loading `TOWER13.TDT`): nine
 *  consecutive floor gaps of exactly 36px, and an elevator shaft 31-32px wide,
 *  which is its 4-tile car at 8px a tile. 36 / 8 is 4.5. */
export const TILES_PER_FLOOR = 4.5;

/** World pixels per floor, at the original's proportions.
 *
 *  This was `4 * TILE`, justified as making the 4-tile car "read square, as in
 *  the 1994 original". The measurement above disproves that: the original's car
 *  is 32 x 36, TALLER than it is wide. A square car is 12.5% too wide for its
 *  height, and every sprite authored against it inherited the error.
 *
 *  10 x 45 restores 4.5 exactly, at 1.25x the original's resolution and close
 *  enough to the old 11 x 44 that existing art barely moves. 8 x 36 would match
 *  the original outright but throw away resolution already drawn; 16 x 72 would
 *  be a clean 2x but pushes a shaft band past the texture cap below.
 *
 *  `scale.test.ts` pins the ratio and the taller-than-wide car. */
export const FLOOR = TILES_PER_FLOOR * TILE;

/** Max floors drawn into a single shaft-graphic band. A shaft's backing bitmap
 *  is `floors * FLOOR` px tall; a mobile GPU's MAX_TEXTURE_SIZE is often 4096
 *  and sometimes 2048, and a bitmap past that fails to upload (renders black).
 *  45 floors -> 2025px, still under both, so tall shafts are split into bands.
 *  `scale.test.ts` pins the product against the 2048px cap. */
export const TRANSPORT_BAND_FLOORS = 45;
