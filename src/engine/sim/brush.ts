import type { Simulation } from "../Simulation";
import { INVALID_REQUEST, whole } from "../request";
import { withLobbyUpgrades } from "../tower/removal";

/** The kinds the brush lays: plain floor and lobby. */
export type BrushKind = "floor" | "lobby";

/** How many tiles the brush laid, and the last refusal reason a build gave. */
export interface BrushResult {
  readonly placed: number;
  readonly reason?: string;
}

/** The most tiles one brush may carry. The web's brush sends 8
 *  (`STRUCTURE_BRUSH`); the port refuses more with the same limit
 *  (`MAX_BRUSH_TILES` in `src/simport/request.ts`, pinned to this one). */
export const BRUSH_TILE_LIMIT = 32;

/**
 * The floor and lobby brush: `build(kind, floor, x)` over the brush's tiles,
 * the same builds in the same order as laying them one at a time, so the
 * brush charges, logs and reports exactly as those builds do. One engine call,
 * so no step runs between its tiles. `engine-rs/src/brush.rs` is the Rust twin.
 *
 * Each pass walks `tiles` in order and skips a tile that already carries
 * `kind`, or any structure when the brush is not a lobby brush (a lobby brush
 * upgrades plain floor in place, the sky-lobby conversion). Passes repeat while
 * one laid something, so a tile refused for want of support is tried again
 * once its neighbor stands. `tiles` may repeat a column (the brush clamps at
 * the lot edge): once the first copy is laid the repeat finds its kind there
 * and is skipped, and a refused column is simply tried again, as the same
 * builds issued one by one would be.
 *
 * A lobby laid over plain floor takes the tile's place in the unit list,
 * and what the brush placed moves to the end of the list in one pass at the
 * end (`withLobbyUpgrades`), where laying them one at a time would make a
 * pass per tile.
 *
 * A kind other than floor or lobby, a floor or tile that is not a whole
 * number, or more than {@link BRUSH_TILE_LIMIT} tiles lays nothing and
 * answers `INVALID_REQUEST`.
 */
export function paintBrush(sim: Simulation, kind: BrushKind, floor: number, tiles: readonly number[]): BrushResult {
  const xs = wholeTiles(tiles);
  if ((kind !== "floor" && kind !== "lobby") || !whole(floor) || !xs) return { placed: 0, reason: INVALID_REQUEST };
  return withLobbyUpgrades(sim.tower, () => {
    let placed = 0;
    let reason: string | undefined;
    let progress = true;
    while (progress) {
      progress = false;
      for (const tx of xs) {
        const existing = sim.tower.structureKindAt(floor, tx);
        if (existing === kind || (existing !== undefined && kind !== "lobby")) continue;
        const r = sim.build(kind, floor, tx);
        if (r.ok) {
          placed++;
          progress = true;
        } else {
          reason = r.reason;
        }
      }
    }
    return reason === undefined ? { placed } : { placed, reason };
  });
}

/** A copy of `tiles` when it is an array of at most {@link BRUSH_TILE_LIMIT}
 *  whole numbers, read once by index (so a hole counts as a bad tile), or
 *  undefined. */
function wholeTiles(tiles: unknown): number[] | undefined {
  if (!Array.isArray(tiles) || tiles.length > BRUSH_TILE_LIMIT) return undefined;
  const xs: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const x: unknown = tiles[i];
    if (!whole(x)) return undefined;
    xs.push(x);
  }
  return xs;
}
