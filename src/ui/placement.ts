import { FACILITIES, GRID } from "../engine/facilities";
import type { FacilityKind } from "../engine/types";

/**
 * Placement geometry and announce copy for the build tools — pure functions of
 * (kind, tile, floor) split out of the GameApp class so the tool semantics can
 * be unit-tested without a DOM game shell or a running engine. Every gesture
 * path (mouse, touch, keyboard cursor) funnels through these, so pinning them
 * here pins all three.
 */

/** Tiles laid by a single tap/click of the Floor/Lobby tool (a drag extends). */
export const STRUCTURE_BRUSH = 8;

/** A tile clamped to the lot's buildable columns. */
export function clampTile(x: number): number {
  return Math.max(0, Math.min(GRID.width - 1, x));
}

/** True when a raw (pre-clamp) tile falls outside the buildable lot. Every
 *  gesture clamps such a click onto the edge column before the engine sees it,
 *  so this predicate is the only place that still knows the player aimed past
 *  the line; the build path uses it to say so instead of a silent no-op. */
export function isOffLot(tile: number): boolean {
  return tile < 0 || tile >= GRID.width;
}

/** The placement column for `kind` at `tile`: shifted left just enough that
 *  the facility's full width stays inside the lot, so a wide room dropped
 *  near the right edge places instead of failing. */
export function snapX(kind: FacilityKind, tile: number): number {
  const w = FACILITIES[kind].width;
  return Math.max(0, Math.min(GRID.width - w, tile));
}

/** The tiles a single floor/lobby tap paints — a strip centered on the
 *  cursor, clamped to the lot. Shared by the placement and its preview so the
 *  shadow always matches what a click lays down. */
export function brushTiles(tile: number): number[] {
  const half = Math.floor(STRUCTURE_BRUSH / 2);
  const tiles: number[] = [];
  for (let d = -half; d < STRUCTURE_BRUSH - half; d++) tiles.push(clampTile(tile + d));
  return tiles;
}

/** The cells a floor/lobby drag fills between the last painted tile and the
 *  pointer: every lot column after `anchor` through `target`, ordered outward
 *  from the anchor so each cell is adjacent to already-built structure. Empty
 *  when the pointer hasn't left the anchor column. Endpoints are clamped up
 *  front and each column emitted once, so a pointer flung far off the lot
 *  costs O(lot width), not O(pointer distance) of repeated edge tiles. */
export function dragRunTiles(anchor: number, target: number): number[] {
  const step = target >= anchor ? 1 : -1;
  const from = clampTile(anchor);
  const to = clampTile(target);
  if (from === to && anchor !== target) {
    // The whole run collapsed onto one clamped column (the drag lives beyond
    // the lot edge) — still attempt that edge column once.
    return [to];
  }
  const tiles: number[] = [];
  for (let x = from + step; x !== to + step; x += step) tiles.push(x);
  return tiles;
}

/** A keyboard build-cursor cell (lot column + floor). */
export interface CursorCell {
  tile: number;
  floor: number;
}

/** The keyboard cursor after a move: `from` stepped by (dTile, dFloor) and
 *  clamped to the grid. A null `from` starts from mid-lot on the ground floor
 *  (the first press just reveals the cursor there). */
export function stepCursor(from: CursorCell | null, dTile: number, dFloor: number): CursorCell {
  const c = from ?? { tile: Math.floor(GRID.width / 2), floor: 1 };
  return {
    tile: Math.max(0, Math.min(GRID.width - 1, c.tile + dTile)),
    floor: Math.max(GRID.minFloor, Math.min(GRID.maxFloor, c.floor + dFloor)),
  };
}

/** Outcome of a gesture-independent placement (paint a structure strip, drop
 *  a fixed two-floor flight, or place a room). `reason` carries the engine's
 *  explanation when it gave one; paint reports "already built here" through
 *  the same channel. */
export type PlaceOutcome =
  | { what: "paint"; ok: boolean; reason?: string }
  | { what: "flight"; ok: boolean; reason: string }
  | { what: "room"; ok: boolean };

/** The screen-reader line for a committed placement: success names the
 *  facility and where it landed; failure prefers the engine's reason (e.g.
 *  "Not enough money." or "Floor already built here") and falls back to a
 *  generic can't-place line when the engine didn't say why. */
export function announceForPlacement(placed: PlaceOutcome, kind: FacilityKind, floor: number): string {
  const name = FACILITIES[kind].name;
  return placed.what === "paint"
    ? placed.ok
      ? `Placed ${name} on floor ${floor}`
      : (placed.reason ?? `Can't place ${name} here`)
    : placed.what === "flight"
      ? placed.ok
        ? `${name} built, floors ${floor} to ${floor + 1}`
        : placed.reason
      : placed.ok
        ? `Placed ${name}`
        : `Can't place ${name} here`;
}
