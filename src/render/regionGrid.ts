import { GRID } from "../engine/facilities";
import { FLOOR, TILE } from "./scale";

/**
 * The fixed world-space region grid for room composition (CAP-2 of the mobile
 * render-perf spec, `_bmad-output/specs/spec-render-perf-mobile-zoom/`,
 * design in `region-design.md`). Settled room units draw into one cached
 * canvas per region instead of one per unit, so the GPU sees a few dozen
 * textures instead of ~1,635 and its sprite batches stop flushing on texture
 * slots. Pure module, no Excalibur import: the constants and the footprint
 * mapping are unit-tested directly, including the pinned GPU texture-size
 * ceiling (the TRANSPORT_BAND_FLOORS precedent in scale.ts).
 *
 * Region size: 32 tiles x 20 floors = 352 x 880 px. The taller-thinner cut
 * won the upload micro-bench (spec memlog 2026-07-15): it absorbs a drain
 * budget of four full re-uploads per frame with no measurable frame-time
 * change on the software-GL venue, and both pixel sides sit well under the
 * 2048 MAX_TEXTURE_SIZE floor of low-end mobile GPUs.
 */

export const REGION_TILES = 32;
export const REGION_FLOORS = 20;

/** Grid dimensions in regions. The lot is 375 tiles x 110 floors, so 12 x 6
 *  regions bound the whole world; only regions holding a settled room ever
 *  materialize a canvas. */
export const REGION_COLS = Math.ceil(GRID.width / REGION_TILES);
export const REGION_ROWS = Math.ceil((GRID.maxFloor - GRID.minFloor + 1) / REGION_FLOORS);

/** Column of the region containing this tile. */
export function regionCol(tile: number): number {
  return Math.floor(tile / REGION_TILES);
}

/** Row of the region containing this floor (rows count up from minFloor). */
export function regionRow(floor: number): number {
  return Math.floor((floor - GRID.minFloor) / REGION_FLOORS);
}

/** Stable scalar key for a region cell. */
export function regionKey(col: number, row: number): number {
  return row * REGION_COLS + col;
}

/** Every region key a unit footprint intersects: floors `floor..floor+floors-1`,
 *  tiles `x..x+width-1`. A wide or multi-story unit near a boundary lands in
 *  two (corner case four) regions; each draws the whole unit clipped to its
 *  own rect, so the union equals the unclipped draw with no visible seam (the
 *  transport-band argument). Ranges clamp to the grid: placement and save
 *  import already reject off-lot footprints, but a raw caller must never be
 *  handed a key outside `[0, REGION_COLS * REGION_ROWS)`, because column
 *  overflow would alias into the next row's keys. */
export function regionsOf(floor: number, x: number, width: number, floors: number): number[] {
  const c0 = Math.max(0, regionCol(x));
  const c1 = Math.min(regionCol(x + width - 1), REGION_COLS - 1);
  const r0 = Math.max(0, regionRow(floor));
  const r1 = Math.min(regionRow(floor + floors - 1), REGION_ROWS - 1);
  const keys: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) keys.push(regionKey(c, r));
  return keys;
}

/** World-pixel rectangle of a region: `x, y` is the TOP-LEFT corner (matching
 *  the anchor-0,0 actor convention), `w, h` the canvas size. Floor f occupies
 *  world y in [-f*FLOOR, -(f-1)*FLOOR), so the region's top edge sits at the
 *  top of its highest floor. */
export function regionRect(key: number): { x: number; y: number; w: number; h: number } {
  const row = Math.floor(key / REGION_COLS);
  const col = key % REGION_COLS;
  const topFloor = GRID.minFloor + (row + 1) * REGION_FLOORS - 1;
  return {
    x: col * REGION_TILES * TILE,
    y: -topFloor * FLOOR,
    w: REGION_TILES * TILE,
    h: REGION_FLOORS * FLOOR,
  };
}
