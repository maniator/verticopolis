import type { SimContext } from "../SimContext";
import type { Simulation } from "../Simulation";
import { MODERN_RULES } from "../gameRules";
import { ECON } from "../econConfig";
import { RECYCLING_POP_PER_CENTER } from "../facilities";
import { isHotelKind, attendanceCap } from "../facilities";
import { isRentalKind } from "../residentialRentals";
import { residentCount } from "../census";
import { segmentStartX } from "../tower/segments";
import { isOperational, isTenanted } from "../types";
import type { Unit } from "../types";

/**
 * The commercial demand model (gdd/arch-commercial-demand-pools-2026-07-15).
 *
 * Replaces the old tower-wide `trafficAppeal` scalar with a demand POOL built
 * from the connected census: each occupied office/condo/hotel contributes a
 * per-capita budget (weighted by kind, reusing the meal-cadence weights), and
 * that pool is distributed across the reachable RETAIL venues (shop, fast food,
 * restaurant) in proportion to their headline daily capacity. A venue then earns
 * `min(1, D_v / cap_v)` of its daily figure, exactly where `appeal` used to sit.
 * Attendance venues (cinema, party hall) sit OUTSIDE this pool (#424): they draw
 * on a separate live-attendance fill, not the office/condo/hotel demand budget,
 * so they neither dilute the retail share nor consume it. The income loop sources
 * their fraction from `customersIn / attendanceCap` directly.
 *
 * Because the engine's reachability is lobby-anchored (a floor either draws
 * visitors when the router can reach it or it does not, the same gate the income
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
  /** Origin unit id to the count of reachable RETAIL venues (0 when the origin's
   *  own floor is stranded), the coverage signal `leave-tower-unmet-demand` (#395)
   *  will read. Attendance venues (cinema, party hall) are NOT counted here (#424):
   *  they sit outside the retail demand pool, so a tower whose only reachable venue
   *  is a cinema reads 0 retail coverage. A future #395 consumer that treats 0 as
   *  "nowhere to go" should fold in attendance coverage separately if it means to
   *  count the cinema as somewhere residents can spend time. */
  reachableVenuesByOrigin: Map<number, number>;
  /** The raw, UNCAPPED demand pressure `pool / reachableCapacity`, tower-uniform
   *  under the lobby-anchored model. Distinct from `fractionByUnit` (which is
   *  capped at 1 and floored): `share >= 1` means demand meets or outstrips the
   *  reachable commercial capacity (the area is under-served, room to build more),
   *  while a low `share` means capacity outstrips demand (over-built). The Modern
   *  inspector advice reads this; 0 when there is no reachable capacity. */
  share: number;
  /** Count of operational RETAIL venues (shop, fast food, restaurant) BUILT in
   *  the tower, whether or not they are reachable. Distinct from `fractionByUnit`
   *  (which counts only the REACHABLE venues that earn a fraction): a tower whose
   *  retail is all on stranded floors has `retailVenueCount > 0` but an empty
   *  `fractionByUnit`. The unmet-demand exemption (#395) keys on this so a tower
   *  that HAS retail but leaves it all unreachable still penalizes its tenants
   *  (coverage 0), while a tower with no retail at all stays the exempt baseline.
   *  Attendance venues (cinema, party hall) are excluded, matching `fractionByUnit`. */
  retailVenueCount: number;
  /** The connected demand POOL (post tower-bonus dollars) and the reachable retail
   *  CAPACITY it is spread over, the two numbers behind `share` (= pool/totalCap).
   *  Exposed so the move-in gate can judge a candidate against the share the tower
   *  WOULD carry once the candidate (and the vacancies filling alongside it) are
   *  occupied: it adds each would-be tenant's {@link originDemand} to `pool` and
   *  re-derives the share, folding fresh-fill demand into the coverage the gate
   *  reads. `share === totalCap > 0 ? pool / totalCap : 0` holds at construction. */
  pool: number;
  totalCap: number;
  /** The tower-wide demand multiplier (metro/recycling, {@link towerDemandBonus})
   *  captured when the map was built. Every mid-pass pool fold passes this to
   *  {@link originDemand} so the fold carries the SAME multiplier as the pool it
   *  joins: recomputing the bonus live would both rescan the tower per fill (the
   *  bonus reads every unit, and total population when recycling exists) and mix
   *  multipliers, since each fill's population bump nudges the recycling ratio
   *  while the pool's existing terms keep the build-time value. One snapshot
   *  multiplier per map keeps the share arithmetic coherent; the next map build
   *  refreshes everything together. */
  bonus: number;
}

/** Per-unit reachability decision shared by the demand pool and the traffic-income
 *  loop: prefer the segment-granular {@link SimContext.positionReachable} (the real
 *  sim), so a unit on a stranded run of a split floor reads false while a sibling
 *  run is reachable; fall back to floor-level, then plain connectivity, for a
 *  minimal hand-rolled context that omits the crowd BFS. On a gap-free floor a
 *  floor is one segment, so all three agree (byte-identical). */
export function unitReachable(sim: SimContext, floor: number, x: number): boolean {
  return sim.positionReachable
    ? sim.positionReachable(floor, x)
    : sim.floorReachable
      ? sim.floorReachable(floor)
      : sim.tower.isFloorServed(floor);
}

/** The demand weight of an origin kind, reusing the meal-cadence origin weights
 *  (office 1.0, condo 0.3, hotel 1.0). Returns undefined for a kind that is not
 *  a demand origin (commercial, service, transport, structure). */
