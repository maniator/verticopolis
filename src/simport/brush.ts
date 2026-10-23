import type { FacilityKind } from "../engine/types";
import type { BrushKind } from "./commands";

/** One build's answer, as the engines give it. */
export interface BrushBuild {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * The floor and lobby brush (the `paintBrush` command): `build(kind, floor,
 * x)` over the brush's tiles, the same builds in the same order on every
 * adapter, so the brush charges, logs and reports exactly as those builds do.
 *
 * Each pass walks `tiles` in order and skips a tile that already carries
 * `kind`, or any structure when the brush is not a lobby brush (a lobby brush
 * upgrades plain floor in place, the sky-lobby conversion). Passes repeat while
 * one laid something, so a tile refused for want of support is tried again
 * once its neighbor stands. `tiles` may repeat a column (the brush clamps at
 * the lot edge); the repeat finds its kind already there and is skipped.
 *
 * Returns how many tiles were laid and the last refusal reason the engine
 * gave, if any. A `tiles` that is not an array lays nothing (a malformed
 * request; the web never sends one). An adapter calls this inside one
 * command, so no step runs between the tiles.
 */
export function runBrush(
  kind: BrushKind,
  floor: number,
  tiles: ReadonlyArray<number>,
  structureKindAt: (floor: number, x: number) => "floor" | "lobby" | undefined,
  build: (kind: FacilityKind, floor: number, x: number) => BrushBuild,
): { placed: number; reason?: string } {
  let placed = 0;
  let reason: string | undefined;
  let progress = Array.isArray(tiles);
  while (progress) {
    progress = false;
    for (const tx of tiles) {
      const existing = structureKindAt(floor, tx);
      if (existing === kind || (existing !== undefined && kind !== "lobby")) continue;
      const r = build(kind, floor, tx);
      if (r.ok) {
        placed++;
        progress = true;
      } else {
        reason = r.reason;
      }
    }
  }
  return reason === undefined ? { placed } : { placed, reason };
}
