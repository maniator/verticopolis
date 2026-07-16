import type { SimContext } from "../SimContext";
import type { Simulation } from "../Simulation";
import { MODERN_RULES } from "../gameRules";
import { ECON } from "../econConfig";
import { RECYCLING_POP_PER_CENTER } from "../facilities";
import { isHotelKind } from "../facilities";
import { residentCount } from "../census";
import { isOperational, isTenanted } from "../types";

/**
 * The commercial demand model (gdd/arch-commercial-demand-pools-2026-07-15).
 *
 * Replaces the old tower-wide `trafficAppeal` scalar with a demand POOL built
 * from the connected census: each occupied office/condo/hotel contributes a
 * per-capita budget (weighted by kind, reusing the meal-cadence weights), and
 * that pool is distributed across the reachable commercial venues in proportion
 * to their headline daily capacity. A venue then earns `min(1, D_v / cap_v)` of
 * its daily figure, exactly where `appeal` used to sit.
 *
 * Because the engine's reachability is lobby-anchored (a floor either draws
 * visitors within the two-ride rule or it does not, the same gate the income
 * loop already applies), every connected origin reaches the same set of
 * reachable venues, so the capacity-proportional split reduces to a uniform
 * `share = pool / reachableCapacity` across those venues. Venue COUNT and MIX
 * now drive the result: adding a venue raises the reachable capacity and dilutes
 * every venue's share, so a second identical venue cannibalizes the first and
 * the abandonment limit is emergent rather than hardcoded. A future refinement
 * (pairwise floor reachability, or sub-lobby demand zones) would localize the
 * split; this v1 keeps the existing lobby-anchored gate.
 */
export interface DemandMap {
  /** Venue unit id to demand fraction in [0, 1], the `appeal` replacement. */
  fractionByUnit: Map<number, number>;
  /** Venue unit id to delivered demand dollars (fraction times capacity), for
   *  the inspector readout and the conservation test. */
  deliveredByUnit: Map<number, number>;
  /** Origin unit id to the count of venues it can reach (0 when the origin's own
   *  floor is stranded), the coverage signal `leave-tower-unmet-demand` (#395)
   *  will read. */
  reachableVenuesByOrigin: Map<number, number>;
  /** The raw, UNCAPPED demand pressure `pool / reachableCapacity`, tower-uniform
   *  under the lobby-anchored model. Distinct from `fractionByUnit` (which is
   *  capped at 1 and floored): `share >= 1` means demand meets or outstrips the
   *  reachable commercial capacity (the area is under-served, room to build more),
   *  while a low `share` means capacity outstrips demand (over-built). The Modern
   *  inspector advice reads this; 0 when there is no reachable capacity. */
  share: number;
}

/** The demand weight of an origin kind, reusing the meal-cadence origin weights
 *  (office 1.0, condo 0.3, hotel 1.0). Returns undefined for a kind that is not
 *  a demand origin (commercial, service, transport, structure). */
function originWeight(kind: string): number | undefined {
  if (kind === "office") return ECON.mealPopulationWeights.office;
  if (kind === "condo") return ECON.mealPopulationWeights.condo;
  if (isHotelKind(kind as never)) return ECON.mealPopulationWeights.hotel;
  return undefined;
}

/** Re-home the tower-wide bonuses the old `trafficAppeal` folded in (an
 *  operational metro pulls in outside visitors, recycling keeps the tower
 *  attractive) so their pull-in-trade incentive survives the swap. Reuses the old
 *  coefficients (metro 0.25, recycling up to 0.1, scaled by how much of the
 *  tower's waste the centers process), but here they MULTIPLY the pool
 *  (`1 + metro + recycling`) rather than ADD to a capped 0..1 appeal, so the two
 *  are not numerically identical: the relative pull is gentler at low population
 *  (where the old appeal sat near its 0.35 base). PROVISIONAL form (multiplier vs
 *  flat floor), settled with the calibration. */
function towerDemandBonus(sim: SimContext): number {
  const metro = sim.hasOperational("metro") ? 0.25 : 0;
  let centers = 0;
  for (const u of sim.tower.units) if (u.kind === "recycling" && isOperational(u)) centers++;
  let recycling = 0;
  if (centers > 0) {
    const pop = sim.tower.totalPopulation();
    const capacity = centers * RECYCLING_POP_PER_CENTER;
    recycling = 0.1 * Math.min(1, capacity / Math.max(1, pop));
  }
  return 1 + metro + recycling;
}

/**
 * Compute the demand map from the current census and layout. Draws no RNG and
 * mutates nothing, so it adds no draw to the seeded economy stream and can be
 * memoized freely. The per-origin demand BUDGET reads the statistical census
 * (`residentCount`), never the drawn crowd. The one exception is the tower-wide
 * recycling multiplier in {@link towerDemandBonus}, which reads
 * `tower.totalPopulation()` (the same population the recycling system itself
 * uses, and what the old `trafficAppeal` read) so its overflow ratio stays in
 * step with `recyclingDemandMet`; that read includes live venue customers, a
 * coarse tower-wide factor, so the map is a pure function of census + layout
 * only when no recycling center is present.
 */
