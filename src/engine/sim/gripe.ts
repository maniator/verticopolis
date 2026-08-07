import type { Simulation } from "../Simulation";
import { rentOf, rentConfig } from "../econConfig";
import { isElevatorKind, isHotelKind, isStaffOnlyTransport, isUnmetDemandKind } from "../facilities";
import { isRentalKind } from "../residentialRentals";
import { segmentsOf } from "../tower/segments";
import { isOperational } from "../types";
import type { Unit, VacateReason } from "../types";
import { CONDO_NOISE_EROSION, GRIPE_WARN, NIGHTCLUB_NOISE_FLOORS, NOISE_EROSION, RENTAL_STUDIO_NOISE_EROSION, TRANSPORT_FAR_TILES } from "./constants";
import { spatialCongestionAttributionByFloor } from "./congestion";
import type { DemandMap } from "./demand";

/**
 * Departure-cause attribution for the Simulation, extracted from
 * `satisfaction.ts` to keep that file within the size guard. These are the
 * read-only "why is this tenant unhappy / leaving" helpers; the erosion that
 * drives satisfaction down lives in `updateSatisfaction`.
 */

/**
 * A demand-origin tenant's retail coverage in [0, 1] for the unmet-demand drain
 * (#395), read from the tower's demand map, or `null` when the unit is not a
 * counted demand origin this tick (so the caller applies no drain). For an origin
 * that can reach at least one retail venue, coverage is `min(1, 1 / share)`
 * (reachable retail capacity over demand, capped at fully met); an origin that can
 * reach NO retail venue while the tower has retail reads 0 (fully unmet), so
 * `share` alone does not determine coverage for every origin. A tower with no
 * retail BUILT at all is exempt (an office building with no shops is the baseline,
 * not a problem); the penalty is for a tower that HAS retail which is insufficient
 * or unreachable, including retail that is all on stranded floors. Tower-uniform
 * under the lobby-anchored demand model, so every connected tenant that reaches
 * the retail reads the same coverage: the signal is "does the tower have enough
 * reachable retail for its demand". Pure.
 */
export function unmetCoverage(dm: DemandMap, u: Unit): number | null {
  const reachable = dm.reachableVenuesByOrigin.get(u.id);
  if (reachable === undefined) return null; // not a counted origin: no judgement
  // Exempt only when the tower has NO retail BUILT at all (an office building with
  // no shops is the baseline, not an unmet-demand problem). Key this on the count
  // of built operational retail venues, NOT on `fractionByUnit.size` (which counts
  // only REACHABLE venues): a tower whose retail is all on stranded floors has an
  // empty `fractionByUnit` yet does have retail, and a tenant that can reach none
  // of it is under-served (coverage 0), not exempt. And NOT on `share` either
  // (`pool / totalCap` is also 0 when the demand pool is empty even though retail
  // exists), which would wrongly exempt a fully-stranded tenant in a shop-having tower.
  if (dm.retailVenueCount === 0) return null;
  if (reachable === 0) return 0; // retail exists in the tower, but this tenant can reach none
  // Guard the division: for a real demand map a counted origin (`reachable > 0`)
  // always contributes to the pool, so `share > 0` here, but a hand-built map
  // could pass `share === 0` with `reachable > 0`, so fall back to full coverage.
  return dm.share > 0 ? Math.min(1, 1 / dm.share) : 1;
}

