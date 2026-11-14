/**
 * Pure presentation logic for an elevator car's on-cab indicators, split out
 * from the canvas drawing so the *policy* (how a car's live state maps to what
 * the player sees) is unit-tested independently of any rendering.
 */

export type CarArrow = "up" | "down" | null;

export interface CarIndicator {
  /** Riders to draw: one figure per person who walked into the cab, up to as
   *  many as it has room for (`cabFit`), so the line that boards is the crowd
   *  in the cab (#2116). The car's load never adds figures (3.7.3). */
  riders: number;
  /** Direction lantern: which way the car is moving, or null when idle. */
  arrow: CarArrow;
  /** True once the car is at (or over) capacity — drives the FULL sign. */
  full: boolean;
}

/** The pixel step between riders packed into a full cab, and the margin
 *  `drawCar` keeps clear at each side of the cab. */
export const RIDER_STEP = 3;
const CAB_MARGIN = 8;

/** How many rider figures a cab `cabWidth` pixels wide has room for. */
export function cabFit(cabWidth: number): number {
  if (!Number.isFinite(cabWidth) || cabWidth <= CAB_MARGIN) return 0;
  return Math.floor((cabWidth - CAB_MARGIN) / RIDER_STEP) + 1;
}

/**
 * Map an elevator car's live state to its cab indicators.
 * @param dir  −1 descending, 0 idle, +1 ascending
 * @param load the engine's car load (the traffic model's head count), for FULL
 * @param cap  car capacity
 * @param fit  rider figures the cab has room for (`cabFit`)
 * @param aboard people the crowd shows boarding this car (`countCabRiders`)
 */
export function carIndicator(dir: number, load: number, cap: number, fit: number, aboard: number): CarIndicator {
  // Treat any non-finite input as a safe default so a stray NaN can never leak
  // into a cache key or the draw call.
  const validCap = Number.isFinite(cap) && cap > 0;
  const safeLoad = Number.isFinite(load) ? Math.max(0, load) : 0;
  const safeDir = Number.isFinite(dir) ? dir : 0;
  const room = Number.isFinite(fit) ? Math.max(0, Math.floor(fit)) : 0;
  const riders = Number.isFinite(aboard) ? Math.min(room, Math.max(0, Math.floor(aboard))) : 0;
  let arrow: CarArrow = null;
  if (safeDir > 0) arrow = "up";
  else if (safeDir < 0) arrow = "down";
  const full = validCap && safeLoad >= cap;
  return { riders, arrow, full };
}
