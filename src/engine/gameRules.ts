import { ECON } from "./econConfig";
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
import { CLASSIC_PRICE_OPTIONS, MODERN_PRICE_OPTIONS, type PriceOptions } from "./pricing";
import type { ElevatorScheduleUX } from "./elevatorSchedule";
import {
  CLASSIC_HOUSEHOLD,
  HOUSEHOLD_SIZES,
  HOUSEHOLD_CHURN_PER_PERSON,
  householdPrice,
  rollHousehold,
} from "./households";
import type { RNG } from "./rng";
import type { GameMode } from "./types";

// The pricing SHAPE layer (canon ladders, PriceOptions, snap helpers) lives in
// ./pricing; re-exported here so consumers keep one import path for the seam.
// Household sizing likewise lives in ./households.
export { priceNeutral, snapToLadder, ladderRungFor } from "./pricing";
export type { PriceRung, PriceOptions } from "./pricing";
export { householdPrice } from "./households";

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

// The condo HOUSEHOLD layer (sizes, weighted Modern draw, household-scaled
// price) lives in ./households, split out like the pricing shape layer;
// re-exported here so consumers keep one import path for the seam.
import { CLASSIC_HOUSEHOLD, HOUSEHOLD_SIZES, HOUSEHOLD_CHURN_PER_PERSON, householdPrice, rollHousehold } from "./households";
export { householdPrice } from "./households";

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Modern's paid-exterminator fees: a flat `calloutFee` plus `perRoomFee` per infested room. */
export interface InfestationRecovery { calloutFee: number; perRoomFee: number }

/** The housekeeping day shift, in whole-hour clock terms. Maids dispatch only
 *  while `start <= hour < end`, and start no NEW room at or after `cutoff` (the
 *  canon "no new room" tail before end of shift), so in-flight maids finish but
 *  the wing stops taking fresh work. `cutoff` is a fractional hour (16.5 = 16:30). */
export interface HousekeepingShift { start: number; end: number; cutoff: number }

/** Modern's smart-dispatch triage weights: a dirty room scores
 *  `dirtyDays * perDirtyDay - nearestCrewFloorDistance * perFloor` and maids
 *  take the highest score first (rescue about-to-infest, mind the commute). */
export interface HousekeepingTriage { perDirtyDay: number; perFloor: number }

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
   * True when a passenger transfer involving an EXPRESS elevator is admissible
   * only at a (sky) lobby floor, the ground lobby included. "Involving" means
   * EITHER leg: express to or from a standard elevator, stairs, or escalator,
   * and also express to express (two express shafts can only share a plain
   * floor at their endpoints, and switching spines belongs at a lobby just the
   * same). The 1994 game routes riders
   * from the express spine onto local banks only through a sky lobby, which is
   * what forces the layered-tower architecture (express spine, sky lobbies
   * every 15 floors, local banks between them). Classic enforces it; Modern
   * keeps the forgiving any-shared-stop routing. Transfers between two
   * non-express transports are untouched in both modes, and the two-ride trip
   * cap is unchanged. Read by the crowd routing BFS only; it never changes
   * what the builder accepts.
   */
  expressTransferNeedsLobby(): boolean;
  /** The Classic/Modern authoring-affordance split for the per-shaft schedule
   *  dialog (#305 Phase 3). UI-only; the sim never reads it. The flag semantics
   *  live on {@link ElevatorScheduleUX} in `elevatorSchedule.ts`. */
  elevatorScheduleUX(): ElevatorScheduleUX;
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
  /** How a cockroach-`infested` hotel room recovers short of the bulldozer:
   *  Classic `null` (PERMANENT, 1994 parity), Modern the paid-exterminator fees. */
  infestationRecovery(): InfestationRecovery | null;
  /** The housekeeping day-shift window. Classic is the canon noon-to-5 shift
   *  (12:00-17:00) with a 16:30 "no new room" cutoff; Modern works a longer
   *  08:00-19:00 day (framed as the payoff of modern staffing), same 30-minute
   *  tail. Hotel checkout stays a morning event in both modes, independent of
   *  this window; only when the maids work differs by mode. */
  housekeepingShift(): HousekeepingShift;
  /** Dispatch order for dirty rooms: Classic `null` (opportunistic tower
   *  order, the original's automatic behavior), Modern the smart triage
   *  weights (deterministic, fixed tiebreaks; NOT a neural net, per the GDD). */
  housekeepingTriage(): HousekeepingTriage | null;
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
  /**
   * Crowd spawn-rate multiplier on a rainy day (weather-shapes-crowd, #430), so
   * rain thins the people actually out and about instead of only firing a hidden
   * income multiplier. The caller gates on `weather === "rain"` and reads 1.0 on
   * any other sky, exactly like the retail `rainMult`. Classic matches the canon
   * shopper hit (`ECON.rainCrowdFactor.classic`, the same 0.5 magnitude as the
   * retail multiplier); Modern softens (`ECON.rainCrowdFactor.modern`). Applied to
   * the spawn accumulator, which already scales by time-of-day and population and
   * draws no RNG, so a rainy day thins the drawn crowd without perturbing the
   * seeded stream and a clear-day tower stays byte-identical. A thinner crowd is
   * what lowers an attendance venue's live fill; retail income is statistical and
   * unaffected here (it keeps its own `rainMult`).
   */
  rainCrowdFactor(): number;
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

