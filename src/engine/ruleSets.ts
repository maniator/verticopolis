import { ECON } from "./econConfig";
import { GRID } from "./facilities";
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
import { CLASSIC_PRICE_OPTIONS, MODERN_PRICE_OPTIONS } from "./pricing";
import {
  CLASSIC_HOUSEHOLD,
  HOUSEHOLD_SIZES,
  HOUSEHOLD_CHURN_PER_PERSON,
  householdPrice,
  rollHousehold,
} from "./households";
import type { GameRules, DemographicRoutines, HousekeepingTriage } from "./gameRules";

/**
 * The two rule-set literals behind the {@link GameRules} seam, split out of
 * `gameRules.ts` per its standing size note (the interface and its docs stay
 * there; this file holds only the implementations, the same way `pricing.ts`
 * and `households.ts` hold their layers). Import them from `gameRules`, which
 * re-exports both, so the seam keeps one import path. The type-only import
 * above cannot cycle at runtime.
 */

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
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
  starterLobby: () => null,
  hasVariantHouseholds: false,
  showsPreviewReason: false, // canon-faithful pedagogy: click-to-refuse, learn by doing
  allowsEscalatorOnOfficeFloors: false, // canon: escalators link commercial floors only
  walkwayWillingnessApplies() {
    // Classic uses the uncapped walk-budget router (parity GDD): reachability is
    // not ride-capped (the original routes through arbitrarily many transfers,
    // #503), stairs/escalators spend a contiguous-walk budget (#384), and there
    // is no express-transfer lobby gate (#509). All three were verified against
    // the 1994 game via the Wine harness.
    return true;
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
  hotelDaytimePresence() {
    // Canon: a 1994 hotel guest checks out through the morning and is gone by
    // midday (rooms are cleaned noon to 5), so none linger to lunch. Returning 0
    // short-circuits the deferral before any room is held, keeping the Classic
    // checkout byte-identical and the lunch hotel-origin bin empty.
    return 0;
  },
};

export const MODERN_RULES: GameRules = {
  mode: "modern",
  starterLobby: () => ({ x: Math.floor(GRID.width / 2) - 20, width: 40 }),
  hasVariantHouseholds: true,
  showsPreviewReason: true, // Modern surfaces refusal reasons on the invalid preview
  allowsEscalatorOnOfficeFloors: true, // Modern lifts the commercial-only escalator rule
  walkwayWillingnessApplies() {
    // Modern's reachability is uncapped, same as Classic (the party ruled Modern
    // must never be more restrictive than Classic). It does NOT apply Classic's
    // hard walkway-willingness refusal: instead a long stair climb or a
    // many-transfer trip feeds a satisfaction/comfort penalty (allowed but the
    // tenant is unhappy and eventually leaves), the deferred #502 track with its
    // own owner-tuned curve. So the plain uncapped BFS here, no walk budget.
    return false;
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
  hotelDaytimePresence() {
    // Modern lets a small, bounded fraction of last-night guests take a late
    // checkout, so they are still in the tower at lunch and take a meal trip: the
    // midday hotel murmur the original never had. Tuned in ECON; deterministic
    // (tower-order selection, no RNG), so it never perturbs the seeded stream.
    return ECON.hotelDaytimePresence;
  },
};
