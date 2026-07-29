import { FACILITIES } from "./facilities";
import type { FacilityKind } from "./types";

/** Tunable economic constants (dollars), tuned to the 1994 SimTower balance. */
export const ECON = {
  startingMoney: 2_000_000,
  dailyTrafficIncome: {
    fastFood: 2_000,
    restaurant: 4_000,
    foodHall: 6_500,
    amusements: 4_500,
    boutiqueBay: 3_500,
    nightclub: 10_000,
    spa: 5_000,
    skyBar: 4_000,
    aquaticCenter: 7_000,
    daycare: 3_500,
    shop: 2_500,
    cinema: 8_000,
    partyHall: 3_000,
  } as Record<string, number>,
  /**
   * Classic-only headline daily takes, resolved through
   * {@link GameRules.commercialDailyIncome} (Modern reads `dailyTrafficIncome`
   * above, unchanged). Each value is the 1994 chart's TOP tier, read as the
   * sold-out ceiling: the demand-pool fraction and the live-attendance fill
   * then produce the lower tiers on their own, which lands a busy venue near
   * the chart's "normal" figures (fast food ~3k/day, restaurant ~6k/day).
   * Provenance (issue #572; #575 source sweep 2026-07-22). The TOP tiers below
   * are confirmed correct against the sources (fast food 5k, restaurant 10k,
   * shop 20k, cinema 10k, party hall 20k). The full tier breakdown, corrected
   * from an earlier misreading: fast food climbs 2k/3k/5k by customer count
   * (20-24 -> 2k, 25-49 -> 3k, 50+ -> 5k), plus an early/low-patronage LOSS the
   * engine has no mechanic for; restaurant is -6k/+4k/+10k by evaluation (the
   * 6k is a LOSS tier, not a positive middle; RO's "$6k/day normal" is a
   * separate normal-population average); shop 4k/10k/15k/20k by popularity (RO
   * confirms the 15k normal tier); cinema 0/2k/10k by performance; party hall
   * a flat 20k. All values trace to ONE lineage (BStuart FAQ -> RO -> Fandom,
   * not independent) and the manual is silent on them, so PROVISIONAL (see
   * #575); the demand-side calibration (whether `demandPerCapita` supplies
   * canon-normal income in a mid-size tower) stays on the row's playtest pass.
   */
  classicDailyTrafficIncome: {
    fastFood: 5_000,
    restaurant: 10_000,
    shop: 20_000,
    cinema: 10_000,
    partyHall: 20_000,
  } as Partial<Record<string, number>>,
  /** Assumed average ticket per customer, used by the commercial-venue
   *  inspector to convert a venue's traffic income into a customer estimate
   *  (see `EconomySystem.collectTrafficIncome`). Cosmetic-only: the money loop
   *  never divides by these. The baseline count for the "Business is booming"
   *  tier is `dailyTrafficIncome[kind] / retailSpendPerCustomer[kind]`, so any
   *  retune here shifts customer readouts but never dollars.
   *  Typed as `Partial` so a lookup for a kind we haven't tabled reads
   *  `undefined` (not a spurious `number`), forcing every caller to guard
   *  before dividing. Every demand-pool venue that carries a stall/subtype
   *  roster is tabled here: the canon retail kinds and the Modern-only footfall
   *  containers (Food Hall, Amusements, Boutique Bay) alike.
   *  `src/tests/integration/canon.integration.test.ts` pins the canon retail
   *  set; the Modern-only entries are covered by their own tests. */
  retailSpendPerCustomer: {
    fastFood: 10,
    restaurant: 30,
    foodHall: 25,
    amusements: 15,
    boutiqueBay: 20,
    nightclub: 30,
    spa: 40,
    skyBar: 35,
    daycare: 25,
    shop: 20,
  } as Partial<Record<string, number>>,
  /**
   * Modern "realistic" weekend traffic multipliers per demand-pool retail kind,
   * relative to the weekday baseline of 1.0 (weekend-patronage-curve, #398).
   * Modern reads the daily rhythm rather than the flat 1994 targets: a fast-food
   * counter lives on the weekday office-lunch crowd, so it QUIETS on weekends,
   * while restaurants and shops (leisure trade) pick up. Classic instead matches
   * the literal 1994 visitor targets (all retail busier on weekends), resolved in
   * `GameRules.weekendMultiplier`. Only the demand-pool retail kinds appear
   * here (the canon three plus the Modern-only Food Hall): attendance venues
   * (cinema, party hall) are deliberately left out,
   * because their take reads the live-attendance fill (#424), which the crowd
   * already spawns with its own weekday/weekend rhythm, so a flat multiplier on
   * top would double-count the weekend. The Modern-only footfall containers
   * (Food Hall, Amusements, Boutique Bay) each carry their own weekend swing here.
   * PROVISIONAL magnitudes, pending a playtest tuning pass. A kind absent here
   * reads 1.0 (no weekend swing).
   */
  weekendTrafficMultiplier: {
    fastFood: 0.7,
    restaurant: 1.35,
    foodHall: 1.25,
    amusements: 1.4,
    boutiqueBay: 1.3,
    nightclub: 1.5,
    spa: 1.4,
    skyBar: 1.45,
    daycare: 0.6,
    shop: 1.2,
  } as Partial<Record<string, number>>,
  /**
   * Rain crowd factor (weather-shapes-crowd, #430): the multiplier on the crowd
   * spawn rate on a rainy day, so rain thins the people actually out and about
   * rather than only firing a hidden income multiplier. A thinner crowd is what
   * drops an attendance venue's live fill (`customersIn`), so a rainy cinema now
   * earns less because fewer people show up, not because a bolt-on scalar fires
   * (the `rainMult` in `collectTrafficIncome` is dropped for attendance venues to
   * avoid double-counting; retail keeps it, since retail income is statistical and
   * does not read the drawn crowd). Classic matches the canon shopper hit (0.5, the
   * same magnitude as the retail `rainMult`); Modern softens (0.7). Non-rainy days
   * read 1.0 at the call site. Applied to the spawn accumulator, which already
   * scales by time-of-day and population and draws no RNG, so the seeded crowd
   * stream is unperturbed and a clear-day tower is byte-identical. Resolved through
   * {@link GameRules.rainCrowdFactor}. PROVISIONAL, wants a playtest tuning pass.
   */
  rainCrowdFactor: {
    classic: 0.5,
    modern: 0.7,
  },
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
  /**
   * Demographic-routine spawn weights (condo-demographic-routines, #397),
   * Modern-only via {@link GameRules.demographicRoutines} (Classic reads all
   * zeros and its crowd stream is untouched). Each weight is the probability
   * that the routine contributes one trip option to the weighted spawn pool
   * per spawn pass while its hour window is active (windows are the
   * SCHOOL_RUN_* / SALES_CALL_* constants in `sim/constants.ts`); a weight of
   * 1 or more contributes without an RNG draw, mirroring
   * {@link mealPopulationWeights}. `schoolRun` drives the condo morning
   * departure wave and its early-afternoon return wave; `salesCall` drives
   * occasional office midday round trips. Texture only: no income or
   * satisfaction hangs off these. PROVISIONAL magnitudes, pending a playtest
   * tuning pass.
   */
  demographicRoutineWeights: {
    schoolRun: 1.0,
    salesCall: 0.35,
  },
  /**
   * Commercial demand pools (gdd/arch-commercial-demand-pools-2026-07-15).
   * Per-capita daily demand dollars a weighted resident/worker spends across the
   * venues reachable to them. The tower's demand pool is this times the weighted,
   * connected census (reusing {@link mealPopulationWeights}), and each reachable
   * venue earns `min(1, pool / reachable-capacity)` of its headline daily figure
   * in place of the old tower-wide appeal scalar. PROVISIONAL calibration: 30
   * keeps a small, fully-connected tower close to the pre-change uniform appeal
   * (`0.35 + pop/8000`), so the swap conserves income near that point; the value
   * wants a playtest tuning pass before Classic parity is claimed.
   */
  demandPerCapita: 30,
  /**
   * Modern-only minimum per-venue demand fraction: a baseline of external,
   * street-level walk-in trade that does not depend on the tower's own
   * population, so a well-placed venue is not dead on arrival while the tower is
   * still filling. Classic uses 0 (a thin Classic tower genuinely starves
   * commercial, closer to 1994's placement pressure); Modern is more forgiving.
   * Resolved through {@link GameRules.demandModel}. PROVISIONAL, wants tuning.
   */
  demandFloorModern: 0.25,
  /**
   * Modern-only per-hour satisfaction erosion for a tenant whose reachable retail
   * coverage has fallen below `UNMET_DEMAND_EVICT_FLOOR` (leave-tower-unmet-demand,
   * #395; calibrated in #548). The full rate applies at coverage 0 and eases in
   * linearly from the evict floor, so it outruns `SERVED_RECOVERY` (0.05) only
   * below coverage ~0.20 (demand ~4.9x reachable retail). Pacing: a tenant at
   * 9x oversubscription drifts from its cap to notice over about a game day; a
   * fully starved coverage-0 tenant in about a third of one. Adding a reachable
   * shop lets either recover. At 0.12 this is the steepest slow drain in the
   * game (above NOISE_EROSION 0.07), which is why `dominantGripe` hands the
   * NOISE tiers (the W2 band and the nightclub halo) to unmet demand when it is
   * the steeper active erosion (#548). The transport-far and lobby-far tiers
   * still rank above it unconditionally; that wider reattribution question
   * belongs to the vacate-cause-reattribution row (#550). Classic never erodes
   * for unmet demand (it caps only).
   */
  unmetDemandErosion: 0.12,
  /** Cost to add one elevator car to a shaft. */
  addCarCost: 40_000,
  /** Monthly film-booking cost per cinema (canon: 150k average / 300k
   *  blockbuster). A blockbuster costs more but draws bigger crowds. */
  cinemaBookingMonthly: 150_000,
  cinemaBookingBlockbuster: 300_000,
  /** Monthly DJ booking a Modern nightclub pays, its cinema-style carrying cost
   *  (a flat fee, no policy/RNG). Charged in `payMaintenance` on top of the
   *  operating overhead, so a poorly-attended club runs at a loss. */
  nightclubDjMonthly: 40_000,
  /** Modern-only Sky Bar "view premium" (gdd-modern-expansion): the higher a
   *  rooftop bar sits, the more it earns, because the skyline view is the draw.
   *  Its income multiplier is 1 at or below `skyBarViewBaseFloor`, then climbs
   *  `skyBarViewPerFloor` per floor above it, capped at `1 + skyBarViewMax`. So a
   *  bar on the base floor pours at par and one far above it pours up to
   *  `1 + skyBarViewMax` times as much. Resolved through `GameRules.viewPremium`
   *  (Classic returns a flat 1: it has no Sky Bar). Only the Sky Bar reads it, so
   *  no other venue's income and no golden-master hash is touched. */
  skyBarViewBaseFloor: 10,
  skyBarViewPerFloor: 0.02,
  skyBarViewMax: 1.0,
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
  /** Modern only. Flat call-out fee for a tower-wide exterminator dispatch that
   *  clears cockroach infestations. Charged once per dispatch on top of the
   *  per-room fee below, so treating a single room is never free. */
  exterminatorCalloutFee: 5000,
  /** Modern only. Exterminator fee per infested room, charged at dispatch time.
   *  Tuned so a small outbreak is cheaper to exterminate (and keeps the room
   *  earning) while a big neglected wing tilts toward bulldozing: the crossover
   *  is the decision. Classic has no exterminator (infestation is bulldoze-only,
   *  1994 parity). */
  exterminatorPerRoomFee: 2000,
  /** Modern only. Base monthly probability that a sold condo's household
   *  relocates (a life event: a job move, an upsize or downsize), for a mean
   *  household of 3; `GameRules.condoRelocationChance` scales it UP with family
   *  size so bigger families are a bigger flight risk. At ~1.5% a condo turns
   *  over roughly once every ~5 in-game years on average: rare texture, not a
   *  treadmill. Classic never relocates a condo (its rule-set returns 0). */
  condoRelocationChanceMonthly: 0.015,
  /** Modern only. Fraction of last-night-occupied hotel rooms held past the
   *  morning checkout as a late checkout, so the guest is present through the
   *  daytime meal windows and takes a lunch trip (#304). At 0.2 roughly one room
   *  in five lingers to lunch: enough that a big hotel earns a midday murmur a
   *  pure office tower does not, small enough to stay a texture rather than a
   *  second population. Classic holds none (its rule-set returns 0). PROVISIONAL,
   *  wants a playtest tuning pass. */
  hotelDaytimePresence: 0.2,
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
    // Modern-only Fitness Club membership dues, collected on the quarterly rent
    // cadence like an office (a smaller lease than a full office floor). Modern
    // never charges a Classic tower this: the kind is modernOnly.
    fitnessClub: { default: 6_000, min: 2_000, max: 12_000, step: 1_000 },
    // Modern-only Clinic lease, the same quarterly cadence, smaller still (an
    // 8-wide quiet tenant).
    clinic: { default: 4_000, min: 1_500, max: 8_000, step: 500 },
    // Modern-only rental living, collected MONTHLY (not quarterly like the office)
    // via EconomySystem.collectMonthlyRent. The Studio is the cheap forgiving
    // on-ramp; the Apartment pays more but its picky tenant erodes on an over-high
    // rent (the office's over-market erosion). Modern never charges Classic these.
    rentalStudio: { default: 2_000, min: 1_000, max: 3_000, step: 250 },
    // default:max = 1:2 like the office, so gouging the demanding Apartment to the
    // top of the band nets negative against the served recovery and eventually
    // evicts (the GDD's "rent too high"); the forgiving Studio's narrower ratio
    // never nets negative ON ITS OWN, so a gouged Studio in an otherwise fine spot
    // only sours. Rent is additive with the other drains rather than max'd with
    // them, so a band-max Studio beside a noisy neighbor DOES leave, and sooner
    // than a condo would. That is the rent tier working, and `dominantGripe`
    // names rent first, so the cause reads honestly.
    rentalApartment: { default: 4_000, min: 3_000, max: 8_000, step: 500 },
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
export const PRICED_KINDS = ["office", "condo", "hotelSingle", "hotelDouble", "hotelSuite", "fitnessClub", "clinic", "rentalStudio", "rentalApartment"] as const;

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
