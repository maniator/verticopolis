import { FACILITIES } from "./facilities";
import { ECON } from "./econConfig";
import {
  LOBBY_FAR_FLOORS,
  LOBBY_VERY_FAR_FLOORS,
  LOBBY_FAR_CAP,
  LOBBY_VERY_FAR_CAP,
  LOBBY_VERY_FAR_EROSION,
  LOBBY_NO_DRAIN,
} from "./sim/constants";
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
  /** True when the build preview surfaces the refusal reason on hover (Modern
   *  pedagogy: hover, read, understand, then click). Classic is pixel-faithful:
   *  clicks refuse with a toast, the player learns by doing. Purely a UI gate;
   *  this flag itself never changes what the engine accepts or refuses. */
  readonly showsPreviewReason: boolean;
  /** True when an escalator may land on a floor that holds an office. The 1994
   *  game restricts escalators to commercial space (its players even bulldozed
   *  offices around a landing to sneak one in), so Classic keeps the refusal;
   *  Modern drops the restriction and lets escalators serve office floors. */
  readonly allowsEscalatorOnOfficeFloors: boolean;
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
   * Sanitize a persisted No-Rate (off-market) flag on load. Classic preserves a
   * real flag, hardened so only a literal `true` survives (a forged non-boolean
   * cannot park a unit at $0). Modern NEVER holds the No-Rate state, so it
   * coerces the flag away entirely (a forged Modern save loads on-market).
   */
  coerceNoRate(raw: unknown): boolean | undefined;
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
  /**
   * Commercial demand model magnitudes (gdd/arch-commercial-demand-pools). The
   * split SHAPE is identical in both modes (otherwise Classic is not reproducing
   * the classic game, and cross-venue cannibalization only holds when each venue
   * earns the plain `min(1, share)` below the cap: any per-venue curve that lifts
   * the fraction above the identity would let total delivered demand exceed the
   * pool as venues are added, breaking conservation). Only these magnitudes differ.
   * `perCapita` is the daily demand dollars per weighted resident/worker (shared by
   * both modes today; a Modern retune for larger-tower viability is reserved for the
   * calibration pass); `floor` is the minimum per-venue demand fraction (a
   * small-tower assist) and is where the two modes actually diverge now: Classic is
   * firmer (floor 0: a thin tower starves commercial), Modern keeps a gentle floor
   * of external street-level walk-in trade. Provisional magnitudes, pending a
   * calibration pass.
   */
  demandModel(): { perCapita: number; floor: number };
  /**
   * Graduated "far from a (sky)lobby" satisfaction pressure (#394), keyed on the
   * tenant's floor-distance to the nearest lobby. Returns the satisfaction CEILING
   * (`cap`, 1 = no penalty) and the per-hour `erosion` to apply in the shared
   * placement-erosion step. Both modes use the same anchors and band values
   * (`LOBBY_*` in `sim/constants`); they differ only in SHAPE: Classic snaps to
   * the two discrete bands (near / far / very-far), Modern eases the ceiling and
   * the erosion in continuously with each floor of distance (and shows the live
   * distance in the inspector). `cap < 1` means the tenant is capped; the
   * very-far tier (`cap <= GRIPE_WARN`) is the one that also erodes and can
   * eventually evict, attributed to the `lobbyFar` cause. Applies to
   * office/condo/hotel; the caller gates on `served` and kind.
   */
  lobbyDistanceDrain(distanceFloors: number): { cap: number; erosion: number };
  /**
   * Per-kind weekday/weekend traffic multiplier for the demand-pool retail venues
   * (#398), 1.0 on a weekday. Classic matches the literal 1994 visitor targets
   * (retail busier on weekends); Modern reads a realistic daily rhythm (fast food
   * quiets without the office-lunch crowd, restaurants and shops pick up), tuned
   * by `ECON.weekendTrafficMultiplier`. Only the demand-pool retail kinds swing:
   * attendance venues (cinema, party hall) read 1.0 here, because their income
   * already tracks the live-attendance fill (#424), which the crowd spawns with
   * its own weekday/weekend rhythm; a flat multiplier would double-count. A `kind`
   * outside the retail set reads 1.0. Pure and deterministic (no RNG), so it never
   * perturbs the seeded economy stream.
   */
  weekendMultiplier(kind: string, isWeekend: boolean): number;
}

/** Classic 1994 weekend traffic multipliers per demand-pool retail kind, relative
 *  to the weekday baseline. The original settles fast food and restaurants at 35
 *  weekday / 48 weekend and shops at 25 / 30 (all busier on weekends), so Classic
 *  reads those ratios. Attendance venues (cinema, party hall) are not listed: their
 *  weekend swing is emergent from live attendance (#424), not a flat scalar. */
