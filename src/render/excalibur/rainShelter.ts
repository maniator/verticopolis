import type { FloorEdge } from "../facadeGeometry";
import type { TowerEngine } from "./TowerEngine";

/**
 * Where the rain does not fall (#638). The rain overlay used to cover the
 * whole view, the tower and the basements included; in the original it falls
 * only on the open sky, so the rooms read as dry and indoors. The building is
 * the facade's runs: each above-ground floor row's runs of built tiles, the
 * same runs the fire escapes hang off. A wedding hall's garden crown is not a
 * building row, so rain still falls on it.
 *
 * The runs are flattened once per structural change (`setRainShelter`, from
 * `syncFacade`) into one flat array sorted by floor, so the per-frame clip
 * finds the first on-screen floor by binary search and walks only the rows in
 * view, plain numbers with no allocation.
 */

/** Values per run in a shelter array: floor, first tile, exclusive end tile. */
const RUN_STRIDE = 3;

const shelters = new WeakMap<TowerEngine, Int32Array>();

/** The facade's runs as one flat array, `RUN_STRIDE` numbers per run, in
 *  floor order (left to right within a floor). */
export function shelterRuns(runs: ReadonlyMap<number, readonly FloorEdge[]>): Int32Array {
  let count = 0;
  for (const row of runs.values()) count += row.length;
  const out = new Int32Array(count * RUN_STRIDE);
  let i = 0;
  const floors = [...runs.keys()].sort((a, b) => a - b);
  for (const floor of floors) {
    for (const run of runs.get(floor) ?? []) {
      out[i++] = floor;
      out[i++] = run.min;
      out[i++] = run.max;
    }
  }
  return out;
}

/** Record the tower's current runs as the rain's shelter. */
export function setRainShelter(engine: TowerEngine, runs: ReadonlyMap<number, readonly FloorEdge[]>): void {
  shelters.set(engine, shelterRuns(runs));
}

/**
 * Clip `ctx` to the open sky: the view above the ground line, less every
 * on-screen run of the building. Returns false, with nothing clipped, when no
 * sky is on screen (a view of the basements). The caller saves and restores.
 */
export function clipToOpenSky(engine: TowerEngine, ctx: CanvasRenderingContext2D, viewW: number, viewH: number): boolean {
  // Floor f spans world rows from f - 1 (its bottom) to f (its top); the
  // ground line is floor 1's bottom.
  const ground = engine.worldToScreenY(0);
  if (ground <= 0) return false;
  const floorH = engine.worldToScreenY(1) - ground; // negative: up the screen
  const x0 = engine.worldToScreenX(0);
  const tileW = engine.worldToScreenX(1) - x0;
  ctx.beginPath();
  ctx.rect(0, 0, viewW, Math.min(ground, viewH));
  const runs = shelters.get(engine);
  if (runs) {
    // Floor rows that can touch the view, widened by one so rounding never
    // drops a row; the exact test is per run below.
    const rows = -floorH;
    const lowest = Math.floor((ground - viewH) / rows);
    const highest = Math.ceil(ground / rows) + 1;
    for (let i = firstRunAtOrAbove(runs, lowest); i < runs.length && runs[i] <= highest; i += RUN_STRIDE) {
      const top = ground + runs[i] * floorH;
      const bottom = top - floorH;
      if (bottom <= 0 || top >= viewH) continue; // off screen
      const left = x0 + runs[i + 1] * tileW;
      const right = x0 + runs[i + 2] * tileW;
      if (right <= 0 || left >= viewW) continue;
      ctx.rect(left, top, right - left, bottom - top);
    }
  }
  // Each run lies inside the sky rect on screen, so even-odd cuts it out.
  ctx.clip("evenodd");
  return true;
}

/** Index of the first run on floor `floor` or above, by binary search over the
 *  floor-sorted shelter array (its length when every run is lower). */
export function firstRunAtOrAbove(runs: Int32Array, floor: number): number {
  let lo = 0;
  let hi = runs.length / RUN_STRIDE;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (runs[mid * RUN_STRIDE] < floor) lo = mid + 1;
    else hi = mid;
  }
  return lo * RUN_STRIDE;
}
