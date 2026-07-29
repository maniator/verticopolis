import type { Unit } from "../types";
import { GRID } from "../facilitiesData";

/** How long (game minutes) an office/condo tenant stays "on notice" in the
 *  `vacating` state before actually leaving, a grace window the player can use
 *  to fix the cause. Two in-game days. Module-local: only the churn loop reads it. */
export const VACATE_NOTICE_MINUTES = 2 * 24 * 60;

/** Satisfaction a vacating tenant must climb back to before they rescind their
 *  notice and stay. Set at 0.40 (not a hair above zero) so a tower that merely
 *  *stabilizes* a unit, nurses it off the floor but never actually makes it a
 *  good place to be, still loses the tenant: "stabilized" ≠ "fixed". A genuine
 *  fix reaches 0.40 in ~8 served hours (recovery is +0.05/hr), well inside the
 *  notice window. Exported because the inspector reads it to show the player the
 *  exact recovery target (the "inform before you hurt them" contract). */
export const VACATE_RESCIND = 0.4;

/** The metro-platform-cut-off advisory copy. Exported so the emit site and the
 *  tests that match on it share one source and cannot drift. */
export const METRO_PLATFORM_CUTOFF_MSG =
  "Your metro platform is cut off. Build a passenger elevator, stairs, or an escalator down to the platform so commuters can reach the station.";

/** The immediate annoyance ceiling for a hotel/condo sat right beside an office:
 *  moving in next to noise caps satisfaction here at once (canon "office
 *  neighbor is too noisy"). */
export const NOISE_CAP = 0.6;

/** At or below this satisfaction the inspector names a tenant's dominant gripe
 *  (congestion / rent / noise) proactively, before an eviction notice at 0, so a
 *  content tenant (which recovers above it) is left unbothered. Pinned to
 *  {@link NOISE_CAP}: a noise-bothered tenant caps at exactly that ceiling, so
 *  tying the bar to it guarantees the "noisy neighbor" gripe is caught for
 *  precisely the tenants it describes. */
export const GRIPE_WARN = NOISE_CAP;

/** Per-hour erosion applied on top of the cap while the office neighbor stays.
 *  It slightly outpaces the +0.05/hr served recovery (net ≈ −0.02/hr), so an
 *  UNADDRESSED noisy neighbor wears the tenant down past the rescind bar and,
 *  eventually, out, a slow, heavily-telegraphed pressure (≈1 day from the cap
 *  to zero, then the 2-day notice), not an instant eviction. Fix it (move the
 *  office or the neighbor) and satisfaction recovers normally. */
export const NOISE_EROSION = 0.07;

/** Office-noise erosion for a *sold condo*, gentler than the hotel rate above,
 *  a sold condo is an owner, not a nightly guest, and 1994 condos were "sticky."
 *  A condo owner is annoyed by a noisy neighbor (canon "office neighbor is too
 *  noisy": the unit still reddens on the stats overlay) but only *just* exceeds
 *  the +0.05/hr served recovery, for a shallow net drift of ≈ −0.004/hr: a
 *  *transient* neighbor the player removes within a few days is fully absorbed
 *  and the owner stays, while only *sustained, unaddressed* adjacency wears an
 *  owner down and out, ≈150 game-hours (about a week) from the annoyance cap to
 *  a notice, then the 2-day window: ≈5× the hotel's ≈30-hour fuse. INVARIANT:
 *  keep this strictly above the +0.05/hr served recovery, at or below it the
 *  net drift is non-negative, so a noise-worn condo never reaches the notice
 *  threshold and office noise can never evict an owner at all. Fixing the cause
 *  (move the office or the neighbor) recovers well before. */
export const CONDO_NOISE_EROSION = 0.054;

