import { FACILITIES } from "./facilities";
import { ECON } from "./econConfig";
import type { RNG } from "./rng";
import type { GameMode } from "./types";

/**
 * Rule-set strategy: the ONE place Classic and Modern behavior diverge.
 *
 * Every rule the two modes disagree on lives behind the {@link GameRules}
 * interface, with a self-contained implementation per mode ({@link CLASSIC_RULES},
 * {@link MODERN_RULES}). The simulation holds a `readonly rules` chosen once at
 * tower creation and calls `this.rules.<x>()` — it never branches on the mode
 * string itself, so mode-specific *logic* can never smear across the engine as
 * scattered `if (mode === "modern")` conditionals. Adding a future Modern
 * divergence means adding a method here and its two implementations, not hunting
 * call sites.
 *
 * Data-driven accessors that already read the RIGHT answer from unit state
 * regardless of mode (e.g. `residentCount`, which returns a condo's household or
 * the flat catalog value) deliberately stay OUT of this interface — they're not
 * decisions that differ by mode, just reads of data the rules produced.
 */

/** The flat household the 1994 game (and Classic mode) gives every condo. */
const CLASSIC_HOUSEHOLD = FACILITIES.condo.population; // 3

/**
 * Modern "variant households": the family sizes a condo can sell to and their
 * weights. Centered so the mean is EXACTLY the classic 3 — a Modern tower's
 * condo population matches a Classic one's on average, only varying unit to unit
 * — with 3 the clear mode. INVARIANT: keep the implied mean at 3 so Modern never
 * silently inflates or deflates the star-rating ladder relative to Classic.
 */
const HOUSEHOLD_SIZES = [2, 3, 4, 5] as const;
const HOUSEHOLD_WEIGHTS = [4, 6, 2, 1] as const; // mean = (2·4+3·6+4·2+5·1)/13 = 39/13 = 3.0

/** A bigger family leans harder on the tower — access/congestion/noise bite a
 *  5-person household more than a 2-person one. Per person away from the classic 3. */
const HOUSEHOLD_CHURN_PER_PERSON = 0.06;

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A condo's price for a given household — the asking `base` scaled by household
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

export interface GameRules {
  /** The mode this rule-set implements (mirrors {@link GameMode}). */
  readonly mode: GameMode;
  /** True when condos house variable-size families — gates variant-household UI
   *  and readouts. */
  readonly hasVariantHouseholds: boolean;
  /**
   * Decide a condo's household and sale price the moment it sells. Classic sells
   * to the flat family of 3 at the asking price (no household stored); Modern
   * draws a 2–5 person family from `rng` and scales the price by its size.
   */
  sellCondo(base: number, rng: RNG): { price: number; residents: number | undefined };
  /**
   * Sanitize a persisted household on load. Classic strips it entirely (its
   * condos MUST read the flat 3, so a forged household can't perturb the census);
   * Modern clamps a present value into the real generator band (2–5).
   */
  coerceResidents(raw: unknown): number | undefined;
  /**
   * Multiplier on a condo's NEGATIVE satisfaction pressures (access/congestion),
   * never on recovery. 1 is neutral. Classic is always 1 (its condos are
   * uniform); Modern sharpens for big families and softens slightly for small.
   */
  churnMultiplier(residents: number | undefined): number;

  // ---- The Modern "deeper economy" layer -------------------------------------
  // Three mechanics the 1994 original never had, added (gdd-economy-depth,
  // gdd-tenant-churn) to fight the original's late-game money trivialization.
  // They are Modern-only: Classic returns the neutral value so a Classic tower is
  // pixel-faithful (money genuinely trivializes late, exactly as in 1994).

  /** Monthly operating overhead charged per HELD leasable/operational unit
   *  (a carrying cost on vacant/unserved space). Modern: the tuned value;
   *  Classic: 0. */
  operatingOverheadPerUnit(): number;
  /** Monthly property-tax rate on an UNSOLD condo, as a fraction of its asking
   *  price. Modern: the tuned rate; Classic: 0. */
  condoHoldTaxRate(): number;
  /** Scale on the office-noise satisfaction EROSION that can evict a tenant.
   *  Modern: 1 (erosion active). Classic: 0, so noise only CAPS satisfaction at
   *  the ceiling and never erodes below it (canon "office noise caps but never
   *  evicts"). */
  noiseErosionScale(): number;
  /**
   * Monthly probability that a SOLD condo's household relocates on its own (a
   * life event unrelated to how well the tower serves it), scaled UP with family
   * size so a bigger family is a bigger flight risk. Modern: the tuned per-month
   * chance. Classic: 0 (1994 condos never turn over). Callers MUST short-circuit
   * on a 0 return BEFORE drawing from the RNG, so a Classic tower's seeded stream
   * stays byte-identical (Classic never rolls). `residents` undefined is treated
   * as the mean household of 3. */
  condoRelocationChance(residents: number | undefined): number;
}