/**
 * The dominant ACTIVE satisfaction drain on a tenant right now, or null when
 * nothing is dragging it down. The order mirrors the drains in
 * `updateSatisfaction`: an unreachable floor is harshest, then elevator crowding,
 * then an over-market office rent, then a far-walk office (W1), then very-far
 * lobby distance (#394), then office/commercial noise (W2), then unmet local
 * demand (#395). Since the #548 calibration the unmet erosion can exceed a
 * kind's noise erosion, so when both erode the steeper one takes the tier
 * (`unmetOutranksNoise` below); in the cap-only Classic world the order never
 * changes. A Modern Fitness Club is handled on its
 * own: over-market dues report "rent", and it feels no other placement drain.
 * Where {@link vacateCause} falls back to
 * "access" as the bottom-out catch-all, this returns null so the "Main gripe"
 * inspector line can stay silent for a content tenant. Read-only.
 *
 * The flag args accept what `updateSatisfaction` already computed this tick so the
 * attribution never rescans; when absent (the inspector, calling per hover) they
 * recompute through the same predicates. `lobbyFar` ranks after the W1 far-walk
 * and before noise: a very-far tenant erodes in both modes (where Classic noise
 * does not), so naming lobby distance ahead of noise keeps the departure line
 * honest. For `unmetDemand` the two paths differ deliberately: the explicit flag
 * the eviction path passes is erosion-only (a cap alone cannot evict, so a Classic
 * or Modern-cap-only tenant never DEPARTS blamed on unmet demand), while the
 * inspector recompute (flag absent) names it whenever the drain is active (cap or
 * erosion), so a merely-capped tenant still reads an actionable gripe, matching the
 * cap-only noise case.
 */
/**
 * True when the tenant's own contiguous floor SEGMENT reaches the ground lobby.
 * The satisfaction-side "served" signal (#647): stricter than
 * {@link Tower.isFloorServed} on a gap-split floor, where one half can reach the
 * lobby while the other is walled off by a gap. Gates on `isFloorServed` first,
 * so on a gap-free floor (one segment) it is exactly the old floor-level answer,
 * keeping a contiguous tower byte-identical. The connectivity ignores the walk
 * budget, mirroring `isFloorServed` itself.
 */
export function reachesLobby(sim: Simulation, u: Unit): boolean {
  if (!sim.tower.isFloorServed(u.floor)) return false;
  if (segmentsOf(sim.tower, u.floor).length <= 1) return true;
  return sim.crowd.segmentConnected(sim.tower, u.floor, u.x);
}

/**
 * Which passenger transport kinds actually STOP at a floor, for congestion copy
 * (#699). Congestion capacity counts every passenger kind (the transport-neutral
 * rule on {@link VACATE_REASON_TEXT}), so the "crowded elevators" advice is wrong
 * on a floor served only by stairs; the copy sites branch on this instead.
 * Routed through `Tower.stopsAt`, never the bottom/top span, because a shaft can
 * span a floor while its skip list drops it (the #699 save skips floors 2-5):
 * such a shaft serves the floor no more than no shaft at all. Staff-only service
 * elevators carry no tenants and must not flip the wording to "elevators".
 * A read-only single pass over the transports, called from the inspector hover
 * and the occasional buy-back vacate; cheap, and never inside a per-tick
 * per-unit loop.
 */
export function servingTransportKindsAt(
  sim: Simulation,
  floor: number,
): { elevator: boolean; stairs: boolean; escalator: boolean } {
  const kinds = { elevator: false, stairs: false, escalator: false };
  for (const t of sim.tower.transports) {
    if (isStaffOnlyTransport(t.kind)) continue;
    if (!sim.tower.stopsAt(t, floor)) continue;
    if (isElevatorKind(t.kind)) kinds.elevator = true;
    else if (t.kind === "stairs") kinds.stairs = true;
    else if (t.kind === "escalator") kinds.escalator = true;
  }
  return kinds;
}

/** The transport class whose shaft BINDS a floor's congestion reading (#701):
 *  "walkways" is the stairs-and-escalators tie, "none" the transportless
 *  defensive case. */
export type CongestionBindingClass = "elevator" | "stairs" | "escalator" | "walkways" | "none";

/** Two ratios within this band count as tied. The capacity-proportional load
 *  split makes shafts serving identical floor sets land on mathematically
 *  equal ratios, so near-ties are the DEFAULT, differing only by float
 *  rounding; without the band the wording would ride noise and build order. */
