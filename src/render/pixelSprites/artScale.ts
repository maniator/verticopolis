import { TILE } from "../scale";

/**
 * The room-art scale seam, split out of `common.ts` so both stay under the
 * line ceiling.
 *
 * Furniture inside these rooms is written as pixel literals against a TILE 11
 * by FLOOR 44 world, the same reference footprint `sprites/facilities/
 * serviceKit` records for the service sprites. The world moved to TILE 10 by
 * FLOOR 45, so a room of the same tile width is about 9% narrower in pixels
 * while the room itself did not shrink. Layouts that counted how many chairs,
 * cabinets, or customers fit straight off the screen width therefore tied
 * capacity to the tile instead of to the room, and several quietly lost a slot:
 * occupants who were present stopped being drawn at all (issue #813). The
 * helpers below count in the authored scale, so capacity follows the room's
 * width in tiles, and step in the current one, so the row still fits inside the
 * room box. The price is that a row packs about 9% tighter than it was drawn:
 * the items keep their authored size and lose some of the air between them.
 */

/** The tile the room art was authored against. A literal on purpose: it is
 *  history, and pinning it to the live TILE would erase the very drift these
 *  helpers exist to absorb. Exported so a test can state a room's capacity in
 *  authored units instead of restating 11 of its own. */
export const ART_TILE = 11;

/** A screen length restated at the authored tile. Pass a room's width to ask how
 *  much room that is in the scale its furniture was drawn for. */
export function artUnits(screenLength: number): number {
  return (screenLength * ART_TILE) / TILE;
}

/** An authored length restated on screen. Fractional on purpose: callers round
 *  the finished coordinate, so a row keeps an even pitch instead of collecting a
 *  rounding error at every step. */
export function screenLength(authoredLength: number): number {
  return (authoredLength * TILE) / ART_TILE;
}

/**
 * Integer anchors for one row of repeated furniture.
 *
 * `authoredRun` is how much room the row has measured in AUTHORED pixels: the
 * container it sits in (the room, or a counter or mat or table inside it) less
 * the row's own margins, all in the scale the art was drawn at. `from` is the
 * first anchor on screen, `limit` the furthest one an item may take, and `dir`
 * the way the row fills. `pitch` is the authored step.
 *
 * How many fit is decided entirely by that authored run, because an item and the
 * clearance around it are fixed-size pixel art and only the container grew when
 * the tile shrank. That ties capacity to the container's width in tiles, which
 * the scale change did not touch. The step is then the pitch at the current
 * tile, or tighter when the row would otherwise not fit, so an anchor never
 * passes `limit`.
 *
 * The authored run is passed in rather than worked back out of the screen
 * geometry on purpose. Every caller knows it exactly, while re-deriving it from
 * a screen width that has already been rounded loses a fraction of a pixel, and
 * a row whose authored run divides exactly by its pitch loses a whole slot to
 * that fraction. A 24-tile nightclub was one dancer short for precisely this
 * reason.
 *
 * Returns no anchors when nothing fits: a `limit` that has crossed `from` means
 * the room is too narrow for the row, which is a real case for the preview pages
 * that render rooms at their own sizes. The screen run binds at that end, so a
 * row with authored room but no pixels seats nobody rather than an item that
 * would hang out of the box.
 *
 * Anchors are integers, so a run under a pixel wide is served by a single
 * column: with fractional ends the first anchor can sit up to half a pixel
 * outside the run, which is the ordinary cost of drawing pixel art at a
 * fractional offset and not a containment failure at any whole-pixel caller.
 */
export function artRow(authoredRun: number, from: number, limit: number, pitch: number, dir: 1 | -1 = 1): number[] {
  const run = dir * (limit - from); // screen pixels the row may occupy
  if (!(pitch > 0) || !(run >= 0) || !(authoredRun >= 0)) return []; // nothing fits (NaN included)
  // The epsilon keeps a slot that lands exactly on a boundary. Callers that own
  // a whole room hand in an exact integer, but one measured off a proportion of
  // a fractional width can arrive as 161.99999999999997, and losing a seat to
  // that is the bug this helper exists to prevent.
  const wanted = Math.floor(authoredRun / pitch + 1e-9) + 1;
  // Two anchors cannot share a pixel, so the screen run bounds the count as
  // well: a room whose margins eat all of it seats one item, not the several its
  // authored width would otherwise allow. Both the integer columns between the
  // ends AND the run itself are needed. With fractional ends `first` rounds
  // while `edge` floors, so the column window can come out one wider than the
  // run really is, and a row that overran it repeated its last anchor: two
  // people drawn on one pixel, reading as one, which is this bug again.
  const edge = dir > 0 ? Math.floor(limit) : Math.ceil(limit);
  const first = Math.round(from);
  const lo = Math.min(first, edge);
  const hi = Math.max(first, edge);
  const count = Math.max(1, Math.min(wanted, hi - lo + 1, Math.floor(run) + 1));
  const step = count > 1 ? Math.min(screenLength(pitch), run / (count - 1)) : 0;
  return Array.from({ length: count }, (_, i) =>
    Math.min(hi, Math.max(lo, Math.round(from + dir * i * step))));
}