const CLASSIC_WEEKEND_MULT: Partial<Record<string, number>> = {
  fastFood: 48 / 35,
  restaurant: 48 / 35,
  shop: 30 / 25,
};

export const CLASSIC_RULES: GameRules = {
  mode: "classic",
  hasVariantHouseholds: false,
  showsPreviewReason: false, // canon-faithful pedagogy: click-to-refuse, learn by doing
  allowsEscalatorOnOfficeFloors: false, // canon: escalators link commercial floors only
  sellCondo(base) {
    // Flat family of 3, sold at the asking price — no household stored, so the
    // census reads the catalog 3. Never touches the RNG, so a Classic tower's
    // seeded office/event stream is exactly what it was before variant households.
    return { price: base, residents: undefined };
  },
  coerceResidents() {
    return undefined;
  },
  coerceNoRate(raw) {
    return raw === true ? true : undefined; // preserve a real flag; only true counts
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
  demandModel() {
    // Firm: no small-tower floor, so thin Classic towers genuinely starve
    // commercial (closer to 1994's placement pressure).
    return { perCapita: ECON.demandPerCapita, floor: 0 };
  },
  lobbyDistanceDrain(distanceFloors) {
    // Two discrete canon bands, snapping at the edges: near (no penalty), far (a
    // ceiling), very far (a lower ceiling plus the gentle erosion). The very-far
    // edge sits just past the mid-block distance of a 15-floor lobby ladder, so a
    // tower lobbied every 15 caps its mid-block floors but never force-evicts them;
    // only a skipped sky lobby pushes floors into the evicting very-far band.
    if (distanceFloors > LOBBY_VERY_FAR_FLOORS) return { cap: LOBBY_VERY_FAR_CAP, erosion: LOBBY_VERY_FAR_EROSION };
    if (distanceFloors > LOBBY_FAR_FLOORS) return { cap: LOBBY_FAR_CAP, erosion: 0 };
    return LOBBY_NO_DRAIN;
  },
  weekendMultiplier(kind, isWeekend) {
    // Canon: every commercial kind is busier on the weekend (the literal 1994
    // visitor targets), quiet on weekdays.
    return isWeekend ? (CLASSIC_WEEKEND_MULT[kind] ?? 1) : 1;
  },
};

export const MODERN_RULES: GameRules = {
  mode: "modern",
  hasVariantHouseholds: true,
  showsPreviewReason: true, // Modern surfaces refusal reasons on the invalid preview
  allowsEscalatorOnOfficeFloors: true, // Modern lifts the commercial-only escalator rule
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
  coerceNoRate() {
    return undefined; // Modern never holds the No-Rate state (roadmap seam law)
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
  demandModel() {
    // Gentle: a baseline of external street-level walk-in trade keeps a
    // well-placed venue alive while the tower's own population is still thin.
    return { perCapita: ECON.demandPerCapita, floor: ECON.demandFloorModern };
  },
  lobbyDistanceDrain(distanceFloors) {
    // A smooth continuous ramp over the same anchors instead of two snapping
    // bands: the ceiling eases from 1.0 at the far threshold down to the very-far
    // cap, and the erosion eases in past the very-far threshold, both reaching the
    // Classic band values a couple floors beyond the very-far edge. So each extra
    // floor of distance costs a little more (the inspector shows the live
    // distance), and a well-sky-lobbied Modern tower, whose mid-block floors sit at
    // most `lobbyInterval / 2` from a lobby, only ever feels the gentle ceiling,
    // never the evicting erosion; that stays reserved for genuine isolation (a tall
    // tower with no sky lobby). Modern smooths and helps.
    if (distanceFloors <= LOBBY_FAR_FLOORS) return LOBBY_NO_DRAIN;
    const capSpan = LOBBY_VERY_FAR_FLOORS + 2 - LOBBY_FAR_FLOORS;
    const capT = Math.min(1, (distanceFloors - LOBBY_FAR_FLOORS) / capSpan);
    const cap = 1 - capT * (1 - LOBBY_VERY_FAR_CAP);
    const eroT = Math.max(0, Math.min(1, (distanceFloors - LOBBY_VERY_FAR_FLOORS) / 2));
    return { cap, erosion: eroT * LOBBY_VERY_FAR_EROSION };
  },
  weekendMultiplier(kind, isWeekend) {
    // Realistic daily rhythm: fast food quiets on the weekend (its weekday
    // office-lunch crowd is gone), while leisure venues pick up. Tuned via ECON.
    return isWeekend ? (ECON.weekendTrafficMultiplier[kind] ?? 1) : 1;
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
