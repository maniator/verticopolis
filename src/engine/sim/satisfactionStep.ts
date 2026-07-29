import type { Simulation } from "../Simulation";
import type { Unit } from "../types";
import { rentOf, rentConfig } from "../econConfig";
import { isHotelKind, isLeaseAmenityKind, isUnmetDemandKind } from "../facilities";
import { isRentalKind } from "../residentialRentals";
import { isTenanted, isOperational } from "../types";
import { computeDemandMap, originDemand, type DemandMap } from "./demand";
import { reachesLobby, unmetCoverage } from "./gripe";
import {
  NOISE_CAP,
  NOISE_EROSION,
  CONDO_NOISE_EROSION,
  RENTAL_STUDIO_NOISE_EROSION,
  TRANSPORT_FAR_TILES,
  LOBBY_NO_DRAIN,
  SERVED_RECOVERY,
  GRIPE_WARN,
  VACATE_RESCIND,
} from "./constants";
import { CLASSIC_HOUSEHOLD } from "../households";

/**
 * The PURE per-unit satisfaction step, extracted verbatim from
 * `updateSatisfaction` so that BOTH the authoritative per-tick update AND the
 * move-in sustainability gate ({@link wouldEvictFreshTenant})
 * read ONE source of truth (spec-move-in-sustainability-gate-2026-07-23). The
 * operation order and every `Math.min`/`Math.max` clamp are preserved exactly, so
 * `u.satisfaction = satisfactionStep(sim, u, u.satisfaction, ctx).next` is
 * bit-identical to the old in-place mutation, which the golden-master hashes
 * prove (both must stay byte-identical when this lands as a pure move).
 *
 * The step draws NO RNG and mutates neither `u` nor the tower, so the gate can
 * iterate it against a hypothetical fresh tenant without perturbing the seeded
 * stream. The RNG congestion toast and the notice/vacate/rescind state machine
 * stay behind in `updateSatisfaction`, consuming the flags returned here.
 */

/** Per-sweep context gathered ONCE (halo floor-sets, congestion, coverage), then
 *  read by every unit's step. `demandMap` is built lazily on the first unit that
 *  needs coverage, exactly as the old inline `demandMap ??= ...` did. */
export interface SatisfactionContext {
  congMap: Map<number, number> | null;
  globalCong: number;
  servedSet: Set<number>;
  clubFloors: number[];
  nightclubFloors: number[];
  spaFloors: number[];
  daycareFloors: number[];
  demandMap: DemandMap | null;
}

/** The step's outputs: the next satisfaction plus the cause flags the notice/
 *  vacate logic and the gate's cause attribution consume. */
export interface SatisfactionStepResult {
  next: number;
  served: boolean;
  cong: number;
  farWalk: boolean;
  noisy: boolean;
  lobbyFar: boolean;
  unmetDemand: boolean;
}

/** The floor distance from `floor` to the nearest floor in `floors`, or Infinity
 *  if empty. Used by the Modern amenity halos so only the nearest source counts. */
function nearestFloorDist(floors: number[], floor: number): number {
  let nearest = Infinity;
  for (const f of floors) {
    const d = Math.abs(f - floor);
    if (d < nearest) nearest = d;
  }
  return nearest;
}

/** Build the once-per-sweep context: congestion (spatial v2 or the v1 scalar),
 *  the served-floor set, the four Modern amenity floor-sets (each gated exactly
 *  as the old inline gather), and a null demand-map to be filled lazily. Pure.
 *
 *  `neutralizeCongestion` zeroes the congestion channel. The move-in gate passes
 *  it: the gate judges a spot's STATIC placement (noise, distance, rent, retail
 *  coverage), and congestion is the one time-varying input (rush-hour peaks that
 *  recover off-peak). Freezing a single snapshot and replaying it across the
 *  forward horizon would model a permanent rush and refuse a well-placed condo or
 *  office in a momentarily busy tower, even in Classic. A congestion problem is
 *  operational (add cars), surfaced by its own gripe, not a reason to hold a spot
 *  vacant. The per-tick update keeps the live congestion (default false). */