const BINDING_TIE_EPS = 1e-9;

/**
 * The transport class that BINDS a floor's congestion reading, for the
 * congestion copy (#701). In the v2 spatial model a floor's reading is its
 * worst serving shaft, with load accumulated across every floor that shaft
 * serves, so a stair link cross-loaded by a stairs-only neighbor can bind a
 * floor a healthy elevator also stops at; "add cars" cannot clear that
 * reading, and the copy must name the stairs. Reads the model's own
 * attribution ({@link spatialCongestionAttributionByFloor}), so the copy
 * relays what the model measured rather than re-deriving it.
 *
 * Tie rule (party ruling 2026-07-29): a walkway flips the wording only when
 * STRICTLY worse than every serving elevator beyond {@link BINDING_TIE_EPS};
 * ties keep the elevator wording, and two tied walkway kinds keep the
 * combined "stairs and escalators" class. The v1 scalar model and floors
 * without an attribution entry (unpopulated, or any defensive gap) fall back
 * to the serving-kinds classification, which is exactly the pre-#701 rule.
 */
export function bindingTransportClassAt(sim: Simulation, floor: number): CongestionBindingClass {
  if (sim.simModel === "v2") {
    const att = spatialCongestionAttributionByFloor(sim).get(floor);
    if (att) {
      const walkMax = Math.max(att.stairs, att.escalator);
      if (walkMax > att.elevator + BINDING_TIE_EPS) {
        // The combined class needs BOTH walkway kinds to clear the elevator
        // band on their own: near the boundary the weaker kind can tie the
        // stronger one while still sitting inside the elevator tie band, and
        // naming it as a binder there would flip on float noise (#703 Codex
        // review). A kind that does not clear the band leaves the other one
        // binding alone.
        const stairsBind = att.stairs > att.elevator + BINDING_TIE_EPS;
        const escalatorBind = att.escalator > att.elevator + BINDING_TIE_EPS;
        if (stairsBind && escalatorBind && Math.abs(att.stairs - att.escalator) <= BINDING_TIE_EPS) {
          return "walkways";
        }
        return att.stairs >= att.escalator ? "stairs" : "escalator";
      }
      if (att.elevator > 0) return "elevator";
      // All classes at 0 (a lobby entry with no boarding load yet): fall
      // through to the serving-kinds fallback below.
    }
  }
  const kinds = servingTransportKindsAt(sim, floor);
  if (kinds.elevator) return "elevator";
  if (kinds.stairs && kinds.escalator) return "walkways";
  if (kinds.stairs) return "stairs";
  if (kinds.escalator) return "escalator";
  return "none";
}

