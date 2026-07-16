import { FACILITIES } from "./facilities";
import { ECON, PRICED_KINDS } from "./econConfig";
import {
  LOBBY_FAR_FLOORS,
  LOBBY_VERY_FAR_FLOORS,
  LOBBY_FAR_CAP,
  LOBBY_VERY_FAR_CAP,
  LOBBY_VERY_FAR_EROSION,
  LOBBY_NO_DRAIN,
  UNMET_DEMAND_FLOOR,
  UNMET_DEMAND_CAP,
  UNMET_DEMAND_EVICT_FLOOR,
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

// ---- The Classic/Modern pricing split (gdd-classic-modern-pricing-roadmap §1-2) --

/** One rung of the Classic 4-level rent ladder. `level` doubles as the 1994
 *  TDT rent-class byte (0 Very Low … 3 High; byte 4 is the No Rate sentinel,
 *  carried by the ladder shape itself, not a fifth rung). */
export interface PriceRung {
  readonly level: 0 | 1 | 2 | 3;
  readonly label: "Very Low" | "Low" | "Average" | "High";
  readonly value: number;
}

/**
 * What a mode offers the player for pricing a rentable kind. The consumers
 * (editor, batch dialog, price choke point) switch on the SHAPE of this value,
 * never on the mode string, per the rule-set law above:
 *   - `ladder`: the Classic discrete 4-rung dropdown plus the No Rate
 *     off-market sentinel (`noRate: true` says the mode offers that state);
 *   - `band`: Modern's continuous `{min, default, max, step}` range,
 *     driving the existing stepper/range editors.
 * Both shapes are frozen module-level singletons, so reading them on a
 * per-unit path allocates nothing.
 */
export type PriceOptions =
  | { readonly shape: "ladder"; readonly rungs: readonly PriceRung[]; readonly noRate: true }
  | {
      readonly shape: "band";
      readonly band: { readonly default: number; readonly min: number; readonly max: number; readonly step: number };
    };

/**
 * The Classic canon rent ladders, dollars per kind in rung order
 * (Very Low / Low / Average / High).
 *
 * Provenance (record honestly, GDD §2 / epics AR5): the rent-class STRUCTURE
 * (one 4-level dropdown plus No Rate, TDT byte 0-4) comes from the
 * reverse-engineered TDT docs (docs/canon/tdt-format.md §4). The DOLLAR tables
 * come from the Relentless Optimizer fan reference, a SINGLE source (the
 * archive.org SimTower manual was unfetchable); verify each table against the
 * manual if it becomes readable. Classic uses the FULL canon values by the
 * owner's call of 2026-07-08.
 */
const CLASSIC_RENT_LADDERS: Readonly<Partial<Record<string, readonly [number, number, number, number]>>> = {
  // Office, quarterly. HARD confidence: matches our band anchors; 2k/10k
  // corroborated. (Relentless Optimizer; verify against the manual if readable.)
  office: [2_000, 5_000, 10_000, 15_000],
  // Condo, one-time sale (locked after it sells). MED confidence: a 40k-vs-50k
  // minimum stays unresolved; 50k until verified. Classic MAY list below the
  // $80k build cost (canon firesale); Modern keeps its break-even floor.
  // (Relentless Optimizer; verify against the manual if readable.)
  condo: [50_000, 100_000, 150_000, 200_000],
  // Hotel single, nightly. SOFT confidence, single-source, ~10x our old band;
  // accepted per GDD §2. (Relentless Optimizer; verify against the manual if
  // readable.)
  hotelSingle: [500, 1_500, 2_000, 3_000],
  // Hotel double, nightly. SOFT confidence, single-source.
  // (Relentless Optimizer; verify against the manual if readable.)
  hotelDouble: [800, 2_000, 3_000, 4_500],
  // Hotel suite, nightly. SOFT confidence, single-source.
  // (Relentless Optimizer; verify against the manual if readable.)
  hotelSuite: [1_500, 4_000, 6_000, 9_000],
};

const RUNG_LABELS = ["Very Low", "Low", "Average", "High"] as const;

/** Frozen per-kind Classic ladder options, built once at module load so
 *  per-unit reads (demand, satisfaction anchors, editors) never allocate. */
const CLASSIC_PRICE_OPTIONS: Readonly<Record<string, PriceOptions>> = Object.freeze(
  Object.fromEntries(
    PRICED_KINDS.map((kind) => {
      const values = CLASSIC_RENT_LADDERS[kind];
      if (!values) throw new Error(`Classic rent ladder missing for priced kind ${kind}`);
      const rungs = Object.freeze(
        values.map((value, i) =>
          Object.freeze({ level: i as 0 | 1 | 2 | 3, label: RUNG_LABELS[i], value }),
        ),
      ) as readonly PriceRung[];
      return [kind, Object.freeze({ shape: "ladder" as const, rungs, noRate: true as const })];
    }),
  ),
);

/** Frozen per-kind Modern band options; the band object IS the live ECON
 *  entry, so a tuning change can never desync the two. */
const MODERN_PRICE_OPTIONS: Readonly<Record<string, PriceOptions>> = Object.freeze(
  Object.fromEntries(PRICED_KINDS.map((kind) => [kind, Object.freeze({ shape: "band" as const, band: ECON.rent[kind] })])),
);

/** The neutral price anchor of a shape: the Average rung on a ladder, the band
 *  default on a band. Income, demand, and satisfaction ratios key off this, so
 *  Classic re-anchors onto canon Average exactly as 1994 did (epics FR5). */
export function priceNeutral(opts: PriceOptions): number {
  return opts.shape === "ladder" ? opts.rungs[2].value : opts.band.default;
}

/**
 * Snap a value to the nearest rung of a ladder, ties rounding UP (the ratified
 * NFR3 rule, uniform for every caller: load migration, the price choke point,
 * batch writes). Non-finite input lands on Average (the neutral rung), and any
 * out-of-band value inherently clamps to the end rungs, so nothing off-ladder
 * or non-finite can survive a snap.
 */
export function snapToLadder(rungs: readonly PriceRung[], value: number): number {
  if (!Number.isFinite(value)) return rungs[2].value;
  let best = rungs[0].value;
  let bestDist = Infinity;
  for (const r of rungs) {
    const d = Math.abs(value - r.value);
    // `<=` so an exact tie prefers the LATER (higher) rung: ties round up.
    if (d <= bestDist) {
      bestDist = d;
      best = r.value;
    }
  }
  return best;
}

/** The rung a value sits on (nearest, ties up), for readouts that name the
 *  level (the picker's selection, the locked sold-condo rung, announce copy). */
export function ladderRungFor(rungs: readonly PriceRung[], value: number): PriceRung {
  const snapped = snapToLadder(rungs, value);
  return rungs.find((r) => r.value === snapped) ?? rungs[2];
}

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
  /**
   * How this mode prices a rentable kind, or null for a kind whose price is not
   * player-set. Classic returns the discrete canon 4-rung ladder plus the
   * No Rate off-market sentinel (the 1994 dropdown); Modern returns today's
   * continuous `{min, default, max, step}` band. Consumers switch on the SHAPE
   * of the return, never on the mode string. Returns frozen singletons, so
   * per-unit reads allocate nothing.
   */
  priceOptions(kind: string): PriceOptions | null;

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
   * Unmet local-demand satisfaction pressure (#395), keyed on a tenant's reachable
   * retail demand-coverage in [0, 1] (1 = the reachable shops and eateries cover
   * the tower's demand). Returns the satisfaction CEILING (`cap`, 1 = no penalty)
   * and the per-hour `erosion` for the shared placement-erosion step, exactly like
   * {@link lobbyDistanceDrain}. Above {@link UNMET_DEMAND_FLOOR} both modes return
   * the neutral drain. Below it, Classic caps at {@link UNMET_DEMAND_CAP} but never
   * erodes (canon: too few amenities lowers renewal, never evicts), while Modern
   * tightens the ceiling with the shortfall and, past {@link UNMET_DEMAND_EVICT_FLOOR},
   * erodes gently so a chronically under-served tenant eventually gives notice
   * (cause `unmetDemand`). Applies to office/condo/hotel; the caller gates on
   * `served` and kind. Pure and deterministic (no RNG).
   */
  unmetDemandDrain(coverage: number): { cap: number; erosion: number };
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
  /**
   * Statistical demographic-routine spawn weights for the crowd layer
   * (condo-demographic-routines, #397): `schoolRun` is the condo morning
   * school-departure wave and its early-afternoon return wave, `salesCall` the
   * occasional office midday round trip. Each weight is the per-spawn-pass
   * probability that the routine contributes a trip option while its hour
   * window is active; the windows themselves are structural constants
   * (`SCHOOL_RUN_*` / `SALES_CALL_*` in `sim/constants`), shared by any mode
   * that enables a routine. A weight of 0 disables that routine, and callers
   * MUST return before drawing from the RNG when every weight is 0, so a
   * Classic tower's seeded crowd stream stays byte-identical (Classic returns
   * all zeros; Modern reads `ECON.demographicRoutineWeights`). Texture only:
   * the trips ride the existing crowd machinery and add no income or
   * satisfaction mechanics.
   */
  demographicRoutines(): DemographicRoutines;
}

/** Per-routine spawn weights, see {@link GameRules.demographicRoutines}. */
export interface DemographicRoutines {
  readonly schoolRun: number;
  readonly salesCall: number;
}

/** The disabled routine set Classic returns: both weights 0, frozen and shared
 *  so the every-spawn-pass read allocates nothing. */
const NO_DEMOGRAPHIC_ROUTINES: DemographicRoutines = Object.freeze({ schoolRun: 0, salesCall: 0 });

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
  priceOptions(kind) {
    // The 1994 four-rung dropdown plus No Rate, at the full canon dollar
    // tables (see CLASSIC_RENT_LADDERS for the provenance notes).
    return CLASSIC_PRICE_OPTIONS[kind] ?? null;
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
    // Two discrete bands, snapping at the edges: near (no penalty), far (a
    // ceiling), very far (a lower ceiling plus the gentle erosion). The near band
    // covers the whole mid-block reach of a complete lobby ladder (the FAR edge is
    // floor(lobbyInterval / 2), see sim/constants.ts), so a tower lobbied every 15
    // feels no distance pressure anywhere between two lobbies; only a skipped sky
    // lobby pushes floors into the capped far band and, deeper, the evicting
    // very-far band.
    if (distanceFloors > LOBBY_VERY_FAR_FLOORS) return { cap: LOBBY_VERY_FAR_CAP, erosion: LOBBY_VERY_FAR_EROSION };
    if (distanceFloors > LOBBY_FAR_FLOORS) return { cap: LOBBY_FAR_CAP, erosion: 0 };
    return LOBBY_NO_DRAIN;
  },
  unmetDemandDrain(coverage) {
    // Canon: too few reachable amenities caps satisfaction (lowers renewal) but
    // never evicts, exactly like noise in Classic. A ceiling only, no erosion.
    if (coverage >= UNMET_DEMAND_FLOOR) return LOBBY_NO_DRAIN;
    return { cap: UNMET_DEMAND_CAP, erosion: 0 };
  },
  weekendMultiplier(kind, isWeekend) {
    // Canon: every commercial kind is busier on the weekend (the literal 1994
    // visitor targets), quiet on weekdays.
    return isWeekend ? (CLASSIC_WEEKEND_MULT[kind] ?? 1) : 1;
  },
  demographicRoutines() {
    // 1994 crowds carry no school-run or sales-call rhythm; both weights are 0
    // and the spawn overlay returns before its first RNG draw, so a Classic
    // tower's seeded crowd stream is byte-identical to before the feature.
    return NO_DEMOGRAPHIC_ROUTINES;
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
  priceOptions(kind) {
    // Today's tuned continuous ranges, unchanged; Modern never offers No Rate.
    return MODERN_PRICE_OPTIONS[kind] ?? null;
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
    // most `lobbyInterval / 2` from a lobby, feels no distance pressure at all
    // (the FAR edge is derived as exactly that mid-block reach); the ceiling and
    // the evicting erosion stay reserved for genuinely under-lobbied towers.
    // Modern smooths and helps.
    if (distanceFloors <= LOBBY_FAR_FLOORS) return LOBBY_NO_DRAIN;
    const capSpan = LOBBY_VERY_FAR_FLOORS + 2 - LOBBY_FAR_FLOORS;
    const capT = Math.min(1, (distanceFloors - LOBBY_FAR_FLOORS) / capSpan);
    const cap = 1 - capT * (1 - LOBBY_VERY_FAR_CAP);
    const eroT = Math.max(0, Math.min(1, (distanceFloors - LOBBY_VERY_FAR_FLOORS) / 2));
    return { cap, erosion: eroT * LOBBY_VERY_FAR_EROSION };
  },
  unmetDemandDrain(coverage) {
    // Modern smooths: the deeper the shortfall below the floor, the tighter the
    // ceiling (from 1.0 at the floor down to UNMET_DEMAND_CAP at coverage 0), and
    // past a lower evict floor a gentle erosion eases in. Adding a reachable shop
    // or restaurant raises coverage and lets tenants recover. NOTE (PROVISIONAL):
    // the erosion only *outpaces* the +0.05/hr served recovery near coverage 0, so
    // in practice only a fully-stranded tenant (coverage ~0, reaches no retail)
    // actually drifts to a notice; between the evict floor and there it caps but
    // net-recovers. The evict floor and `unmetDemandErosion` want a calibration
    // pass to widen the region that can genuinely shed tenants (see the backlog
    // Deferral inbox); v1 is deliberately conservative so it cannot rage-evict a
    // mid-fill tower before a playtest tuning pass.
    if (coverage >= UNMET_DEMAND_FLOOR) return LOBBY_NO_DRAIN;
    const capT = Math.min(1, (UNMET_DEMAND_FLOOR - coverage) / UNMET_DEMAND_FLOOR);
    const cap = 1 - capT * (1 - UNMET_DEMAND_CAP);
    const eroT = Math.max(0, Math.min(1, (UNMET_DEMAND_EVICT_FLOOR - coverage) / UNMET_DEMAND_EVICT_FLOOR));
    return { cap, erosion: eroT * ECON.unmetDemandErosion };
  },
  weekendMultiplier(kind, isWeekend) {
    // Realistic daily rhythm: fast food quiets on the weekend (its weekday
    // office-lunch crowd is gone), while leisure venues pick up. Tuned via ECON.
    return isWeekend ? (ECON.weekendTrafficMultiplier[kind] ?? 1) : 1;
  },
  demographicRoutines() {
    // Modern towers carry the daily rhythm the optimization thread describes:
    // condo kids leave for school each weekday morning and return in the early
    // afternoon, office workers head out on midday sales calls. Weights are
    // tuned in ECON; the hour windows are structural (sim/constants).
    return ECON.demographicRoutineWeights;
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
