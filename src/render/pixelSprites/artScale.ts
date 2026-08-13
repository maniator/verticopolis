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
 * width in tiles, while the step stays the authored pitch in screen pixels. An
 * item is fixed-size pixel art that did not shrink with the tile, so the space
 * between items must not shrink either: scaling the pitch spends the gap the
 * art was drawn with, and a row authored shoulder to shoulder (the nightclub's
 * dancers, whose 6px figures sit at a 6px pitch) has no gap to spend and comes
 * out overlapping. A row still compresses when its run genuinely cannot hold it,
 * which is the honest last resort rather than the default.
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
 * the scale change did not touch.
 *
 * The step is that same pitch in SCREEN pixels, no longer scaled down with the
 * tile. Scaling it spent the gap the art was drawn with, since the item did not
 * shrink and only the space between items can absorb the difference, and a row
 * authored shoulder to shoulder had no gap to spend. Read the arithmetic
 * plainly, though: a caller that measures `authoredRun` across the same span it
 * hands to `from` and `limit` gives the row about 10/11 of the screen its
 * authored count needs, so `run / (count - 1)` binds and the row still
 * compresses to roughly the old step. THAT IS THE COMMON CASE and the pitch is
 * an upper bound, not a promise. What changed is that compression is now
 * bounded by the room the row actually has, so a caller that can give the row
 * more screen (the nightclub, whose crowd runs on past the lit dance floor)
 * reaches the full authored pitch instead of being held under it.
 *
 * `minStep` is the item's own width, when the caller knows it. Compression has
 * to stop somewhere, and the honest floor is the point where items would start
 * drawing through each other: below it a row is not tighter, it is wrong. Pass
 * it and the count drops instead, which only bites where the run physically
 * cannot hold the authored count without stacking. Omit it and the row may
 * compress without limit, which is safe for a row whose items are narrower than
 * their pitch by a comfortable margin.
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
export function artRow(authoredRun: number, from: number, limit: number, pitch: number, dir: 1 | -1 = 1, minStep = 0): number[] {
  if (!(pitch > 0) || !(dir * (limit - from) >= 0) || !(authoredRun >= 0)) return []; // nothing fits (NaN included)
  // The epsilon keeps a slot that lands exactly on a boundary. Callers that own
  // a whole room hand in an exact integer, but one measured off a proportion of
  // a fractional width can arrive as 161.99999999999997, and losing a seat to
  // that is the bug this helper exists to prevent.
  const wanted = Math.floor(authoredRun / pitch + 1e-9) + 1;
  // Two anchors cannot share a pixel, so the screen run bounds the count as
  // well: a room whose margins eat all of it seats one item, not the several its
  // authored width would otherwise allow.
  //
  // Both ends move INWARD to the first whole pixel the row may occupy, and the
  // run is what lies between them. Every anchor is rounded to a pixel, so those
  // integers are the row, and measuring the run any other way states room the
  // row does not have: rounding the near end outward while flooring the far one
  // inward buys a column the pixels do not contain, and the row answers with a
  // count it can only fit by stepping tighter than the pitch. At a half-pixel
  // room origin that put the club's dancers back through each other, which is
  // the defect this helper exists to prevent. Whole-pixel callers, which is
  // every one in the game (a room's origin is `tile * TILE`), are unaffected:
  // rounding an integer inward returns it.
  const edge = dir > 0 ? Math.floor(limit) : Math.ceil(limit);
  const first = dir > 0 ? Math.ceil(from) : Math.floor(from);
  // Moving both ends inward can cross them, which means no whole pixel lies in
  // the run at all (`from` and `limit` inside one pixel of each other). That is
  // one item at the nearest pixel, never two anchors sharing it.
  const span = dir * (edge - first);
  const run = Math.max(0, span);
  const start = span >= 0 ? first : Math.round(from);
  // A row may not compress past the width of the thing it repeats. Without this
  // the count is honored at any cost and the items simply overlap, which is the
  // defect in a different coat: the nightclub's dancers, whose count comes off
  // the dance floor while their run is measured to the DJ booth, stack from
  // about 360px of room upward.
  const holds = minStep > 0 ? Math.floor(run / minStep) + 1 : Infinity;
  const count = Math.max(1, Math.min(wanted, run + 1, holds));
  const step = count > 1 ? Math.min(pitch, run / (count - 1)) : 0;
  const lo = Math.min(start, edge);
  const hi = Math.max(start, edge);
  return Array.from({ length: count }, (_, i) =>
    Math.min(hi, Math.max(lo, Math.round(start + dir * i * step))));
}

