import { FACILITIES } from "./facilities";
import type { RNG } from "./rng";

/**
 * The condo HOUSEHOLD layer of the rule-set seam: family sizes, the weighted
 * Modern draw, and the household-scaled price shared by sale and buy-back.
 * Split out of `gameRules.ts` the same way the pricing shape layer lives in
 * `./pricing`; `gameRules` re-exports the public pieces so consumers keep one
 * import path for the seam.
 */

/** The flat household the 1994 game (and Classic mode) gives every condo. */
export const CLASSIC_HOUSEHOLD = FACILITIES.condo.population; // 3

/**
 * Modern "variant households": the family sizes a condo can sell to and their
 * weights. Centered so the mean is EXACTLY the classic 3 (a Modern tower's
 * condo population matches a Classic one's on average, only varying unit to
 * unit), with 3 the clear mode. INVARIANT: keep the implied mean at 3 so Modern never
 * silently inflates or deflates the star-rating ladder relative to Classic.
 */
export const HOUSEHOLD_SIZES = [2, 3, 4, 5] as const;
const HOUSEHOLD_WEIGHTS = [4, 6, 2, 1] as const; // mean = (2·4+3·6+4·2+5·1)/13 = 39/13 = 3.0

/** A bigger family leans harder on the tower: access/congestion/noise bite a
 *  5-person household more than a 2-person one. Per person away from the classic 3. */
export const HOUSEHOLD_CHURN_PER_PERSON = 0.06;

/**
 * A condo's price for a given household: the asking `base` scaled by household
 * size relative to the classic 3. A condo with no household (Classic, or any
 * unsold unit) is exactly the base. Shared by the sale AND the buy-back so the
 * repurchase always mirrors what the unit sold for. Pure and mode-agnostic: it
 * reads the household off the data, so both rule-sets and the buy-back path can
 * call it without knowing the mode.
 */
export function householdPrice(base: number, residents: number | undefined): number {
  if (residents === undefined) return base;
  return Math.round((base * residents) / CLASSIC_HOUSEHOLD);
}

/** Draw a Modern condo's household size (2–5, weighted toward 3) from the
 *  gameplay RNG, so it's deterministic and reproduces across save/reload. */
export function rollHousehold(rng: RNG): number {
  const total = HOUSEHOLD_WEIGHTS.reduce((a, b) => a + b, 0);
  let roll = rng.int(1, total);
  for (let i = 0; i < HOUSEHOLD_SIZES.length; i++) {
    roll -= HOUSEHOLD_WEIGHTS[i];
    if (roll <= 0) return HOUSEHOLD_SIZES[i];
  }
  return CLASSIC_HOUSEHOLD; // unreachable; the classic 3 as a safety net
}
