import { FACILITIES } from "./facilities";
import type { FacilityKind } from "./types";

/** Tunable economic constants (dollars), tuned to the 1994 SimTower balance. */
export const ECON = {
  startingMoney: 2_000_000,
  dailyTrafficIncome: {
    fastFood: 2_000,
    restaurant: 4_000,
    shop: 2_500,
    cinema: 8_000,
    partyHall: 3_000,
  } as Record<string, number>,
  /** Assumed average ticket per customer, used by the commercial-venue
   *  inspector to convert a venue's traffic income into a customer estimate
   *  (see `EconomySystem.collectTrafficIncome`). Cosmetic-only: the money loop
   *  never divides by these. The baseline count for the "Business is booming"
   *  tier is `dailyTrafficIncome[kind] / retailSpendPerCustomer[kind]`, so any
   *  retune here shifts customer readouts but never dollars.
   *  Typed as `Partial` so a lookup for a kind we haven't tabled reads
   *  `undefined` (not a spurious `number`), forcing every caller to guard
   *  before dividing. `src/tests/integration/canon.integration.test.ts` pins that every retail kind
   *  with a canon subtype list is tabled here. */
  retailSpendPerCustomer: {
    fastFood: 10,
    restaurant: 30,
    shop: 20,
  } as Partial<Record<string, number>>,
  maintenancePerCarMonthly: 600,
  /**
   * Meal-cadence origin weights (arch-tower-wide-meal-cadence-2026-07-09 §3).
   * Each eating population contributes meal-window trip options with this
   * multiplier on its per-floor count. Condo is 0.3 because most residents
   * cook at home; the rest are 1 so the code path stays uniform. The single
   * new tunable the meal-cadence feature added.
   */
  mealPopulationWeights: {
    office: 1.0,
    condo: 0.3,
    hotel: 1.0,
    staff: 1.0,
  },
  /** Cost to add one elevator car to a shaft. */
  addCarCost: 40_000,
  /** Monthly film-booking cost per cinema (canon: 150k average / 300k
   *  blockbuster). A blockbuster costs more but draws bigger crowds. */
  cinemaBookingMonthly: 150_000,
  cinemaBookingBlockbuster: 300_000,
  /** Cost to extend an elevator shaft by one floor (click or drag handle). */
  transportFloorCost: 5_000,
  /** Monthly property tax on an UNSOLD condo, as a fraction of its asking
   *  price. Gives premium pricing a real carrying cost — holding out for a
   *  higher sale costs money each month (and the higher the price, the more
   *  tax), so max-pricing is no longer a free, strictly-dominant choice. */
  condoMonthlyTaxRate: 0.015,
  /** Monthly operating overhead per leasable/operational income unit, charged on
   *  SPACE HELD regardless of occupancy or served-status (income stays charged on
   *  occupancy). A vacant or unserved floor thus becomes pure carrying cost — the
   *  soft transport-puzzle penalty the design review asked for — while a well-run
   *  tower stays hugely profitable (~a 20% haircut, self-scaling, never punitive). */
  overheadPerLeasableUnitMonthly: 700,
  /** Modern only. Base monthly probability that a sold condo's household
   *  relocates (a life event: a job move, an upsize or downsize), for a mean
   *  household of 3; `GameRules.condoRelocationChance` scales it UP with family
   *  size so bigger families are a bigger flight risk. At ~1.5% a condo turns
   *  over roughly once every ~5 in-game years on average: rare texture, not a
   *  treadmill. Classic never relocates a condo (its rule-set returns 0). */
  condoRelocationChanceMonthly: 0.015,
  /** Player-adjustable price ranges (per the original's rent dropdown). The
   *  `default` is what an un-set unit charges; income, move-in odds and tenant
   *  satisfaction all key off how far the chosen price sits from it. */
  rent: {
    office: { default: 10_000, min: 2_000, max: 20_000, step: 1_000 },
    // Condo sale price, anchored to the 1994 original's construction-cost
    // multiples: it sold at ~2× cost by default and could be held out to a ~2.5×
    // ceiling (higher price ⇒ slower to sell — a lever the move-in odds already
    // honor via `demand`). The floor sits at 1× cost (break-even) — the original
    // let you drop the price to sell fast, but never below what you paid to build
    // it. Condo build cost is $80k, so: min 1× = 80k, default 2× = 160k, max
    // 2.5× = 200k. (Keep these in step with FACILITIES.condo.cost.)
    condo: { default: 160_000, min: 80_000, max: 200_000, step: 10_000 },
    hotelSingle: { default: 90, min: 40, max: 200, step: 10 },
    hotelDouble: { default: 180, min: 80, max: 400, step: 20 },
    hotelSuite: { default: 500, min: 200, max: 1_000, step: 50 },
  } as Record<string, { default: number; min: number; max: number; step: number }>,
  serviceMaintenanceMonthly: {
    security: 2_000,
    medical: 5_000,
    housekeeping: 1_000,
    recycling: 4_000,
    metro: 8_000,
  } as Record<string, number>,
} as const;