/** Office-noise erosion for the rental STUDIO, the forgiving tier. Deliberately
 *  BELOW the +0.05/hr served recovery, which is the opposite of the condo rate
 *  above: net drift is non-negative, so a noisy neighbor caps the Studio at the
 *  annoyance ceiling and holds it there without ever wearing it out. That is the
 *  GDD's "cheap, easygoing tenant that stays through a scrappy tower".
 *
 *  Three limits on that guarantee, all deliberate. Rent pressure is SEPARATE and
 *  ADDITIVE: the over-market term is subtracted before this block rather than
 *  max'd with it, so a Studio at the top of its band (-0.035/hr) beside a noisy
 *  neighbor nets -0.025/hr and gives notice sooner than any other residential
 *  kind. That is the rent tier doing its job, not the noise tier failing, and
 *  `dominantGripe` reads "rent" first so the cause is named honestly. Only the
 *  claim "noise alone never wears a Studio out" is what this rate guarantees.
 *  It is also the NOISE channel only:
 *  `satisfactionStep` takes the max of this and the lobby/unmet drains, so a
 *  Studio stranded far from a lobby still erodes at the steeper lobby rate and
 *  can still leave. And it holds only while the unit is SERVED, since the +0.05
 *  is the served recovery: cut a Studio off from all transport and it drains
 *  like any other kind, which is the intended read of an unreachable room.
 *  Modern scales noise erosion by 1 and Classic by 0 (`noiseErosionScale`), so
 *  the comparison against the recovery is the live one in Modern, and Classic
 *  never erodes on noise at all.
 *
 *  It matters beyond the occupied tenant: the move-in sustainability gate refuses
 *  to lease a spot whose fresh tenant would erode back out, so at the condo's
 *  rate a Studio anywhere near an office was not merely unhappy, it was
 *  permanently unleasable, which contradicts strip-placing Studios along the low
 *  floors where the offices and shops live. The Apartment keeps the steeper
 *  office rate: being evictable is what makes it the demanding tier. */
export const RENTAL_STUDIO_NOISE_EROSION = 0.04;

/** Canon "the stairs/elevators are far away" tolerance, in tiles. An office whose
 *  nearest reachable shaft on its own floor sits farther than this wears its
 *  tenant down (W1), matching the 1994 original's 79-segment walking limit. At
 *  or under it the walk is fine and satisfaction recovers normally. Exported so the
 *  inspector's always-on "long walk" line reads the exact same threshold. */
export const TRANSPORT_FAR_TILES = 79;

/**
 * Graduated "far from a (sky)lobby" satisfaction pressure (#394). Keyed on floors
 * from the nearest lobby (ground floor 1 always anchors; sky lobbies sit every
 * `GRID.lobbyInterval` floors), it motivates the sky lobby, the central mid-game
 * structural decision: a tall tower with no sky lobby leaves its upper floors far
 * from any lobby, so their tenants cap low until the player adds one. Two bands,
 * applied to office/condo/hotel inside the SHARED placement-erosion step (never a
 * second compounding drain):
 *   - FAR (nearest-lobby distance beyond {@link LOBBY_FAR_FLOORS}): an annoyance
 *     CEILING at {@link LOBBY_FAR_CAP}, no erosion, so it lowers renewal but never
 *     evicts (caps, does not kill).
 *   - VERY FAR (beyond {@link LOBBY_VERY_FAR_FLOORS}): a lower ceiling
 *     {@link LOBBY_VERY_FAR_CAP} AND a gentle {@link LOBBY_VERY_FAR_EROSION} that
 *     just outpaces the +0.05/hr served recovery, so a genuinely isolated tenant
 *     eventually gives notice (attributed to the `lobbyFar` cause), a slow,
 *     telegraphed pressure like the noise fuse, not an instant eviction.
 * The FAR edge is DERIVED from the placement rule, not tuned: lobbies are legal
 * only on the ground floor and every `GRID.lobbyInterval`th floor, so the most
 * central floor between two adjacent lobbies sits floor(lobbyInterval / 2) floors
 * from the nearer one. That distance must be penalty-free, or a tower with every
 * legal lobby built carries a permanent capped band it has no way to fix, and
 * the inspector prescribes a lobby the placement rule refuses (the v1.44.0
 * state: the edge was 4, mirroring the thread-reported 1994 mid-block bands,
 * against an unavoidable mid-block 7). Owner ruling 2026-07-16 (agent panel +
 * red team, PARITY.md "Known parity gaps"): feedback integrity wins over the
 * mid-block tithe. Correct play is sufficient AND fully rewarded: build every
 * sky lobby and no floor between two lobbies feels any distance pressure.
 * The bands then land exactly on genuinely under-lobbied towers: one skipped
 * sky lobby makes a 2x-interval block whose middle floors sit 8 to 15 from a
 * lobby, capped in FAR and, past {@link LOBBY_VERY_FAR_FLOORS}, eroding out.
 * One deliberate exception: the short block above the HIGHEST buildable lobby
 * slot (floors 91..100 over the floor-90 lobby, up to 10 away) can enter FAR
 * with no legal fix. It is kept inside the capped band, never the evicting one
 * (see the invariant test in `gameRules.test.ts`), and the inspector shows
 * neutral no-advice copy there instead of prescribing an unbuildable lobby.
 * Classic reads these as the two discrete bands; Modern reads a smoother
 * continuous curve over the same anchors (see {@link GameRules.lobbyDistanceDrain}).
 * The caps and the very-far edge remain PROVISIONAL magnitudes (no in-repo canon
 * source), flagged for a playtest pass; the FAR edge is geometry, not taste.
 */
