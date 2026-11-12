import type { CatalogNoise } from "../../catalog/catalogTypes";
import type { TowerView } from "../../simport/view";
import { FLOOR, TILE } from "../scale";
import type { RingView } from "./towerHaloRings";

/**
 * How far a room's same-floor noise reaches, painted on its floor while it is
 * being placed (Modern, #1980): a band out from each edge as far as the
 * catalog's `noise` says, stopped where the engine's scan stops, at a lobby
 * tile or a gap in the floor. Violet shows where the room's own noise carries,
 * amber where it hears its noisy neighbors. Classic publishes no noise reach,
 * so nothing is painted there.
 */

/** The tiles the walk reads: the same lookups the engine's scan makes. */
export type NoiseTiles = Pick<TowerView, "unitAt" | "hasStructure" | "structureKindAt">;

/** How many tiles out from each edge of the room at `x` (width `width`) on
 *  `floor` the noise can travel before a lobby or a gap, up to `limit`. One
 *  walk of at most `limit` tiles each way, a few binary searches per tile
 *  and no allocation: `unitAt` is asked only where there is no structure,
 *  so it finds a room or nothing and never builds a tile view. */
export function openTiles(tower: NoiseTiles, floor: number, x: number, width: number, limit: number): { left: number; right: number } {
  const walk = (start: number, dir: -1 | 1): number => {
    let n = 0;
    while (n < limit) {
      const at = start + dir * n;
      if (tower.structureKindAt(floor, at) === "lobby") break;
      if (!tower.hasStructure(floor, at) && !tower.unitAt(floor, at)) break;
      n++;
    }
    return n;
  };
  return { left: walk(x - 1, -1), right: walk(x + width, 1) };
}

const CARRIES_COLOR = "#a46ad8";
const HEARS_COLOR = "#e0a040";
const BAND_ALPHA = 0.22;

/** Paint `noise`'s reach around the room at `x` (width `width`) whose
 *  lowest floor is `floor` and which stands `floors` stories tall. Its noise
 *  carries on every story it fills, as the engine's scan finds a room on any
 *  story it covers; it hears only on its lowest, where the scan walks. */
export function drawNoiseReach(
  ctx: CanvasRenderingContext2D,
  noise: readonly CatalogNoise[],
  room: { floor: number; floors: number; x: number; width: number },
  tower: NoiseTiles,
  view: RingView,
): void {
  if (noise.length === 0) return;
  // A source `tiles` tiles out from the edge still counts, so a band spans
  // `tiles + 1` tiles each way; one walk per story covers the widest of them.
  let limit = 0;
  for (const n of noise) limit = Math.max(limit, n.tiles + 1);
  const h = FLOOR * view.cam.zoom;
  const tile = TILE * view.cam.zoom;
  ctx.lineWidth = 1.5;
  for (let story = 0; story < room.floors; story++) {
    const floor = room.floor + story;
    const felt = (n: CatalogNoise): boolean => n.role === "carries" || story === 0;
    if (!noise.some(felt)) continue;
    const open = openTiles(tower, floor, room.x, room.width, limit);
    const y = view.worldToScreenY(floor);
    let [outerLeft, outerRight] = [0, 0];
    for (const n of noise) {
      if (!felt(n)) continue;
      const left = Math.min(n.tiles + 1, open.left);
      const right = Math.min(n.tiles + 1, open.right);
      outerLeft = Math.max(outerLeft, left);
      outerRight = Math.max(outerRight, right);
      ctx.fillStyle = n.role === "carries" ? CARRIES_COLOR : HEARS_COLOR;
      ctx.globalAlpha = BAND_ALPHA;
      if (left > 0) ctx.fillRect(view.worldToScreenX(room.x - left), y, left * tile, h);
      if (right > 0) ctx.fillRect(view.worldToScreenX(room.x + room.width), y, right * tile, h);
    }
    ctx.globalAlpha = 1;
    if (outerLeft + outerRight === 0) continue;
    ctx.strokeStyle = noise.some((n) => felt(n) && n.role === "carries") ? CARRIES_COLOR : HEARS_COLOR;
    ctx.setLineDash([6, 4]);
    const from = view.worldToScreenX(room.x - outerLeft);
    ctx.strokeRect(from + 0.5, y + 0.5, (outerLeft + room.width + outerRight) * tile - 1, h - 1);
    ctx.setLineDash([]);
  }
}