export function dominantGripe(
  sim: Simulation,
  u: Unit,
  served?: boolean,
  cong?: number,
  farWalk?: boolean,
  noisy?: boolean,
  lobbyFar?: boolean,
  unmetDemand?: boolean,
  unmetCov?: number | null,
): VacateReason | null {
  const isServed = served ?? reachesLobby(sim, u);
  if (!isServed) {
    // `served` is segment-aware (#647): false can mean the whole floor is off the
    // network OR just this unit's own segment is (a gap-split floor whose other
    // half still reaches the lobby). Name the transport-stranded case distinctly
    // so the toast and inspector teach the real cause, not a generic "no access".
    return sim.tower.isFloorServed(u.floor) ? "noTransport" : "access";
  }
  if (u.floor !== 1 && (cong ?? sim.congestionAt(u.floor)) > 1) return "congestion";
  // The tenants that feel the lobby-distance drain. Today this set coincides
  // with `isUnmetDemandKind` (which guards the coverage read in `unmetActive`
  // below), but distance and coverage are distinct concepts, so the lists stay
  // separate. The rental Apartment joins for distance; the Studio does NOT, so
  // its departure is never mis-attributed to a drain it can't feel. The Studio
  // is not drain-free, though: it still sours on an over-market rent and on
  // noise, and every kind feels congestion above.
  const isDemandTenant = u.kind === "office" || isHotelKind(u.kind) || u.kind === "condo" || u.kind === "rentalApartment";
  // Very-far from the nearest (sky)lobby (the tier whose ceiling sits at or below
  // the gripe bar). Recomputed through the same GameRules curve when the flag is
  // absent. Only office/condo/hotel and the rental Apartment carry the penalty.
  const veryFar =
    lobbyFar ??
    (isServed &&
      isDemandTenant &&
      sim.rules.lobbyDistanceDrain(sim.tower.nearestLobbyFloorDistance(u.floor)).cap <= GRIPE_WARN);
  // Unmet local demand is the tier the drain acts on (a low-coverage CAP in both
  // modes, plus Modern erosion past the evict floor). Evaluated LAZILY, only at the
  // `unmetDemand` return sites below, because reading it recomputes through the
  // hour-memoized demand map (an occasional full-tower scan); a higher-priority
  // cause (rent, transport-far, lobby-far, noise) short-circuits before we ever
  // pay for it. The explicit flag the eviction path passes short-circuits the read
  // entirely (that path already computed it), so it never scans. Names it whenever
  // the drain is ACTIVE (cap below 1 OR erosion), so a merely-capped tenant reads
  // an actionable gripe just like the cap-only noise case, rather than sitting at
  // the cap in silence. The explicit flag stays erosion-only (a cap alone cannot
  // push a tenant out), so a departure is never blamed on unmet demand where it
  // only capped.
  // One coverage read shared by the activity gate and the harshest-drain
  // comparison below: the caller's `unmetCov` when supplied (the eviction
  // sweep passes the step's own read, the won't-lease card its candidate-aware
  // one), else the hour-memoized map (the inspector's per-hover recompute).
  // Sharing the read is load-bearing: activity and magnitude judged from two
  // different maps could disagree across an occupancy change.
  const readCov = (): number | null => (unmetCov !== undefined ? unmetCov : unmetCoverage(sim.demandMap(), u));
  const unmetActive = (): boolean => {
    if (unmetDemand !== undefined) return unmetDemand;
    if (!isServed || !isUnmetDemandKind(u.kind)) return false;
    const cov = readCov();
    if (cov === null) return false;
    const drain = sim.rules.unmetDemandDrain(cov);
    return drain.erosion > 0 || drain.cap < 1;
  };
  // #548: the calibrated unmet-demand erosion (0.12 at full depth) can exceed a
  // noise-tier erosion, and this ladder's contract is harshest drain first, so
  // when both erode the steeper one takes the tier; without this a noisy tenant
  // in a starved tower reads "noise" and the player soundproofs a building that
  // is dying of no shops. Applied to every tier that names "noise": the W2 band
  // (against the kind's placement rate) and the nightclub halo (against the
  // actual penalty the nearest club inflicts). Coverage comes from the caller's
  // `unmetCov` when supplied (the eviction sweep and the won't-lease card both
  // read maps the memo does not: the fresh sweep map and the candidate-aware
  // gate map, where an EMPTY spot is not an origin at all and a memo read would
  // silently disable the comparison), else from the hour-memoized map (the
  // inspector's per-hover recompute). On the ladder the read is lazy: it runs
  // only when a noise tier would otherwise fire and the drain is active (the
  // sweep hands over the coverage its step already computed, paying nothing
  // extra). On the Classic scale
  // every competing erosion and the unmet erosion are 0, so the order never
  // changes there.
  const unmetOutranks = (competingErosion: number): boolean => {
    if (!unmetActive()) return false;
    if (!isServed || !isUnmetDemandKind(u.kind)) return false;
    const cov = readCov();
    if (cov === null) return false;
    return sim.rules.unmetDemandDrain(cov).erosion > competingErosion;
  };
  const unmetOutranksNoise = (): boolean => unmetOutranks(noiseBaseErosionFor(u) * sim.rules.noiseErosionScale());
  if (u.kind === "office") {
    const cfg = rentConfig("office");
    if (cfg && rentOf(u) > cfg.default) return "rent";
    // The W1 walk penalty: its nearest shaft is beyond tolerance. The
    // ground-floor exemption is an unconditional gate here (offices on floor 1
    // are never transport-far), so a precomputed farWalk flag can't override it.
    if (u.floor !== 1 && (farWalk ?? sim.tower.nearestTransportDistance(u) > TRANSPORT_FAR_TILES)) {
      return "transportFar";
    }
    if (veryFar) return "lobbyFar";
    // …or the W2 commercial-noise band next door, unless the unmet-demand drain
    // is the steeper active erosion (#548), in which case its tier below names it.
    if ((noisy ?? sim.noiseAfflicted(u)) && !unmetOutranksNoise()) return "noise";
    if (unmetActive()) return "unmetDemand";
    return null;
  }
  if (u.kind === "fitnessClub" || u.kind === "clinic") {
    // A Modern lease amenity's only self-inflicted souring is gouged dues/lease;
    // it feels none of the noise, lobby-distance, or unmet-demand drains (those
    // gate on office/condo/hotel), so "rent" is the one cause to name. A
    // non-gouged one that sours can only be unserved, left to the "access"
    // catch-all, so it never falls through to the hotel/condo causes below.
    const cfg = rentConfig(u.kind);
    if (cfg && rentOf(u) > cfg.default) return "rent";
    return null;
  }
  if (isRentalKind(u.kind)) {
    // A rental sours on an over-market rent first (the GDD's "rent too high",
    // reusing the office cause), then the distance drains. The Studio is not a
    // demand tenant, so veryFar is false for it and it falls straight to
    // noise/access; the Apartment also feels the far walk (Epic 4, #502).
    const cfg = rentConfig(u.kind);
    if (cfg && rentOf(u) > cfg.default) return "rent";
    // #502: a demanding Apartment left with a far walk to its shaft gives notice
    // (the Studio does not feel this, so it is never named here).
    if (u.kind === "rentalApartment" && u.floor !== 1 && (farWalk ?? sim.tower.nearestTransportDistance(u) > TRANSPORT_FAR_TILES)) {
      return "transportFar";
    }
    if (veryFar) return "lobbyFar";
    // W2 noise yields to a steeper active unmet-demand erosion (#548), which
    // only the Apartment can have (the Studio's coverage read stays null).
    if ((noisy ?? sim.noiseAfflicted(u)) && !unmetOutranksNoise()) return "noise";
    // D18 put the Apartment in the nightclub's negative halo, so it really does
    // erode from a club floors away. Without this tier that erosion had no cause:
    // dominantGripe returned null, vacateCause fell through to the "access"
    // catch-all, and a fully served tenant was told "no route to the lobby", a false
    // cause rather than merely a missing one (#684). The Studio is out of the halo, so
    // nearNightclub is only asked for the kind that feels it. Like the W2 tier
    // above, the halo yields when the unmet erosion is steeper than the actual
    // penalty the nearest club inflicts (#548), or the fix would leak back in
    // through this tier one line later.
    if (u.kind === "rentalApartment" && nearNightclub(sim, u) && !unmetOutranks(nightclubPenaltyAt(sim, u))) return "noise";
    // The origin work (#661) landed: rentals are real demand origins, so the
    // Apartment carries the unmet-demand tier as its last sink, after every
    // higher-priority cause, exactly like the condo below. The outer predicate
    // is load-bearing for the Studio: a caller-supplied `unmetDemand` flag
    // returns from `unmetActive` BEFORE its kind guard runs, so only this
    // check stops a flag from resurrecting the tier for the forgiving kind
    // (the recompute path is additionally guarded inside `unmetActive`).
    if (isUnmetDemandKind(u.kind) && unmetActive()) return "unmetDemand";
    return null;
  }
  // A served, uncongested hotel/condo is drained by lobby distance, then by
  // sustained noise (office or commercial within its band), then by unmet local
  // demand; when the unmet erosion is the steeper active drain it takes the
  // tier from BOTH noise namings, the W2 band and the nightclub halo (#548).
  if (veryFar) return "lobbyFar";
  if ((noisy ?? sim.noiseAfflicted(u)) && !unmetOutranksNoise()) return "noise";
  // A Modern nightclub within its noise range disturbs this sleeping tenant (the
  // negative-halo cross-floor version of the noise cause), so name it "noise" too,
  // judged against the club's actual penalty at this distance.
  if (nearNightclub(sim, u) && !unmetOutranks(nightclubPenaltyAt(sim, u))) return "noise";
  if (unmetActive()) return "unmetDemand";
  return null;
}