export const LOBBY_FAR_FLOORS = Math.floor(GRID.lobbyInterval / 2);
export const LOBBY_VERY_FAR_FLOORS = 11;
export const LOBBY_FAR_CAP = 0.7;
export const LOBBY_VERY_FAR_CAP = 0.5;
/** Very-far per-hour erosion. Strictly above the +0.05/hr served recovery so the
 *  net drift is negative (about -0.005/hr, roughly 4 days from the very-far cap to
 *  a notice, then the 2-day notice window), gentle enough that a tenant near a
 *  second lobby or one the player reconnects recovers, harsh enough that true
 *  isolation eventually costs the tenant. Keep it > 0.05 or very-far would cap but never
 *  evict, and the `lobbyFar` vacate cause could never honestly fire. */
export const LOBBY_VERY_FAR_EROSION = 0.055;
/** The neutral lobby-distance drain (no ceiling, no erosion), a single shared
 *  frozen value both rule-sets return for the near-a-lobby case and the satisfaction
 *  loop uses for units the penalty does not apply to, so the common no-penalty path
 *  allocates nothing per unit per tick. */
export const LOBBY_NO_DRAIN: { readonly cap: number; readonly erosion: number } = Object.freeze({ cap: 1, erosion: 0 });
/** Per-hour satisfaction a served, uncongested tenant recovers. A distance or
 *  noise erosion evicts only when it exceeds this (so the inspector can tell a
 *  "capped but stable" tenant from one actually sliding toward a notice). */
export const SERVED_RECOVERY = 0.05;

/** Modern-only Fitness Club amenity halo (gdd-modern-expansion). A condo within
 *  `FITNESS_HALO_FLOORS` floors of an operational Fitness Club gets a small
 *  per-hour satisfaction bonus, `FITNESS_HALO_MAX` on the club's own floor and
 *  fading linearly to 0 at the edge of the range. Deliberately below
 *  `SERVED_RECOVERY` (a garnish on recovery, not a substitute), and only the
 *  nearest club counts, so gym spam can't compound into an outsized buff. */
export const FITNESS_HALO_FLOORS = 5;
export const FITNESS_HALO_MAX = 0.03;

/** Modern-only Nightclub NEGATIVE halo (gdd-modern-expansion): a condo or hotel
 *  within `NIGHTCLUB_NOISE_FLOORS` floors of an operational nightclub loses
 *  per-hour satisfaction to its noise, `NIGHTCLUB_NOISE_MAX` on the club's own
 *  floor and fading linearly to 0 at the edge of the range. The max deliberately
 *  exceeds `SERVED_RECOVERY`, so a home right by a nightclub net-declines and can
 *  eventually give notice: the placement tension is real (keep clubs off
 *  residential floors). Only the nearest club counts, so it can't stack. */
export const NIGHTCLUB_NOISE_FLOORS = 4;
export const NIGHTCLUB_NOISE_MAX = 0.08;