export const CLASSIC_RULES: GameRules = {
  mode: "classic",
  hasVariantHouseholds: false,
  sellCondo(base) {
    // Flat family of 3, sold at the asking price — no household stored, so the
    // census reads the catalog 3. Never touches the RNG, so a Classic tower's
    // seeded office/event stream is exactly what it was before variant households.
    return { price: base, residents: undefined };
  },
  coerceResidents() {
    return undefined;
  },
  churnMultiplier() {
    return 1;
  },
  // Classic is pixel-faithful: none of the Modern economy sinks apply.
  operatingOverheadPerUnit() {
    return 0;
  },
  condoHoldTaxRate() {
    return 0;
  },
  noiseErosionScale() {
    return 0; // noise caps satisfaction but never erodes/evicts (canon)
  },
  condoRelocationChance() {
    return 0; // 1994 condos never turn over; a sold Classic condo is forever
  },
};

export const MODERN_RULES: GameRules = {
  mode: "modern",
  hasVariantHouseholds: true,
  sellCondo(base, rng) {
    const residents = rollHousehold(rng);
    return { price: householdPrice(base, residents), residents };
  },
  coerceResidents(raw) {
    if (raw === undefined) return undefined;
    return Math.max(
      HOUSEHOLD_SIZES[0],
      Math.min(HOUSEHOLD_SIZES[HOUSEHOLD_SIZES.length - 1], Math.round(isFiniteNum(raw) ? raw : CLASSIC_HOUSEHOLD)),
    );
  },
  churnMultiplier(residents) {
    if (residents === undefined) return 1;
    // Clamped positive so it can only ever soften or sharpen the drain, never
    // flip its sign (dead for the legal 2–5 band; a guard if the band widens).
    return Math.max(0.5, 1 + HOUSEHOLD_CHURN_PER_PERSON * (residents - CLASSIC_HOUSEHOLD));
  },
  // Modern runs the deeper-economy sinks at their tuned values.
  operatingOverheadPerUnit() {
    return ECON.overheadPerLeasableUnitMonthly;
  },
  condoHoldTaxRate() {
    return ECON.condoMonthlyTaxRate;
  },
  noiseErosionScale() {
    return 1;
  },
  condoRelocationChance(residents) {
    // Scale the base monthly chance by family size relative to the classic 3, so
    // a 5-person family is a clearly bigger flight risk than a 2-person one (and
    // the departing pool skews big, which drives the self-scaling turnover sink:
    // you buy back 4s/5s while re-sales regress toward the mean of 3). A condo
    // with no household reads as the mean 3, so the scale is exactly 1.
    const size = residents ?? CLASSIC_HOUSEHOLD;
    return ECON.condoRelocationChanceMonthly * (size / CLASSIC_HOUSEHOLD);
  },
};

/** Draw a Modern condo's household size (2–5, weighted toward 3) from the
 *  gameplay RNG, so it's deterministic and reproduces across save/reload. */
function rollHousehold(rng: RNG): number {
  const total = HOUSEHOLD_WEIGHTS.reduce((a, b) => a + b, 0);
  let roll = rng.int(1, total);
  for (let i = 0; i < HOUSEHOLD_SIZES.length; i++) {
    roll -= HOUSEHOLD_WEIGHTS[i];
    if (roll <= 0) return HOUSEHOLD_SIZES[i];
  }
  return CLASSIC_HOUSEHOLD; // unreachable; the classic 3 as a safety net
}

/** The rule-set for a mode. Both are stateless singletons (pure behavior), so a
 *  tower just holds a reference; nothing per-sim to construct. */
export function makeRules(mode: GameMode): GameRules {
  return mode === "modern" ? MODERN_RULES : CLASSIC_RULES;
}