function originWeight(kind: string): number | undefined {
  if (kind === "office") return ECON.mealPopulationWeights.office;
  if (kind === "condo") return ECON.mealPopulationWeights.condo;
  if (isHotelKind(kind as never)) return ECON.mealPopulationWeights.hotel;
  // Rental residents shop like condo residents (#661): the same per-resident
  // weight, so a Studio's single tenant naturally draws less than an Apartment
  // household. Making rentals real origins is what lets the Apartment's
  // GDD-intended unmet-local-demand churn actually fire (unmetCoverage reads
  // the origin registry this weight admits them to). Modern-only kinds, so
  // Classic's demand pool and the goldens are untouched.
  if (isRentalKind(kind as never)) return ECON.mealPopulationWeights.condo;
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

  // Per-UNIT reachability, matching the income loop: a unit draws (a venue earns,
  // an origin's residents can reach venues) when the router reaches the SEGMENT it
  // sits on, so a venue or origin on a stranded run of a split floor contributes
  // nothing and never dilutes the pool (#647). Byte-identical on a gap-free floor.
  // Memoized per segment: the route BFS isn't free, units share runs.
  const reachCache = new Map<string, boolean>();
  const draws = (u: { floor: number; x: number }): boolean => {
    const key = `${u.floor}:${segmentStartX(sim.tower, u.floor, u.x)}`;
    let hit = reachCache.get(key);
    if (hit === undefined) reachCache.set(key, (hit = unitReachable(sim, u.floor, u.x)));
    return hit;
  };

  // Reachable RETAIL venues and their headline capacity. Attendance venues
  // (cinema, party hall) are deliberately excluded from the pool (#424): their
  // trade is driven by the live-attendance fill (`customersIn / attendanceCap`),
  // not the office/condo/hotel demand budget, so counting their large daily
  // figures here as capacity sinks would dilute the retail share and let a single
  // cinema starve genuine shops. They earn their own fill-derived fraction in the
  // income loop instead, and so never appear in `fractionByUnit`/`deliveredByUnit`.
  const venues: { id: number; cap: number }[] = [];
  let totalCap = 0;
  let retailVenueCount = 0;
  // Capacity reads the SAME mode headline the money loop earns against
  // (GameRules.commercialDailyIncome, #572), so a venue's pool bid and its
  // income anchor are one number in either mode; bare contexts fall back to
  // Modern, the file's standard.
  const rules = sim.rules ?? MODERN_RULES;
  for (const u of sim.tower.units) {
    const cap = rules.commercialDailyIncome(u.kind);
    if (cap === undefined) continue; // not a traffic venue
    if (attendanceCap(u.kind) !== undefined) continue; // attendance venue: earns from live fill, not the retail pool (#424)
    if (!isOperational(u)) continue; // gutted / burning / under construction earns nothing
    retailVenueCount++; // a built, operational retail venue (reachable or not): the #395 exemption reads this
    if (!draws(u)) continue; // stranded run or floor: no patrons, contributes no capacity
    venues.push({ id: u.id, cap });
    totalCap += cap;
  }

  // The connected demand pool: weighted census of occupied origins whose own
  // floor is reachable (a stranded origin's residents cannot reach any venue).
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
    if (!draws(u)) {
      reachableVenuesByOrigin.set(u.id, 0); // stranded origin run or floor: reaches nothing
      continue;
    }
    reachableVenuesByOrigin.set(u.id, reachableVenueCount);
    pool += residentCount(u) * w * perCapita;
  }
  const bonus = towerDemandBonus(sim);
  pool *= bonus;

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
  return { fractionByUnit, deliveredByUnit, reachableVenuesByOrigin, share, retailVenueCount, pool, totalCap, bonus };
}

/**
 * The demand a single would-be origin contributes to the pool: its statistical
 * head count times the kind weight, the per-capita budget, and the tower bonus,
 * matching the pool term {@link computeDemandMap} sums over occupied origins. The
 * move-in gate adds this for a fresh (or filling) tenant so a candidate is judged
 * against the demand it would itself create, not just the pre-move census. Returns
 * 0 for a non-origin kind. `residentCount` reads the catalog population for an
 * empty unit, so a vacancy contributes its would-be household. Draws no RNG.
 *
 * Pass `bonus` (the map's snapshot, {@link DemandMap.bonus}) when folding into an
 * existing pool: it keeps the fold on the pool's own multiplier AND skips the
 * tower scan `towerDemandBonus` costs, so a mass-fill pass stays linear. Omitting
 * it recomputes the bonus live, for a fresh standalone read only.
 */
export function originDemand(sim: SimContext, u: Pick<Unit, "kind" | "residents">, bonus?: number): number {
  const w = originWeight(u.kind);
  if (w === undefined) return 0;
  const rules = sim.rules ?? MODERN_RULES;
  return residentCount(u) * w * rules.demandModel().perCapita * (bonus ?? towerDemandBonus(sim));
}

/** Fold a mid-pass fill into a map's running pool, at the map's own snapshot
 *  bonus. The ONE home for the pool-mutation invariant (see {@link DemandMap.bonus}):
 *  every fill that joins an existing pool goes through here, so no call site can
 *  quietly fold at a live-recomputed multiplier (mixing ratios with the pool's
 *  build-time terms) or pay the tower scan per fill. A non-origin kind folds 0. */
export function foldOriginDemand(dm: DemandMap, sim: SimContext, u: Pick<Unit, "kind" | "residents">): void {
  dm.pool += originDemand(sim, u, dm.bonus);
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