/** The per-kind BASE noise/far-walk erosion tier (the mode scale is applied by
 *  the caller): the forgiving Studio below the served recovery, a sold condo
 *  just above it, everyone else at the steep office rate. The single source of
 *  truth for the tier selection, shared by the satisfaction step's placement
 *  erosion and the gripe ladder's harshest-drain comparison (#548) so the two
 *  can never disagree about how hard noise actually bites a kind. */
export function noiseBaseErosionFor(u: Pick<Unit, "kind" | "everOccupied">): number {
  if (u.kind === "rentalStudio") return RENTAL_STUDIO_NOISE_EROSION;
  if (u.kind === "condo" && u.everOccupied) return CONDO_NOISE_EROSION;
  return NOISE_EROSION;
}

/** True when an operational, served nightclub sits within its noise range of `u`
 *  (the same floor-distance the negative halo in `updateSatisfaction` penalizes).
 *  Read-only, no RNG. */
export function nearNightclub(sim: Simulation, u: Pick<Unit, "floor">): boolean {
  for (const c of sim.tower.units) {
    if (c.kind === "nightclub" && isOperational(c) && sim.tower.isFloorServed(c.floor) && Math.abs(c.floor - u.floor) < NIGHTCLUB_NOISE_FLOORS) {
      return true;
    }
  }
  return false;
}