export function buildSatisfactionContext(sim: Simulation, neutralizeCongestion = false): SatisfactionContext {
  const congMap = !neutralizeCongestion && sim.simModel === "v2" ? sim.spatialCongestionByFloor() : null;
  const globalCong = neutralizeCongestion ? 0 : congMap ? Math.max(0, ...[0, ...congMap.values()]) : sim.congestion();
  const servedSet = sim.tower.servedFloors();
  const clubFloors: number[] = [];
  const nightclubFloors: number[] = [];
  const spaFloors: number[] = [];
  const daycareFloors: number[] = [];
  for (const c of sim.tower.units) {
    if (c.kind === "fitnessClub" && isTenanted(c) && servedSet.has(c.floor)) clubFloors.push(c.floor);
    else if (c.kind === "nightclub" && isOperational(c) && servedSet.has(c.floor)) nightclubFloors.push(c.floor);
    else if (c.kind === "spa" && isOperational(c) && servedSet.has(c.floor)) spaFloors.push(c.floor);
    else if (c.kind === "daycare" && isOperational(c) && servedSet.has(c.floor)) daycareFloors.push(c.floor);
  }
  return { congMap, globalCong, servedSet, clubFloors, nightclubFloors, spaFloors, daycareFloors, demandMap: null };
}

/**
 * Compute a unit's next satisfaction from `current` and the sweep `ctx`, plus the
 * cause flags. Verbatim transcription of the old inline body (served/cong/recovery
 * -> rent pressure -> the four halos -> the shared placement/lobby/unmet erosion),
 * threading the running value through a LOCAL instead of mutating `u.satisfaction`.
 */
export function satisfactionStep(
  sim: Simulation,
  u: Unit,
  current: number,
  ctx: SatisfactionContext,
): SatisfactionStepResult {
  // Served is floor-level (the batch-shared, injectable ctx gate) AND segment-aware
  // (#647): a unit on a disconnected half of a gap-split floor reads unserved even
  // though the floor does. On a gap-free floor the segment IS the floor, so
  // `reachesLobby` collapses to the floor gate and this equals `ctx.servedSet.has`.
  const served = ctx.servedSet.has(u.floor) && reachesLobby(sim, u);
  const cong = ctx.congMap ? (ctx.congMap.get(u.floor) ?? 0) : ctx.globalCong;
  const churn = sim.rules.churnMultiplier(u.residents);
  let s = current;
  if (!served) {
    s = Math.max(0, s - 0.15 * churn);
  } else if (u.floor !== 1 && cong > 1) {
    s = Math.max(0, s - 0.04 * Math.min(3, cong - 1) * churn);
  } else {
    s = Math.min(1, s + SERVED_RECOVERY);
  }
  // Rent pressure: gouging past the going rate erodes satisfaction. Rentals are
  // lease tenants too (the GDD's "rent too high"), so they carry the same discipline.
  if ((u.kind === "office" || isLeaseAmenityKind(u.kind) || isRentalKind(u.kind)) && served) {
    const cfg = rentConfig(u.kind)!;
    const over = (rentOf(u) - cfg.default) / cfg.default; // <0 cheap, >0 pricey
    s = Math.max(0, Math.min(1, s - over * 0.07));
  }
  // The Apartment joins the condo for every residential halo: it is the demanding
  // tier, so it must feel the nightclub above it AND get the amenity offsets that
  // steady a lively spot. Without both it was strictly LESS demanding than the
  // condo it is meant to out-demand, and the gate held it vacant where a condo
  // would have leased. The Studio stays out: it is the forgiving tier.
  if ((u.kind === "condo" || u.kind === "rentalApartment") && served && ctx.clubFloors.length > 0) {
    const bonus = sim.rules.fitnessHaloBonus(nearestFloorDist(ctx.clubFloors, u.floor));
    if (bonus > 0) s = Math.min(1, s + bonus);
  }
  if ((u.kind === "condo" || isHotelKind(u.kind) || u.kind === "rentalApartment") && served && ctx.nightclubFloors.length > 0) {
    const penalty = sim.rules.nightclubNoisePenalty(nearestFloorDist(ctx.nightclubFloors, u.floor));
    if (penalty > 0) s = Math.max(0, s - penalty);
  }
  if (isHotelKind(u.kind) && served && ctx.spaFloors.length > 0) {
    const bonus = sim.rules.spaSerenityBonus(nearestFloorDist(ctx.spaFloors, u.floor));
    if (bonus > 0) s = Math.min(1, s + bonus);
  }
  if ((u.kind === "condo" || u.kind === "rentalApartment") && served && ctx.daycareFloors.length > 0) {
    const bonus = sim.rules.daycareFamilyBonus(nearestFloorDist(ctx.daycareFloors, u.floor), u.residents ?? 0);
    if (bonus > 0) s = Math.min(1, s + bonus);
  }
  // Far-walk (#502): the demanding rental Apartment also erodes when its nearest
  // reachable shaft is beyond the walking tolerance (the forgiving Studio does not).
  const farWalk =
    (u.kind === "office" || u.kind === "rentalApartment") &&
    served &&
    u.floor !== 1 &&
    sim.tower.nearestTransportDistance(u) > TRANSPORT_FAR_TILES;
  const noisy =
    (u.kind === "office" || isHotelKind(u.kind) || u.kind === "condo" || isRentalKind(u.kind)) && served && sim.noiseAfflicted(u);
  const lobbyDrain =
    served && (u.kind === "office" || isHotelKind(u.kind) || u.kind === "condo" || u.kind === "rentalApartment")
      ? sim.rules.lobbyDistanceDrain(sim.tower.nearestLobbyFloorDistance(u.floor))
      : LOBBY_NO_DRAIN;
  const lobbyCapped = lobbyDrain.cap < 1;
  // Rentals are demand origins now (#661: originWeight admits them at the
  // condo's per-resident weight, so a tenanted rental's id is in the origin
  // registry), and the Apartment carries the unmet-demand drain the GDD
  // intended, live and in the gate alike. The Studio stays out: it is the
  // forgiving tier, so its coverage read stays null and the drain never fires
  // for it even though its residents still feed the demand pool.
  const coverage =
    served && isUnmetDemandKind(u.kind)
      ? unmetCoverage((ctx.demandMap ??= computeDemandMap(sim)), u)
      : null;
  const unmetDrain = coverage === null ? LOBBY_NO_DRAIN : sim.rules.unmetDemandDrain(coverage);
  const unmetCapped = unmetDrain.cap < 1;
  if (farWalk || noisy || lobbyCapped || unmetCapped) {
    // Three tiers, not two: the Studio erodes BELOW the served recovery so noise
    // caps it and never evicts it (the forgiving tier), a sold condo just above,
    // and everyone else at the steep office rate.
    const baseErosion =
      u.kind === "rentalStudio"
        ? RENTAL_STUDIO_NOISE_EROSION
        : u.kind === "condo" && u.everOccupied
          ? CONDO_NOISE_EROSION
          : NOISE_EROSION;
    const scale = farWalk ? 1 : sim.rules.noiseErosionScale();
    const placementErosion = farWalk || noisy ? baseErosion * scale : 0;
    const erosion = Math.max(placementErosion, lobbyDrain.erosion, unmetDrain.erosion);
    const cap = Math.min(farWalk || noisy ? NOISE_CAP : 1, lobbyDrain.cap, unmetDrain.cap);
    s = Math.max(0, Math.min(s - erosion, cap));
  }
  const lobbyFar = lobbyDrain.cap <= GRIPE_WARN;
  const unmetDemand = unmetDrain.erosion > 0;
  return { next: s, served, cong, farWalk, noisy, lobbyFar, unmetDemand };
}