const MODERN_HK_TRIAGE: HousekeepingTriage = Object.freeze({ perDirtyDay: 10, perFloor: 1 });

export const CLASSIC_RULES: GameRules = {
  mode: "classic",
  hasVariantHouseholds: false,
  showsPreviewReason: false, // canon-faithful pedagogy: click-to-refuse, learn by doing
  allowsEscalatorOnOfficeFloors: false, // canon: escalators link commercial floors only
  expressTransferNeedsLobby() {
    return true; // canon: express riders switch to local transports only at a (sky) lobby
  },
  elevatorScheduleUX() {
    // 1994 fidelity: raw grid only. Classic withholds advice, never information.
    return { presets: false, autoTune: false, rawGridDefault: true, advice: false };
  },
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
  infestationRecovery() {
    return null; // 1994 parity: infested is permanent, bulldoze-only
  },
  housekeepingShift() {
    // Canon: maids work noon to 5, starting no new room after 4:30.
    return { start: 12, end: 17, cutoff: 16.5 };
  },
  housekeepingTriage() {
    return null; // canon: opportunistic tower-order dispatch, no priority engine
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
  rainCrowdFactor() {
    // Canon: rain keeps half the ambient crowd home (the same 0.5 the retail
    // rainMult uses), so a rainy tower visibly empties and its attendance houses
    // fill less.
    return ECON.rainCrowdFactor.classic;
  },
};

export const MODERN_RULES: GameRules = {
  mode: "modern",
  hasVariantHouseholds: true,
  showsPreviewReason: true, // Modern surfaces refusal reasons on the invalid preview
  allowsEscalatorOnOfficeFloors: true, // Modern lifts the commercial-only escalator rule
  expressTransferNeedsLobby() {
    return false; // Modern keeps the forgiving transfer-at-any-shared-stop routing
  },
  elevatorScheduleUX() {
    // Modern assistance: presets, auto-tune, advice; the raw grid behind Advanced.
    return { presets: true, autoTune: true, rawGridDefault: false, advice: true };
  },
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
  infestationRecovery() {
    return { calloutFee: ECON.exterminatorCalloutFee, perRoomFee: ECON.exterminatorPerRoomFee };
  },
  housekeepingShift() {
    // Modern's longer staffed day: 08:00-19:00, same 30-minute no-new-room tail.
    return { start: 8, end: 19, cutoff: 18.5 };
  },
  housekeepingTriage() {
    // A day of dirt beats anything under ten floors, tying at ten (PROVISIONAL).
    return MODERN_HK_TRIAGE;
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
  rainCrowdFactor() {
    // Modern smooths: rain thins the crowd, but less sharply than the canon hit,
    // so a rainy day reads as a slower tower rather than a near-empty one.
    return ECON.rainCrowdFactor.modern;
  },
};

/** The rule-set for a mode. Both are stateless singletons (pure behavior), so a
 *  tower just holds a reference; nothing per-sim to construct. */
export function makeRules(mode: GameMode): GameRules {
  return mode === "modern" ? MODERN_RULES : CLASSIC_RULES;
}