/** The magnitude side of {@link nearNightclub}: the per-hour penalty the
 *  NEAREST operational, served club inflicts on `u` through the mode's rules
 *  curve, which itself returns 0 beyond the halo range and is flat 0 in
 *  Classic (this function passes the raw nearest distance through). The
 *  gripe ladder's harshest-drain comparison (#548) judges the halo's "noise"
 *  naming against this, the penalty actually applied, rather than the W2 rate. */
export function nightclubPenaltyAt(sim: Simulation, u: Pick<Unit, "floor">): number {
  let nearest = Infinity;
  for (const c of sim.tower.units) {
    if (c.kind === "nightclub" && isOperational(c) && sim.tower.isFloorServed(c.floor)) {
      const d = Math.abs(c.floor - u.floor);
      if (d < nearest) nearest = d;
    }
  }
  return nearest === Infinity ? 0 : sim.rules.nightclubNoisePenalty(nearest);
}

/**
 * Attribute a tenant's DEPARTURE to the dominant drain at the moment it bottomed
 * out, so the toast/on-notice inspector line names the real cause instead of
 * always blaming access. It is {@link dominantGripe} with "access" as the
 * catch-all for the rare emergency-driven bottom-out (a served, uncongested,
 * market-rent, near, un-noisy tenant that still cratered), so the departure line
 * and the pre-notice "Main gripe" line can never disagree on which cause wins.
 */
export function vacateCause(
  sim: Simulation,
  u: Unit,
  served: boolean,
  cong: number,
  farWalk?: boolean,
  noisy?: boolean,
  lobbyFar?: boolean,
  unmetDemand?: boolean,
  unmetCov?: number | null,
): VacateReason {
  return dominantGripe(sim, u, served, cong, farWalk, noisy, lobbyFar, unmetDemand, unmetCov) ?? "access";
}
