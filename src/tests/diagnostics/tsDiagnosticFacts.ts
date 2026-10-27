import type { Simulation } from "../../engine/Simulation";
import { GRIPE_WARN, SERVED_RECOVERY, TRANSPORT_FAR_TILES, VACATE_RESCIND } from "../../engine/sim/constants";
import { isHotelKind, isLeaseAmenityKind, isUnmetDemandKind } from "../../engine/facilities";
import { isRentalKind } from "../../engine/residentialRentals";
import { towerCatalog } from "../../engine/towerCatalog";
import { bindingTransportClassAt, dominantGripe, nearNightclub, reachesLobby, servingTransportKindsAt, unmetCoverage } from "../../engine/sim/gripe";
import { buildSatisfactionContext, wouldEvictFreshTenant } from "../../engine/sim/satisfactionStep";
import { isPresent, type Unit, type VacateReason } from "../../engine/types";
import { hasAccessDiagnostic } from "../../game/facilityDiagnostics";
import { unitPrice } from "../../ui/catalogPricing";

/**
 * The TypeScript reference for the engine's diagnostics facts (#1215, facade
 * slice 6c): what `facilityDiagnostics` and `gripeCopy` decide about one unit
 * of the tenant family (PR 1; the later PRs add the other families and
 * `housekeepingDiagnostics`), built from the same TypeScript engine helpers
 * they call, behind the same gates and in the same order, but returning the
 * decision and its numbers instead of the wording. `diagnosticFacts(id)` on
 * the WASM binding must return exactly this for every unit the differential
 * reads (`conformanceWasmDiagnostics*.integration.test.ts`). Slice 4 can
 * adopt it as the TypeScript adapter's facts query.
 */

export type AccessFact = "notConnected" | "cutOff" | "reachable" | "noRoute";

export interface SlotFacts { floor: number; onSlot: boolean; needsSupport: boolean; clearFirst: boolean }

export interface LobbyFacts { distance: number; sinking: boolean; slot: SlotFacts | null }

export interface GripeFacts {
  cause: VacateReason;
  binding?: "elevator" | "stairs" | "escalator" | "walkways" | "none";
  elevatorHere?: boolean;
  adjacent?: boolean;
  club?: boolean;
  coverage?: number;
  floorReachable?: boolean;
}

export interface WontLeaseFacts { gripe?: GripeFacts; carry: number }

export interface NoticeFacts { reason: VacateReason; minutesLeft: number; satisfaction: number; keepAt: number }

export interface DiagnosticFacts {
  id: number;
  kind: string;
  mode: string;
  access?: AccessFact;
  noRate?: "occupied" | "offMarket";
  farWalk?: true;
  lobby?: LobbyFacts;
  gripe?: GripeFacts;
  wontLease?: WontLeaseFacts;
  notice?: NoticeFacts;
}

const lobbyTenant = (u: Unit): boolean =>
  u.kind === "office" || u.kind === "condo" || isHotelKind(u.kind) || u.kind === "rentalApartment";

/** `facilityDiagnostics`' W1 test: no transport at all reads as far. */
const farFromTransport = (sim: Simulation, u: Unit): boolean => sim.tower.nearestTransportDistance(u) > TRANSPORT_FAR_TILES;

/** The facts a cause's copy branches on, read as `gripeLineText` reads them:
 *  `coverage` is the caller's when it passes one (the won't-lease gate's),
 *  else the hour's memoized map. */
function gripeFacts(sim: Simulation, u: Unit, cause: VacateReason, coverage?: number | null): GripeFacts {
  const g: GripeFacts = { cause };
  if (cause === "congestion") {
    g.binding = bindingTransportClassAt(sim, u.floor);
    if (g.binding === "stairs" || g.binding === "escalator" || g.binding === "walkways") {
      g.elevatorHere = servingTransportKindsAt(sim, u.floor).elevator;
    }
  } else if (cause === "noise") {
    g.adjacent = sim.noiseAfflicted(u);
    g.club = (u.kind === "condo" || isHotelKind(u.kind) || u.kind === "rentalApartment") && nearNightclub(sim, u);
  } else if (cause === "unmetDemand") {
    const cov = coverage !== undefined ? coverage : unmetCoverage(sim.demandMap(), u);
    if (cov !== null) g.coverage = cov;
    if (cov === 0) g.floorReachable = sim.floorReachable(u.floor);
  }
  return g;
}

