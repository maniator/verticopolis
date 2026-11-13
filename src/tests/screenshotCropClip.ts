/**
 * The crop rectangle for a shot that shows one element (`shot.crop`).
 *
 * An element's box rarely starts on a whole pixel: a dialog centered with
 * `margin: auto` sits half a pixel down whenever the leftover height is odd.
 * A locator screenshot rounds that box outward, so its first and last rows
 * and columns are a blend of the element's edge and whatever is painted
 * behind it. For a dialog that is the dimmed, blurred tower, which is not
 * the same from one run to the next, and the shot's bytes moved with it
 * (02f-dropped-report-notice, one run in three under load).
 *
 * Rounding inward instead keeps only pixels the element covers
 * completely, so a crop shot holds nothing but its element.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The largest rectangle of whole CSS pixels inside `box`. Whole CSS pixels
 *  because a fractional clip is widened back out to whole CSS pixels when the
 *  page is captured (an element screenshot does the same to its box), which
 *  would bring the half-covered edge back; a whole CSS pixel is a whole device
 *  pixel at every scale the gallery renders. Throws when the element is too
 *  small to keep one pixel, since an empty crop would capture nothing and pass. */
export function wholePixelClip(box: Box): Box {
  // A box edge computed by layout can land a hair off a whole pixel through
  // float error (12.000000001); treat those as whole so a box that already
  // sits on whole pixels keeps its full size.
  const snap = (v: number) => {
    const r = Math.round(v);
    return Math.abs(v - r) < 1e-6 ? r : v;
  };
  const left = Math.ceil(snap(box.x));
  const top = Math.ceil(snap(box.y));
  const right = Math.floor(snap(box.x + box.width));
  const bottom = Math.floor(snap(box.y + box.height));
  if (right <= left || bottom <= top) throw new Error(`crop box ${JSON.stringify(box)} covers no whole pixel`);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