/** Unit kinds whose price the player sets (and can batch-edit). */
export const PRICED_KINDS = ["office", "condo", "hotelSingle", "hotelDouble", "hotelSuite"] as const;

/** The price band for a unit kind, or null if its price isn't player-set. */
export function rentConfig(kind: string): { default: number; min: number; max: number; step: number } | null {
  return ECON.rent[kind] ?? null;
}

/** The effective price for a unit — the player's choice, or the kind default. */
export function rentOf(u: { kind: string; rent?: number; noRate?: boolean }): number {
  if (u.noRate) return 0; // off-market: charges nothing (SimTower "No Rate")
  return u.rent ?? ECON.rent[u.kind]?.default ?? 0;
}

/** Partial refund when a facility is sold or bulldozed — half its build cost.
 *  The single source of truth for the resale rule (shown in the editor and paid
 *  out by both the editor Sell button and the bulldoze tool). */
export function resaleRefund(kind: FacilityKind): number {
  return Math.floor(FACILITIES[kind].cost * 0.5);
}

/** Refund when an elevator car is removed — half the add-car cost, the same
 *  half-back rule as {@link resaleRefund}. */
export function carResaleRefund(): number {
  return Math.floor(ECON.addCarCost * 0.5);
}

/** One step of budget-clamped billing for an elevator extend drag. Given the
 *  shaft's current ends, the gesture's high-water mark, which end is being dragged
 *  and to where, the spendable money and the per-floor cost, returns the new ends
 *  (clamped to what the player can afford) plus the count of *new* floors — past
 *  the high-water mark — to bill for. A back-and-forth wiggle re-bills nothing. */
export function extendBill(
  cur: { bottom: number; top: number },
  hwm: { bottom: number; top: number },
  end: "up" | "down",
  targetFloor: number,
  money: number,
  perFloor: number,
): { nb: number; nt: number; added: number } {
  let nb = cur.bottom;
  let nt = cur.top;
  if (end === "up") nt = Math.max(cur.bottom + 1, targetFloor);
  else nb = Math.min(cur.top - 1, targetFloor);
  // Clamp at zero: in debt the budget is "no new floors", not a negative count
  // — a negative budget would pull the end BELOW the high-water mark and turn
  // an outward drag into a silent free shrink.
  const budgetFloors = Math.max(0, Math.floor(money / perFloor));
  if (nt > hwm.top) nt = hwm.top + Math.min(nt - hwm.top, budgetFloors);
  if (nb < hwm.bottom) nb = hwm.bottom - Math.min(hwm.bottom - nb, budgetFloors);
  const added = Math.max(0, nt - hwm.top) + Math.max(0, hwm.bottom - nb);
  return { nb, nt, added };
}

/** True for a unit kind that holds leasable/operational space and therefore
 *  carries monthly operating overhead: anything with a rent band
 *  (office/condo/hotel*) or a foot-traffic income line
 *  (shop/food/entertainment). Excludes pure service units (security/medical/…)
 *  which already pay `serviceMaintenanceMonthly` and aren't leasable inventory. */
export function isOverheadKind(kind: string): boolean {
  return rentConfig(kind) !== null || ECON.dailyTrafficIncome[kind] !== undefined;
}