/** How many hourly steps the gate simulates forward before reading the trend: two
 *  in-game days, long enough for a spot's trajectory to settle past the one-time
 *  drop to any annoyance ceiling while staying cheap (each step is memoized-lookup
 *  bound, and the loop early-exits the moment the verdict is decided). The horizon
 *  is a trend window, NOT a "must evict within N hours" deadline: a spot still
 *  eroding at the end is gated even if it has not yet crossed the bar, since the
 *  erosion is a constant per-hour subtraction and will cross it in time. */
const GATE_HORIZON_HOURS = 48;

/**
 * The move-in sustainability gate's predicate (spec-move-in-sustainability-gate-2026-07-23):
 * would a fresh tenant seated into this currently-empty condo/office just be
 * eroded below the leave bar ({@link VACATE_RESCIND}) and evicted again, so the
 * spot should stay VACANT instead of selling/leasing and churning forever?
 *
 * It runs the SAME authoritative {@link satisfactionStep} the per-tick update
 * runs, against the tenant the move-in WOULD produce, from a fresh satisfaction
 * of 1:
 *  - A condo is probed as a mean {@link CLASSIC_HOUSEHOLD} at the SOLD-condo
 *    erosion rate (`everOccupied: true` selects `CONDO_NOISE_EROSION`), NOT the
 *    steeper unsold rate, so a spot a real family would hold via a daycare or
 *    fitness halo is not over-blocked. An office keeps its own residents.
 *  - The clone is shallow, keeping `id`/`floor`/`x`/`width`, so every spatial
 *    lookup (noise, transport, lobby, coverage) resolves to the real spot.
 *
 * Early-exits as soon as the verdict is decided: block the moment satisfaction
 * crosses below the bar, allow the moment it stabilizes or recovers at/above the
 * bar. If it is STILL eroding at the end of the horizon (it dropped on every
 * step, never stabilizing), it is gated too: the per-hour erosion is a constant
 * subtraction, so a tenant on that downward line crosses the bar in time and
 * would just churn, which is exactly the slow condo/office slide this fixes.
 * Draws no RNG and mutates nothing, so gating a candidate only skips that
 * candidate's own move-in draw (the seeded stream is otherwise untouched).
 */