/** Modern-only Spa serenity halo (gdd-modern-expansion): the positive mirror of
 *  the fitness halo, but for HOTEL guests. A hotel room within `SPA_SERENITY_FLOORS`
 *  floors of an operational Spa gets a small per-hour satisfaction bonus,
 *  `SPA_SERENITY_MAX` on the spa's own floor and fading linearly to 0 at the edge
 *  of the range. Deliberately below `SERVED_RECOVERY` (a garnish on recovery, not
 *  a substitute), and only the nearest spa counts, so spa spam can't compound. */
export const SPA_SERENITY_FLOORS = 5;
export const SPA_SERENITY_MAX = 0.03;

/** Modern-only Daycare family halo (gdd-modern-expansion): a positive condo halo
 *  like the Fitness Club's, but SCALED BY FAMILY SIZE. A condo within
 *  `DAYCARE_HALO_FLOORS` floors of an operational daycare gets a per-hour
 *  satisfaction bonus up to `DAYCARE_HALO_MAX` on the daycare's own floor, fading
 *  linearly with distance AND scaled by the household size (a bigger family, which
 *  leans on childcare more, benefits more; a one-person condo gets nothing extra).
 *  Below `SERVED_RECOVERY` at full scale, and only the nearest daycare counts. */
export const DAYCARE_HALO_FLOORS = 4;
export const DAYCARE_HALO_MAX = 0.035;

/**
 * Unmet local-demand thresholds (leave-tower-unmet-demand, #395). A tenant's
 * retail demand-coverage sits in [0, 1] (1 = the reachable shops and eateries
 * comfortably cover the tower's demand; 0 = nowhere to eat or shop within reach).
 * When coverage drops below {@link UNMET_DEMAND_FLOOR}, satisfaction is capped at
 * {@link UNMET_DEMAND_CAP} (lowers renewal, canon "not enough amenities"); Modern
 * additionally erodes once coverage falls below {@link UNMET_DEMAND_EVICT_FLOOR},
 * so a chronically under-served tenant eventually gives notice. Classic caps but
 * never erodes (it returns {@link LOBBY_NO_DRAIN} above the floor and a
 * ceiling-only drain below it). Provisional, shared by both rule-sets; the Modern
 * erosion magnitude lives in `ECON.unmetDemandErosion`. Kept strictly below 1 so
 * a fully-served tower (coverage 1) is a no-op and the golden master is unchanged.
 */
export const UNMET_DEMAND_FLOOR = 0.5;
export const UNMET_DEMAND_CAP = 0.6;
export const UNMET_DEMAND_EVICT_FLOOR = 0.25;

/** Canon same-floor noise buffers, in tiles (the gap a source may sit within
 *  before it bothers the sensitive room). Only these two are documented numbers;
 *  everything else reuses the room's own band (see arch §2.2 / gdd §4.2). The
 *  commercial source set is {@link isCommercialKind}, the same canon four W3
 *  uses, so the two penalties can never disagree on what "commercial" means. */
export const OFFICE_NOISE_TILES = 11; // office bothered by commercial within 11
export const HOTEL_NOISE_TILES = 21; // hotel/condo bothered by office or commercial within 21

/**
 * The widest condo price band that has ever existed (the pre-re-anchor band was
 * $60k–$240k; the current one is $80k–$200k). A SOLD condo keeps its historical
 * price rather than being re-clamped to the current band, but it's still bounded
 * to this range on load, so a forged/corrupt save can't stamp an absurd `rent`
 * (e.g. $1e9) that the owner buy-back would then reclaim, draining money with no
 * ceiling. Every legitimate sold price (current or legacy) sits inside this range,
 * so nothing real is altered.
 */
export const SOLD_CONDO_MIN_PRICE = 60_000;
export const SOLD_CONDO_MAX_PRICE = 240_000;

/** A single tick advances the crowd by at most this many crowd-seconds so a
 * day-long catch-up step stays bounded (see CROWD_SECONDS_PER_MINUTE, which
 * lives in Crowd.ts so crowd-side constants can be derived from it). */
