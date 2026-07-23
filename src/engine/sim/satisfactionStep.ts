import type { Simulation } from "../Simulation";
import type { Unit } from "../types";
import { rentOf, rentConfig } from "../econConfig";
import { isHotelKind } from "../facilities";
import { isTenanted, isOperational } from "../types";
import { computeDemandMap, type DemandMap } from "./demand";
import { unmetCoverage } from "./gripe";
import {
  NOISE_CAP,
  NOISE_EROSION,
  CONDO_NOISE_EROSION,
  TRANSPORT_FAR_TILES,
  LOBBY_NO_DRAIN,
  SERVED_RECOVERY,
  GRIPE_WARN,
} from "./constants";

/**
 * The PURE per-unit satisfaction step, extracted verbatim from
 * `updateSatisfaction` so that BOTH the authoritative per-tick update AND the
 * move-in sustainability gate ({@link import("./satisfaction").wouldEvictFreshTenant})
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
 *  as the old inline gather), and a null demand-map to be filled lazily. Pure. */
export function buildSatisfactionContext(sim: Simulation): SatisfactionContext {
  const congMap = sim.simModel === "v2" ? sim.spatialCongestionByFloor() : null;
  const globalCong = congMap ? Math.max(0, ...[0, ...congMap.values()]) : sim.congestion();
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
  const served = ctx.servedSet.has(u.floor);
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
  if ((u.kind === "office" || u.kind === "fitnessClub" || u.kind === "clinic") && served) {
    const cfg = rentConfig(u.kind)!;
    const over = (rentOf(u) - cfg.default) / cfg.default; // <0 cheap, >0 pricey
    s = Math.max(0, Math.min(1, s - over * 0.07));
  }
  if (u.kind === "condo" && served && ctx.clubFloors.length > 0) {
    const bonus = sim.rules.fitnessHaloBonus(nearestFloorDist(ctx.clubFloors, u.floor));
    if (bonus > 0) s = Math.min(1, s + bonus);
  }
  if ((u.kind === "condo" || isHotelKind(u.kind)) && served && ctx.nightclubFloors.length > 0) {
    const penalty = sim.rules.nightclubNoisePenalty(nearestFloorDist(ctx.nightclubFloors, u.floor));
    if (penalty > 0) s = Math.max(0, s - penalty);
  }
  if (isHotelKind(u.kind) && served && ctx.spaFloors.length > 0) {
    const bonus = sim.rules.spaSerenityBonus(nearestFloorDist(ctx.spaFloors, u.floor));
    if (bonus > 0) s = Math.min(1, s + bonus);
  }
  if (u.kind === "condo" && served && ctx.daycareFloors.length > 0) {
    const bonus = sim.rules.daycareFamilyBonus(nearestFloorDist(ctx.daycareFloors, u.floor), u.residents ?? 0);
    if (bonus > 0) s = Math.min(1, s + bonus);
  }
  const farWalk =
    u.kind === "office" && served && u.floor !== 1 && sim.tower.nearestTransportDistance(u) > TRANSPORT_FAR_TILES;
  const noisy =
    (u.kind === "office" || isHotelKind(u.kind) || u.kind === "condo") && served && sim.noiseAfflicted(u);
  const lobbyDrain =
    served && (u.kind === "office" || isHotelKind(u.kind) || u.kind === "condo")
      ? sim.rules.lobbyDistanceDrain(sim.tower.nearestLobbyFloorDistance(u.floor))
      : LOBBY_NO_DRAIN;
  const lobbyCapped = lobbyDrain.cap < 1;
  const coverage =
    served && (u.kind === "office" || isHotelKind(u.kind) || u.kind === "condo")
      ? unmetCoverage((ctx.demandMap ??= computeDemandMap(sim)), u)
      : null;
  const unmetDrain = coverage === null ? LOBBY_NO_DRAIN : sim.rules.unmetDemandDrain(coverage);
  const unmetCapped = unmetDrain.cap < 1;
  if (farWalk || noisy || lobbyCapped || unmetCapped) {
    const baseErosion = u.kind === "condo" && u.everOccupied ? CONDO_NOISE_EROSION : NOISE_EROSION;
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
