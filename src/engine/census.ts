import type { Unit } from "./types";
import { FACILITIES } from "./facilitiesData";
import { isCommercialKind } from "./facilityPredicates";

/**
 * The number of people a unit contributes to the population census, the SINGLE
 * seam every "how many live/work here" count routes through (total population,
 * star-rating census, per-floor congestion). Almost always the kind's flat
 * catalog `population`; the one exception is a Modern-mode condo that sold to a
 * variable-size household, which carries its own `residents`. Classic towers and
 * every pre-variant save leave `residents` undefined and so read the flat value,
 * keeping their numbers byte-identical. Take a partial so callers can pass a
 * bare `{kind, residents}` without a full Unit.
 */
export function residentCount(u: Pick<Unit, "kind"> & { residents?: number }): number {
  // Gate the override on condos: `residents` is only ever a condo household, so
  // a forged save that stamps it on an office can't inflate that office's head
  // count. Everything else, and any condo without a household set, reads the
  // flat catalog population.
  if (u.kind === "condo" && u.residents !== undefined) return u.residents;
  return FACILITIES[u.kind].population;
}

/**
 * A unit's contribution to the population census and to population-driven
 * demand models (v2 spatial congestion). Commercial venues contribute their
 * LIVE customer tally (`customersIn`, 0 when nobody is eating), never the
 * catalog population; the `population > 0` gate keeps cinema (commercial,
 * catalog 0) out entirely. Everything else contributes {@link residentCount}.
 * One seam on purpose: Tower.totalPopulation, Simulation.occupantPopulation,
 * and Simulation.spatialCongestionByFloor must never drift apart on this rule.
 */
export function censusCount(
  u: Pick<Unit, "kind"> & { residents?: number; customersIn?: number },
): number {
  if (isCommercialKind(u.kind) && FACILITIES[u.kind].population > 0) return u.customersIn ?? 0;
  return residentCount(u);
}

/**
 * Star-rating population thresholds, the canonical 1994 values
 * (300 / 1,000 / 5,000 / 10,000). From 4★ up the rating counts non-hotel
 * occupants: office workers, condo residents, and live commercial venue
 * customers (see {@link censusCount}); hotel guests drop out. The lot is the
 * canon 375 tiles wide so a well-zoned tower holds well over 15,000 of those,
 * keeping the canonical 10,000 (5★) and 15,000 (TOWER) genuinely reachable.
 */
export const STAR_THRESHOLDS: Record<number, number> = {
  1: 0,
  2: 300,
  3: 1000,
  4: 5000,
  5: 10000,
};

/**
 * Population needed for the final TOWER rating (above 5 stars). The census
 * counts office workers, condo residents, and LIVE commercial venue customers
 * (`customersIn` via {@link censusCount}; the catalog values, fast food 25 /
 * restaurant 35 / shop 20, are what TDT export writes, not a flat census add);
 * hotel guests count while climbing up through 4★, then drop out. The canonical
 * value is 15,000. The lot is the canon 375 tiles wide so a well-zoned 100-floor
 * tower comfortably reaches it (with express + banded locals).
 */
export const TOWER_POPULATION = 15000;

/**
 * Waste-management balance (canon: the FAQ's "Recycle Center … fills daily;
 * required for 4★" means DEMAND MET, not merely built). One operational center
 * processes this much population's daily garbage; beyond it the centers
 * overflow, the 4★ gate closes and commercial appeal sags. 2,500/center makes
 * the canonical ladder demand 2 centers by 4★ (5,000 pop), 4 by 5★ (10,000)
 * and 6 by TOWER (15,000), the original's "keep adding them as you grow".
 */
export const RECYCLING_POP_PER_CENTER = 2500;

/** Hour of the daily garbage-truck collection that empties every center.
 *  Pre-dawn, like the original, you see the truck if you're watching early. */
export const GARBAGE_COLLECT_HOUR = 5;

/** Office workers one functional parking space serves (canon: offices demand
 *  parking from 3★). The 1994 original asks for one space per **four offices**;
 *  an office holds 6 workers, so one space serves 24 workers. Shared by the
 *  move-in penalty, the UI and the tests. */
export const PARKING_WORKERS_PER_SPACE = 24;
