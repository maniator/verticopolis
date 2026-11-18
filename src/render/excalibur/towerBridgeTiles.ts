import * as ex from "excalibur";
import { FLOOR, TILE } from "../scale";
import type { SkyBridgeView } from "../../simport/view";
import { drawBridgeTile, drawsBridgeLook, type BridgePart } from "../sprites/structure/skyBridge";

/**
 * The sky bridge tiles of the structure pass (Modern): which lobby cells are a
 * bridge in a drawn look and where each sits on its bridge, and the shared
 * baked canvas for each look, lighting, place and part. Each bridge is drawn
 * as one picture (its art is spaced to the span), so a tile's canvas depends
 * on its place `i` on an `n`-tile bridge. The canvases are pure functions of
 * their key, so one cache serves every tower and every scene; a bridge in the
 * plain lobby look keeps the lobby tile.
 */

/** A bridge tile in a drawn look: the look's name, the tile's place on its
 *  bridge from the left (0 up) and the bridge's span in tiles. */
export interface BridgeCell {
  readonly name: string;
  readonly i: number;
  readonly n: number;
}

const baked = new Map<string, ex.Canvas>();

/** The empty look map of a tower that has no bridges to read (Classic). */
export const NO_BRIDGE_LOOKS: ReadonlyMap<number, BridgeCell> = new Map();

/** Each bridge tile drawn in a look, keyed by {@link bridgeCellKey}. Built
 *  once per full structure pass from the view's bridges, a handful of runs. */
export function bridgeLookCells(bridges: readonly SkyBridgeView[], looks: readonly string[] | undefined): Map<number, BridgeCell> {
  const cells = new Map<number, BridgeCell>();
  if (!looks) return cells;
  for (const b of bridges) {
    const name = looks[b.look];
    if (name === undefined || !drawsBridgeLook(name)) continue;
    const n = b.to - b.from;
    for (let x = b.from; x < b.to; x++) cells.set(bridgeCellKey(b.floor, x), { name, i: x - b.from, n });
  }
  return cells;
}

/** The key of a cell in {@link bridgeLookCells}: a lot is far narrower than
 *  the multiplier, so floor and column never collide. */
export function bridgeCellKey(floor: number, x: number): number {
  return floor * 65_536 + x;
}

/** The baked canvas of bridge tile `cell` for this lighting: its own story
 *  (`deck`) or the underside in the open-air cell below it (`under`). */
export function bridgeTileGfx(cell: BridgeCell, lit: boolean, part: BridgePart = "deck"): ex.Canvas {
  const { name, i, n } = cell;
  const key = `${name}|${lit ? 1 : 0}|${i}|${n}|${part}`;
  let gfx = baked.get(key);
  if (!gfx) {
    gfx = new ex.Canvas({ width: TILE, height: FLOOR, cache: true, draw: (ctx) => drawBridgeTile(ctx, name, i, n, lit, TILE, FLOOR, part) });
    baked.set(key, gfx);
  }
  return gfx;
}