export function computeDemandMap(sim: SimContext): DemandMap {
  const fractionByUnit = new Map<number, number>();
  const deliveredByUnit = new Map<number, number>();
  const reachableVenuesByOrigin = new Map<number, number>();

  // The same lobby-anchored reachability the income loop uses: a floor draws
  // visitors when it is reachable within the two-ride rule (or merely served in
  // a minimal test context that omits the crowd BFS).
  const reachCache = new Map<number, boolean>();
  const draws = (floor: number): boolean => {
    const cached = reachCache.get(floor);
    if (cached !== undefined) return cached;
    const hit = sim.floorReachable ? sim.floorReachable(floor) : sim.tower.isFloorServed(floor);
    reachCache.set(floor, hit);
    return hit;
  };

  // Reachable venues and their headline capacity.
  const venues: { id: number; cap: number }[] = [];
  let totalCap = 0;
  for (const u of sim.tower.units) {
    const cap = ECON.dailyTrafficIncome[u.kind];
    if (cap === undefined) continue; // not a traffic venue
    if (!isOperational(u)) continue; // gutted / burning / under construction earns nothing
    if (!draws(u.floor)) continue; // stranded: no patrons, contributes no capacity
    venues.push({ id: u.id, cap });
    totalCap += cap;
  }

  // The connected demand pool: weighted census of occupied origins whose own
  // floor is reachable (a stranded origin's residents cannot reach any venue).
  const rules = sim.rules ?? MODERN_RULES;
  const { perCapita, floor } = rules.demandModel();
  const reachableVenueCount = venues.length;
  let pool = 0;
  for (const u of sim.tower.units) {
    const w = originWeight(u.kind);
    if (w === undefined) continue; // not a demand origin
    // Present and spending: an occupied office/condo (state "occupied"), or a
    // hotel room with a guest. A guest-occupied hotel sits in the "asleep"
    // state, never "occupied"/"vacating", so isTenanted alone would drop every
    // hotel origin and starve a hotel-heavy tower's commerce (the milestones
    // census includes the same "asleep" clause).
    if (!isTenanted(u) && u.state !== "asleep") continue; // empty space spends nothing
    if (!draws(u.floor)) {
      reachableVenuesByOrigin.set(u.id, 0); // stranded origin: reaches nothing
      continue;
    }
    reachableVenuesByOrigin.set(u.id, reachableVenueCount);
    pool += residentCount(u) * w * perCapita;
  }
  pool *= towerDemandBonus(sim);

  // Capacity-proportional distribution reduces to a uniform share under
  // lobby-anchored reachability (see the module note): D_v = pool * cap_v /
  // totalCap, so D_v / cap_v = pool / totalCap for every reachable venue.
  const share = totalCap > 0 ? pool / totalCap : 0;
  // Each reachable venue earns the plain `min(1, share)`, floored by the mode's
  // small-tower assist. The identity-below-cap shape is what conserves the pool:
  // while `floor <= share < 1` every venue earns exactly `share`, so total
  // delivered = sum(frac * cap_v) = share * totalCap = pool, and adding a venue
  // dilutes every venue's share (cross-venue cannibalization) without inflating
  // the total. Two documented departures from that identity, both intended: above
  // the cap (`share >= 1`) a venue earns 1, holding income to the advertised daily
  // figure (the appeal cap); and below the floor (`share < floor`, the Modern
  // street-trade case) every venue earns `floor`, a deliberate small-tower subsidy
  // that pays out ABOVE the pool. A per-venue curve that lifted the fraction above
  // the identity BETWEEN floor and cap, by contrast, would inflate the total as
  // venues are added and break cannibalization: that is why the soft shoulder was
  // dropped. Both modes share this shape; only `perCapita` and `floor` differ (see
  // GameRules.demandModel).
  const frac = Math.max(floor, Math.min(1, share));
  for (const v of venues) {
    fractionByUnit.set(v.id, frac);
    deliveredByUnit.set(v.id, frac * v.cap);
  }
  return { fractionByUnit, deliveredByUnit, reachableVenuesByOrigin, share };
}

/**
 * The memoized demand map for the full simulation, keyed on
 * `(tower.revision, absolute hour)`. The income loop calls {@link computeDemandMap}
 * directly on its hourly tick (money never reads this memo); this accessor serves
 * the inspector's per-hover reads. Caveat: `tower.revision` bumps only on layout
 * edits, so an occupancy change (a lease signed, a guest arriving) or crowd
 * movement WITHIN an hour is not reflected in the memoized map until the next
 * hour boundary or the next build edit. That is a bounded inspector-readout lag
 * only; it never affects income. Follows the `noiseMemo` pattern: transient,
 * never serialized, and load/undo build a fresh Simulation so no stale memo
 * survives a restore.
 */
export function demandMap(sim: Simulation): DemandMap {
  const key = `${sim.tower.revision}:${Math.floor(sim.clock.minutes / 60)}`;
  if (sim.demandMemo && sim.demandMemoKey === key) return sim.demandMemo;
  const map = computeDemandMap(sim);
  sim.demandMemo = map;
  sim.demandMemoKey = key;
  return map;
}
