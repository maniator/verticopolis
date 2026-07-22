import type { PriceOptions } from "./pricing";
import type { ElevatorScheduleUX } from "./elevatorSchedule";
import type { RNG } from "./rng";
import type { GameMode } from "./types";

// The pricing SHAPE layer (canon ladders, PriceOptions, snap helpers) lives in
// ./pricing; re-exported here so consumers keep one import path for the seam.
export { priceNeutral, snapToLadder, ladderRungFor } from "./pricing";
export type { PriceRung, PriceOptions } from "./pricing";

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
export { householdPrice } from "./households";

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
   * True when Classic's hard walkway-willingness refusal applies: a contiguous
   * stair/escalator run may cross at most WALKWAY_WILLINGNESS[kind] flights (the
   * stricter kind governing a mixed run), reset by any elevator ride (#384).
   * Classic returns true; Modern returns false and instead feeds a long
   * climb/many-transfer trip into a satisfaction comfort penalty (deferred
   * #502). It also selects the router: both modes have UNCAPPED reachability now
   * (the 1994 original routes through arbitrarily many transfers, #503, and
   * gates no express transfer to a lobby, #509), so the only routing difference
   * is this walk budget. Read by the crowd routing BFS only; it never changes
   * what the builder accepts.
   */
  walkwayWillingnessApplies(): boolean;
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
  /**
   * Factor applied to the summed quarterly office rent at each collection,
   * given the running calendar's quarter length in days. Classic returns 1:
   * the full 1994 lump lands every canon 3-day quarter (an Average office pays
   * its whole $10,000 each quarter), the canon cadence that period FAQ
   * sources report (snippet-corroborated, provisional pending a primary
   * source, #575; spec-classic-economy-canon-cadence).
   * Modern returns the income-invariant rescale
   * `quarterDays / REAL_WORLD.quarterDays` (gdd-classic-calendar-parity §3), so
   * its New-Tower calendar choice changes only the cadence and lump size of
   * rent, never a tower's income per in-game day, and its real-world factor is
   * structurally exactly 1 (byte-identical). Pure and deterministic (no RNG).
   */
  quarterlyRentScale(quarterDays: number): number;

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
  /**
   * Fraction of last-night-occupied hotel rooms held past the morning checkout as
   * a late checkout, so the guest is still present through the daytime meal windows
   * and takes a lunch meal trip (#304, "what the original couldn't do"). Classic
   * returns 0: a 1994 hotel guest is gone by midday, so a Classic tower feeds no
   * hotel lunch trips, and callers MUST short-circuit on a `<= 0` return BEFORE
   * deferring any room, so the Classic checkout stays byte-identical. Modern returns
   * a small bounded fraction (`ECON.hotelDaytimePresence`). The deferred rooms are
   * chosen deterministically in tower order with no RNG draw, and each still checks
   * out the same day (an afternoon event), so this is the same guest for a slightly
   * longer real stay, never a second census body. Provisional magnitude, pending a
   * calibration pass.
   */
  hotelDaytimePresence(): number;
}

/** Per-routine spawn weights, see {@link GameRules.demographicRoutines}. */
export interface DemographicRoutines {
  readonly schoolRun: number;
  readonly salesCall: number;
}

// The implementations live in ./ruleSets (split per this file's standing size
// note); re-exported so the seam keeps one import path.
import { CLASSIC_RULES, MODERN_RULES } from "./ruleSets";
export { CLASSIC_RULES, MODERN_RULES } from "./ruleSets";

/** The rule-set for a mode. Both are stateless singletons (pure behavior), so a
 *  tower just holds a reference; nothing per-sim to construct. */
export function makeRules(mode: GameMode): GameRules {
  return mode === "modern" ? MODERN_RULES : CLASSIC_RULES;
}
