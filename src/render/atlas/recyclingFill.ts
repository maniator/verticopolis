import { recyclingLook, type RecyclingLook } from "../sprites/facilities/recyclingLook";

/**
 * Every fill at which the recycling center's picture changes: a bag joins the
 * pile, a gauge row lights, the pile stacks past half full, the gauge turns
 * amber past 0.7, and red with FULL at 1. Between two breaks the art reads the
 * same look (`recyclingLook`), so it paints the same pixels; the atlas bakes
 * one chain step per break and a frontend that counts the breaks at or below
 * its fill draws the game's exact pile.
 *
 * Each break is the smallest double whose look differs from the look just
 * below it, so `fill >= break` is exactly the art's own test, rounding
 * included (`> 0.7` becomes the next double above 0.7).
 */

function sameLook(a: RecyclingLook, b: RecyclingLook): boolean {
  return a.bags === b.bags && a.stacked === b.stacked && a.amber === b.amber && a.full === b.full && a.gaugeRows === b.gaugeRows;
}

const view = new DataView(new ArrayBuffer(8));

/** A non-negative double's bit pattern, which orders as the number does. */
function bitsOf(x: number): bigint {
  view.setFloat64(0, x);
  return view.getBigUint64(0);
}

function numberOf(bits: bigint): number {
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

/** The smallest fill above `from` (in 0..1) whose look differs from the look
 *  at `from`, or null when none does. Every part of the look only grows with
 *  the fill, so the fills that differ form one run up to 1 and a binary
 *  search over the doubles finds where it starts. */
function nextBreak(from: number): number | null {
  const look = recyclingLook(from);
  if (sameLook(recyclingLook(1), look)) return null;
  let same = bitsOf(from);
  let differs = bitsOf(1);
  while (differs - same > 1n) {
    const mid = (same + differs) / 2n;
    if (sameLook(recyclingLook(numberOf(mid)), look)) same = mid;
    else differs = mid;
  }
  return numberOf(differs);
}

/** The breaks in ascending order. */
export function recyclingFillBreaks(): number[] {
  const out: number[] = [];
  for (let at = nextBreak(0); at !== null; at = nextBreak(at)) out.push(at);
  return out;
}

/** The exact chain's input for a fill: how many breaks it has reached. A fill
 *  is clamped to 0..1 and a non-finite one read as 0, as the art reads it. */
export function recyclingFillStep(breaks: readonly number[], rawFill: number): number {
  const fill = Number.isFinite(rawFill) ? Math.max(0, Math.min(1, rawFill)) : 0;
  let n = 0;
  while (n < breaks.length && breaks[n] <= fill) n++;
  return n;
}