export const CROWD_MAX_STEP = 60;

/**
 * Demographic-routine hour windows (condo-demographic-routines, #397), each
 * `[start, end)` like the meal windows in `crowd/meals.ts`. These are
 * STRUCTURAL: any mode that enables a routine uses the same hours (a school
 * day is a school day), so they live here as named constants; only the
 * per-routine spawn weights are Modern tunables (`ECON.demographicRoutineWeights`,
 * resolved through `GameRules.demographicRoutines`). The SimTower optimization
 * thread describes condo children leaving for school in the morning and
 * returning in the early afternoon, and office workers making midday
 * sales-call round trips; the crowd layer reads these windows to bias its
 * spawn mix in those hours. Weekday-only gates (school days, staffed offices)
 * live at the spawn site, not here.
 */
export const SCHOOL_RUN_DEPART_START = 7;
export const SCHOOL_RUN_DEPART_END = 8;
export const SCHOOL_RUN_RETURN_START = 15;
export const SCHOOL_RUN_RETURN_END = 16;
/** Sales-call departures span the office midday; each caller is back within an
 *  hour or two (the shared round-trip dwell is 30-60 game minutes plus travel),
 *  so a 14:xx departure still returns comfortably inside the staffed day. */
export const SALES_CALL_START = 10;
export const SALES_CALL_END = 15;

/** Clamp a target price into its kind's band. */
export function clampRent(cfg: { min: number; max: number }, target: number): number {
  return Math.max(cfg.min, Math.min(cfg.max, target));
}

/** Store a clamped price on a unit. The kind default is stored as "no
 *  override" (undefined), so a unit set/nudged back to default never counts
 *  as custom-priced. */
export function storeRent(u: Unit, cfg: { default: number }, clamped: number): void {
  u.rent = clamped === cfg.default ? undefined : clamped;
}

// LogEntry moved to ./types (the save schema carries a log tail); re-exported
// here so the UI's existing import path keeps working.

/** Ring capacity of the live bulletin log (emit pushes + shifts past this),
 *  and therefore the most entries a restored save may bring back. */
export const LOG_RING_CAP = 300;

/** How many trailing log entries ride a save (see SerializedGame.log):
 *  deliberately EQUAL to the ring cap, so a save (and an undo snapshot,
 *  which reuses serialize) holds exactly what the live ring holds and no
 *  scrollback is ever lost to a load or an undo. Realistic lines compress
 *  to roughly 1.5 KB per 100 in a file, so a full ring costs about 4.5 KB;
 *  the forged-input ceiling stays bounded by the restore caps
 *  (LOG_RING_CAP entries of LOG_TEXT_CAP chars). */
export const LOG_SAVE_CAP = LOG_RING_CAP;

/** Hard cap on a RESTORED entry's text length. Our own emits are short
 *  sentences; a forged save must not smuggle megabytes into the DOM (the
 *  panel renders via textContent, so this bounds memory, not injection). */
export const LOG_TEXT_CAP = 400;

/** The metric the colored stats overlay tints floors by. */
export type HeatmapMode = "congestion" | "occupancy" | "satisfaction" | "cleanliness";

/** Congestion ratio at which tenants begin leaving (see {@link Simulation.updateSatisfaction},
 *  `cong > 1`), the overlay paints this AMBER so the color never contradicts the sim. */
export const CONGESTION_CHURN = 1.0;
/** The gridlock boundary of the traffic tiers (`trafficTier` returns gridlock
 *  for congestion strictly above this), the overlay saturates to RED at and
 *  beyond this ratio, so full red coincides with entering the worst tier. */
export const CONGESTION_GRIDLOCK = 1.6;
/** Severity of the amber ramp stop, kept in sync with the 4-stop `HEAT_STOPS`
 *  palette in the renderer (green 0 · chartreuse ⅓ · amber ⅔ · red 1). Anchoring
 *  churn to this value is what makes "amber = tenants starting to leave" literal. */
export const CONGESTION_AMBER_SEVERITY = 2 / 3;

