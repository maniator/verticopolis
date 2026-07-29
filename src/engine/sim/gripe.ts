import type { Simulation } from "../Simulation";
import { rentOf, rentConfig } from "../econConfig";
import { isElevatorKind, isHotelKind, isStaffOnlyTransport } from "../facilities";
import { isRentalKind } from "../residentialRentals";
import { segmentsOf } from "../tower/segments";
import { isOperational } from "../types";
import type { Unit, VacateReason } from "../types";
import { GRIPE_WARN, NIGHTCLUB_NOISE_FLOORS, TRANSPORT_FAR_TILES } from "./constants";
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
 * lobby distance (#394), then office/commercial noise (W2), and finally unmet
 * local demand (#395, the gentlest sink). A Modern Fitness Club is handled on its
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

export function dominantGripe(
  sim: Simulation,
  u: Unit,
  served?: boolean,
  cong?: number,
  farWalk?: boolean,
  noisy?: boolean,
  lobbyFar?: boolean,
  unmetDemand?: boolean,
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
  // The tenants that feel the lobby-distance drain, and (rentals aside, see the
  // rental branch below) the unmet-demand one. The rental Apartment joins them for
  // distance; the Studio does NOT, so its departure is never mis-attributed to a
  // drain it can't feel. The Studio is not drain-free, though: it still sours on an
  // over-market rent and on noise, and every kind feels congestion above.
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
  const unmetActive = (): boolean => {
    if (unmetDemand !== undefined) return unmetDemand;
    if (!isServed || !isDemandTenant) return false;
    const cov = unmetCoverage(sim.demandMap(), u);
    if (cov === null) return false;
    const drain = sim.rules.unmetDemandDrain(cov);
    return drain.erosion > 0 || drain.cap < 1;
  };
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
    // …or the W2 commercial-noise band next door.
    if (noisy ?? sim.noiseAfflicted(u)) return "noise";
    // Unmet local demand is the gentlest sink, named last.
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
    if (noisy ?? sim.noiseAfflicted(u)) return "noise";
    // D18 put the Apartment in the nightclub's negative halo, so it really does
    // erode from a club floors away. Without this tier that erosion had no cause:
    // dominantGripe returned null, vacateCause fell through to the "access"
    // catch-all, and a fully served tenant was told "no route to the lobby", a false
    // cause rather than merely a missing one (#684). The Studio is out of the halo, so
    // nearNightclub is only asked for the kind that feels it.
    if (u.kind === "rentalApartment" && nearNightclub(sim, u)) return "noise";
    // No unmetDemand tier here: rentals are excluded from the coverage drain on
    // BOTH the live and gate paths (#661), because they are not demand origins, so
    // the branch could never be honest. Leaving it out also stops a caller-supplied
    // `unmetDemand` flag from resurrecting it, since the move-in gate registers its
    // probe as an origin. `wontLeaseText` declines to compute that flag for a rental
    // too, so the two guards agree from both ends. Restore this tier with the origin
    // work in #661, not before.
    return null;
  }
  // A served, uncongested hotel/condo is drained by lobby distance, then by
  // sustained noise (office or commercial within its band), then by unmet local
  // demand, the last sink.
  if (veryFar) return "lobbyFar";
  if (noisy ?? sim.noiseAfflicted(u)) return "noise";
  // A Modern nightclub within its noise range disturbs this sleeping tenant (the
  // negative-halo cross-floor version of the noise cause), so name it "noise" too.
  if (nearNightclub(sim, u)) return "noise";
  if (unmetActive()) return "unmetDemand";
  return null;
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
): VacateReason {
  return dominantGripe(sim, u, served, cong, farWalk, noisy, lobbyFar, unmetDemand) ?? "access";
}