export function wouldEvictFreshTenant(sim: Simulation, u: Unit, ctx: SatisfactionContext): boolean {
  const probe: Unit = {
    ...u,
    everOccupied: true,
    // Probe a condo OR a rental Apartment as a mean household, so a spot a real
    // family would churn out of is gated (a vacant Apartment has no residents yet,
    // so it would otherwise probe as a single and pass). The single-occupant
    // Studio keeps its undefined residents (churnMultiplier reads that as 1); an
    // office keeps its own.
    residents: u.kind === "condo" || u.kind === "rentalApartment" ? CLASSIC_HOUSEHOLD : u.residents,
  };
  // The would-be tenant is not yet a census origin, so computeDemandMap omits it
  // from reachableVenuesByOrigin and unmetCoverage would return null, silently
  // skipping the unmet-demand drain: a retail-starved Modern spot would lease,
  // become an origin on the next sweep, erode out, and churn, the exact loop this
  // gate stops. Register the probe as a demand origin on its own floor, mirroring
  // exactly how computeDemandMap registers a real origin: the reachable-venue count
  // when its floor draws (the lobby-anchored model gives every reachable origin the
  // same reachable-venue set), else 0 (retail exists but this floor reaches none).
  // Skipped for the kinds the coverage drain never reads (the guard below):
  // the forgiving Studio and the lease amenities (#667). For them, registering
  // the probe would build a full-tower demand map to compute a value the step
  // never reads; that map is rebuilt per inspector repaint through
  // `wontLeaseText`, so this is the difference between a hover over an empty
  // spot costing a tower scan and costing nothing. The Apartment now registers
  // like a condo (#661: rentals are real demand origins), so the gate judges
  // its unmet-demand drain against the same candidate-aware share.
  const dm = isUnmetDemandKind(u.kind) ? (ctx.demandMap ??= computeDemandMap(sim)) : null;
  if (dm) {
    dm.reachableVenuesByOrigin.set(u.id, sim.floorReachable(u.floor) ? dm.fractionByUnit.size : 0);
  }
  // Judge unmet demand at the share the tower WOULD carry with this tenant added:
  // fold the candidate's OWN demand into the pool (attemptMoveIns further raises
  // dm.pool as vacancies actually fill earlier in the same pass), so the gate never
  // seats a fresh tenant who then over-subscribes the retail and churns, and fills
  // only up to the number the retail supports (a batch-aware, tower-uniform share).
  // Fold the PROBE's demand, not the vacant unit's: the probe models the mean
  // household a lease would seat (a vacant Apartment's catalog population reads
  // a third low), so the gate judges the share the tenant would actually add.
  // For every other gated kind this is a no-op: the probe overrides residents
  // only for condo (where CLASSIC_HOUSEHOLD equals the catalog population) and
  // the Apartment, and keeps the unit's own residents for the rest.
  if (dm) dm.share = dm.totalCap > 0 ? (dm.pool + originDemand(sim, probe, dm.bonus)) / dm.totalCap : 0;
  let s = 1;
  for (let i = 0; i < GATE_HORIZON_HOURS; i++) {
    const prev = s;
    s = satisfactionStep(sim, probe, s, ctx).next;
    if (s < VACATE_RESCIND) return true; // a fresh tenant here erodes out; keep it vacant
    if (s >= prev) return false; // stabilized or recovering above the bar; livable
  }
  // Ran the whole horizon still above the bar but decreasing on every step: a
  // sustained net erosion that crosses the bar in time (any step that held or
  // rose would have returned false above). Keep the spot vacant.
  return true;
}