function lobbyFacts(sim: Simulation, u: Unit): LobbyFacts | undefined {
  const distance = sim.tower.nearestLobbyFloorDistance(u.floor);
  const drain = sim.rules.lobbyDistanceDrain(distance);
  if (!(drain.cap < 1)) return undefined;
  const slot = sim.tower.nearestBuildableLobbySlot(u.floor);
  let slotFacts: SlotFacts | null = null;
  if (slot !== null) {
    const onSlot = slot === u.floor;
    const needsSupport = slot > sim.tower.highestFloor + 1;
    const clearFirst = !onSlot && !needsSupport && sim.tower.floorHasRoom(slot);
    slotFacts = { floor: slot, onSlot, needsSupport, clearFirst };
  }
  return { distance, sinking: drain.erosion > SERVED_RECOVERY, slot: slotFacts };
}

/** `wontLeaseText`'s decision: the gate's verdict, the cause it was held for
 *  and the carrying cost `carryingCostNote` prints. */
function wontLeaseFacts(sim: Simulation, u: Unit): WontLeaseFacts | undefined {
  if (
    !(u.kind === "office" || u.kind === "condo" || isLeaseAmenityKind(u.kind) || isRentalKind(u.kind)) ||
    u.state !== "empty" ||
    u.noRate ||
    !sim.tower.isFloorServed(u.floor) ||
    !sim.positionReachable(u.floor, u.x)
  ) {
    return undefined;
  }
  const ctx = buildSatisfactionContext(sim, true);
  if (!wouldEvictFreshTenant(sim, u, ctx)) return undefined;
  const cov = isUnmetDemandKind(u.kind) && ctx.demandMap ? unmetCoverage(ctx.demandMap, u) : null;
  const unmetDrain = cov === null ? null : sim.rules.unmetDemandDrain(cov);
  const unmetActive = unmetDrain !== null && (unmetDrain.erosion > 0 || unmetDrain.cap < 1);
  const cause = dominantGripe(sim, u, undefined, 0, undefined, undefined, undefined, unmetActive, cov);
  const catalog = towerCatalog(sim);
  const holdTax = u.kind === "condo" ? Math.ceil(unitPrice(catalog, u) * catalog.economy.condoHoldTaxRate) : 0;
  const out: WontLeaseFacts = { carry: catalog.economy.overheadPerUnitMonthly + holdTax };
  if (cause) out.gripe = gripeFacts(sim, u, cause, cov);
  return out;
}

/** The tenant family (PR 1 of #1215), in card order. */
export function tsDiagnosticFacts(sim: Simulation, u: Unit): DiagnosticFacts {
  const f: DiagnosticFacts = { id: u.id, kind: u.kind, mode: sim.mode };
  if (hasAccessDiagnostic(towerCatalog(sim), u)) {
    if (!sim.tower.isFloorServed(u.floor)) f.access = "notConnected";
    else if (!reachesLobby(sim, u)) f.access = "cutOff";
    else if (sim.positionReachable(u.floor, u.x)) f.access = "reachable";
    else f.access = "noRoute";
  }
  if (u.noRate) f.noRate = isPresent(u) ? "occupied" : "offMarket";
  if ((u.kind === "office" || u.kind === "rentalApartment") && u.floor !== 1 && reachesLobby(sim, u) && farFromTransport(sim, u)) {
    f.farWalk = true;
  }
  if (lobbyTenant(u) && reachesLobby(sim, u)) {
    const lobby = lobbyFacts(sim, u);
    if (lobby) f.lobby = lobby;
  }
  if (
    isPresent(u) &&
    u.state !== "vacating" &&
    u.satisfaction <= GRIPE_WARN &&
    (u.kind === "office" || u.kind === "condo" || isLeaseAmenityKind(u.kind) || isHotelKind(u.kind) || isRentalKind(u.kind))
  ) {
    const cause = sim.dominantGripe(u);
    if (cause) f.gripe = gripeFacts(sim, u, cause);
  }
  const wontLease = wontLeaseFacts(sim, u);
  if (wontLease) f.wontLease = wontLease;
  if (u.state === "vacating" && u.vacateReason) {
    f.notice = {
      reason: u.vacateReason,
      minutesLeft: Math.max(0, (u.vacateAt ?? 0) - sim.clock.minutes),
      satisfaction: u.satisfaction,
      keepAt: VACATE_RESCIND,
    };
  }
  return f;
}
