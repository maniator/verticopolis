/**
 * Pure camera-bounds math, split out from the Excalibur-bound {@link TowerEngine}
 * so it can be unit-tested without a canvas/WebGL context.
 */

/**
 * Clamp the camera's vertical *center* so the visible window stays within the
 * meaningful world — from a little sky above the top floor down to just past the
 * deepest buildable basement. Crucially it accounts for zoom: it bounds the
 * visible top/bottom *edges*, not the center, so zooming or panning out can
 * never reveal empty void below the ground (you can't build below the basement
 * limit, so there is nothing down there to show).
 *
 * World Y grows downward and floor `f` sits at `y = -f * floorPx`, so the top of
 * the world (highest floor) is the most-negative Y and basements are positive Y.
 *
 * @param desiredY   the camera-center Y the player is trying to move to; a
 *                   non-finite value falls back to the world midpoint
 * @param viewHeight viewport height in screen pixels
 * @param zoom       camera zoom (screen pixels per world pixel); non-positive or
 *                   non-finite values fall back to 1 so the result stays finite
 * @param floorPx    height of one floor in world pixels
 * @param minFloor   deepest buildable floor (e.g. -9 for B10)
 * @param maxFloor   highest buildable floor
 */
export function clampCameraY(
  desiredY: number,
  viewHeight: number,
  zoom: number,
  floorPx: number,
  minFloor: number,
  maxFloor: number,
): number {
  // Guard against a zero/negative/NaN zoom so half-height (and the result) can
  // never become Infinity/NaN, regardless of what a caller passes.
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const halfH = viewHeight / 2 / safeZoom;
  const topY = -(maxFloor + 2) * floorPx; // a little sky above the top floor
  const bottomY = -(minFloor - 2) * floorPx; // ~2 floors of dirt below the basement

  // If the whole world is shorter than the viewport (very zoomed out), pin the
  // ground to the bottom of the screen and let sky fill the rest, rather than
  // letting the tower float over empty void.
  if (bottomY - topY <= 2 * halfH) return bottomY - halfH;

  // Normalize a non-finite target (NaN/Infinity) to the world midpoint so the
  // Math.min/Math.max below can't propagate NaN — the result is always finite.
  const target = Number.isFinite(desiredY) ? desiredY : (topY + bottomY) / 2;
  // Keep the visible window inside [topY, bottomY].
  return Math.max(topY + halfH, Math.min(bottomY - halfH, target));
}

/** A little sky above the tower's top floor at the fully-fit zoom, so the roof
 *  isn't jammed against the status bar when you pinch all the way out. */
export const FIT_SKY_FLOORS = 6;

/** Smallest span the fit zoom pretends the tower has. Two jobs: it stops an
 *  empty or tiny tower from dividing by ~0 (which would let the fit zoom out to
 *  nothing and fling the camera), and it gives a short starter tower comfortable
 *  framing instead of an ocean of empty sky. */
export const MIN_FIT_SPAN_FLOORS = 24;

/** The fit floor never rises ABOVE this, so zooming out always does something.
 *  Without it, a tiny tower on a tall viewport (a tablet in portrait) could
 *  compute a fit zoom above the resting zoom and lock the player out of zooming
 *  out at all. Past this the tower already fits with room to spare, so any
 *  further pull-back is pure overview and safe to allow. */
export const MAX_FIT_ZOOM = 0.6;

/**
 * The most-zoomed-out (smallest) zoom the camera should reach for a tower of a
 * given built span: far enough that the whole tower plus a breath of sky fits
 * the viewport, but never so far that a short tower drifts into empty void, and
 * never so restrictive that a small tower can't zoom out at all.
 *
 * This is the tower-aware GESTURE floor the renderer layers on top of the fixed
 * trust-boundary floor (`VIEW_ZOOM_MIN`). It computes the limit from the world
 * the way {@link clampCameraY} does, rather than hardcoding a single number that
 * fits every tower badly.
 *
 * @param viewHeight viewport height in screen pixels; a non-positive or
 *                   non-finite value falls back to 1 so the result stays finite
 * @param spanFloors built tower height in floors (top built floor minus bottom
 *                   built floor, basements included); values below
 *                   {@link MIN_FIT_SPAN_FLOORS} (or non-finite) are lifted to it
 * @param floorPx    height of one floor in world pixels
 * @param hardFloor  the absolute minimum zoom (the trust-boundary floor); the
 *                   result is never below this
 */
export function fitZoom(viewHeight: number, spanFloors: number, floorPx: number, hardFloor: number): number {
  const safeH = Number.isFinite(viewHeight) && viewHeight > 0 ? viewHeight : 1;
  const span = Math.max(MIN_FIT_SPAN_FLOORS, Number.isFinite(spanFloors) ? spanFloors : 0);
  const framed = (span + FIT_SKY_FLOORS) * floorPx; // world height to fit on screen
  const z = safeH / framed;
  // Keep the fit floor inside [hardFloor, MAX_FIT_ZOOM]: never below the hard
  // floor (so a pathological span can't underflow), never above the ceiling (so
  // a small tower on a tall screen can still be zoomed out).
  return Math.max(hardFloor, Math.min(MAX_FIT_ZOOM, z));
}