/**
 * Congestion ratio → overlay severity (0 = green/clear … 1 = red/gridlock),
 * anchored to the simulation's own thresholds so the tint never lies about the
 * state it drives: a floor turns AMBER exactly at the churn point
 * ({@link CONGESTION_CHURN}, where tenants start leaving) and fully RED at
 * gridlock ({@link CONGESTION_GRIDLOCK}). The sub-churn range is gamma-lifted so
 * a healthy tower still shows a legible green→yellow gradient, the busiest
 * floors stand out instead of collapsing into one flat green wash, while amber
 * and red stay reserved for genuinely strained transport. Pure (no rendering);
 * it lives beside the congestion model it interprets.
 */
export function congestionSeverity(cong: number): number {
  // A non-finite or non-positive ratio (should never happen, capacity is
  // guarded > 0, but a corrupt save or future divide could produce NaN or
  // ±Infinity) degrades to green rather than poisoning the ramp index in
  // heatColor and throwing on the draw path. Guard Infinity explicitly: it is
  // > 0, so `cong > 0` alone would let it fall through to the gridlock clamp.
  if (!Number.isFinite(cong) || cong <= 0) return 0;
  if (cong >= CONGESTION_GRIDLOCK) return 1;
  if (cong <= CONGESTION_CHURN) {
    // Expand the lived-in [0, churn) band across most of the green→amber leg.
    return CONGESTION_AMBER_SEVERITY * Math.pow(cong / CONGESTION_CHURN, 0.6);
  }
  // Churn → gridlock climbs amber → red.
  return (
    CONGESTION_AMBER_SEVERITY +
    (1 - CONGESTION_AMBER_SEVERITY) * ((cong - CONGESTION_CHURN) / (CONGESTION_GRIDLOCK - CONGESTION_CHURN))
  );
}

/** One tinted rectangle in the stats overlay: a column span on a floor and how
 *  bad it reads (0 = green/good … 1 = red/bad). Congestion and occupancy emit
 *  one cell per floor (they're floor-level metrics); satisfaction emits one cell
 *  per present tenant unit so a single unhappy suite reddens on its own instead
 *  of being averaged away by content neighbors sharing the floor.
 *
 *  `tint` is an optional SEMANTIC category for cells whose meaning the plain
 *  good-to-bad ramp cannot carry (the engine names the state; the renderer
 *  picks the pixels): `infested` marks a hotel room housekeeping can no longer
 *  clean (terminal, distinct from "unreached"), `na` marks a unit the overlay's
 *  metric does not apply to (a condo on the housekeeping map), so a blank never
 *  reads as an uncovered room. Cells without a tint read the severity ramp.
 *  Numeric consumers aggregating `severity` must SKIP `na` cells (their 0
 *  means "not applicable", never "perfectly covered"); `infested` cells keep
 *  an honest hot severity for anything reading the number alone. */
export interface HeatCell {
  floor: number;
  minX: number;
  maxX: number;
  severity: number;
  tint?: "infested" | "na";
}

/** Batch-pricing target: an exact price, "default" to return to the neutral
 *  anchor (band default / Classic Average rung), or "noRate" to take the kind
 *  off the market (ladder modes only; Modern never holds the No Rate state). */
export type BatchTarget = number | "default" | "noRate";
export interface BatchRentOptions {
  /** Only touch units still on the default price (skip hand-tuned ones). */
  onlyDefaultPriced?: boolean;
}
export interface BatchRentResult {
  matched: number; // priced units of this kind (incl. sold condos)
  eligible: number; // matched − skippedSold − skippedCustom
  changed: number; // units whose effective price actually differs after the write
  skippedSold: number; // condo && everOccupied
  skippedCustom: number; // had a custom price and onlyDefaultPriced was set (left alone)
  customOverwritten: number; // eligible custom-priced units being replaced (protect toggle off)
  clampedLow: number; // eligible units whose target was below the band minimum
  clampedHigh: number; // eligible units whose target was above the band maximum
}

/**
 * Simulation drives time, money, population and ratings. The renderer and UI
 * read its state; they never mutate the model directly except via build/sell.
 */
