import { TRANSPORT_FAR_TILES, VACATE_RESCIND, GRIPE_WARN, type Simulation } from "../Simulation";
import { SERVED_RECOVERY } from "../sim/constants";
import { isHotelKind, isLeaseAmenityKind, isUnmetDemandKind } from "../facilities";
import { isRentalKind } from "../residentialRentals";
import { catalogFacility } from "../catalogTypes";
import { towerCatalog } from "../towerCatalog";
import {
  bindingTransportClassAt,
  dominantGripe,
  nearNightclub,
  reachesLobby,
  servingTransportKindsAt,
  unmetCoverage,
} from "../sim/gripe";
import { buildSatisfactionContext, wouldEvictFreshTenant } from "../sim/satisfactionStep";
import { householdMix } from "../households";
import { isPresent, type Unit, type VacateReason } from "../types";
import { KIND_CODES, VIEW_LAYOUT, codeOf } from "./layout";
import { price } from "./queries";
import { flag, whole } from "./record";

/**
 * `TsEngine`'s report queries: the stats screen and one unit's diagnostics
 * facts, slot for slot what the Rust engine answers
 * (`engine-rs/src/wasm_port_reports.rs`). The facts follow the gates
 * `facilityDiagnostics.ts` and `gripeCopy.ts` print their lines on, which
 * the Rust `diagnostics/tenant.rs` ports; the wording stays with them.
 */

const L = VIEW_LAYOUT;
const STATS = L.records.statsStrip as readonly (keyof ReturnType<Simulation["stats"]>)[];
const LEDGER = L.ledgerCats as readonly string[];
const MILESTONES = L.milestones as readonly string[];
const table = (names: readonly string[]): ReadonlyMap<string, number> => new Map(names.map((n, i) => [n, i]));
const STAR_GATES = table(L.starGates);
const ACCESS = table(L.accessLines);
const NO_RATE = table(L.noRateLines);
const BINDINGS = table(L.bindings);
const MODES = table(L.modes);
const VACATE = table(L.vacateReasons);

const nan = (n: number | null | undefined): number => n ?? NaN;
const optFlag = (b: boolean | undefined): number => (b === undefined ? NaN : flag(b));

/** The stats screen as one record: the `statsSheet` header, then the
 *  sections its last six slots count. */
export function statsSheet(sim: Simulation): Float64Array {
  const stranded = sim.strandedFloors();
  const parking = sim.parkingDemand();
  const next = sim.nextStarRequirements();
  const rows = sim.elevatorStats();
  const { averages, hasData } = sim.incomeBreakdown();
  const shift = sim.economy.housekeepingReport();
  const homes = householdMix(sim.tower);
  const achieved = MILESTONES.map((id) => sim.achievedMilestones.has(id));
  const r: number[] = [
    sim.ratingPopulation(),
    flag(sim.hotelsCountTowardRating()),
    sim.tower.functionalParkingSet().size,
    parking.officePop,
    parking.offices,
    parking.suites,
    parking.total,
    nan(shift?.cleaned),
    nan(shift?.leftover),
    sim.recyclingCapacity(),
    flag(sim.recyclingDemandMet()),
    nan(sim.nextStarThreshold),
    sim.vipVisits,
    flag(sim.vipFavorable),
    nan(sim.exterminationDueDay),
    flag(hasData),
    homes.households,
    homes.residents,
    achieved.filter(Boolean).length,
    flag(next !== null),
    next?.gates.length ?? 0,
    stranded.length,
    achieved.length,
    rows.length,
    homes.mix.length,
  ];
  const s = sim.stats();
  r.push(...STATS.map((name) => s[name]));
  const c = sim.housekeepingCoverage();
  r.push(c.rooms, c.crews, c.maids, c.dailyCapacity, c.outOfReach, c.dirty, c.infested);
  r.push(...LEDGER.map((cat) => averages[cat as keyof typeof averages]));
  if (next) {
    r.push(next.star, flag(next.isTower), next.popHave, next.popNeed, flag(next.popMet), flag(next.allMet));
    for (const g of next.gates) r.push(codeOf(STAR_GATES, g.id), flag(g.met));
  }
  r.push(...stranded, ...achieved.map(flag));
  for (const e of rows) r.push(e.id, codeOf(KIND_CODES, e.kind), e.bottom, e.top, e.cars, e.capacity, e.utilization);
  for (const [size, count] of homes.mix) r.push(size, count);
  return Float64Array.from(r);
}

/** A gripe's facts: what its copy (`gripeLineText`) branches on. */
interface Gripe {
  cause: VacateReason;
  binding?: string;
  elevatorHere?: boolean;
  adjacent?: boolean;
  club?: boolean;
  coverage?: number | null;
  floorReachable?: boolean;
}

function gripeFacts(sim: Simulation, u: Unit, cause: VacateReason, cov: number | null | undefined): Gripe {
  const g: Gripe = { cause };
  if (cause === "congestion") {
    const binding = bindingTransportClassAt(sim, u.floor);
    g.binding = binding;
    if (binding === "stairs" || binding === "escalator" || binding === "walkways") {
      g.elevatorHere = servingTransportKindsAt(sim, u.floor).elevator;
    }
  } else if (cause === "noise") {
    g.adjacent = sim.noiseAfflicted(u);
    g.club = (u.kind === "condo" || isHotelKind(u.kind) || u.kind === "rentalApartment") && nearNightclub(sim, u);
  } else if (cause === "unmetDemand") {
    g.coverage = cov === undefined ? unmetCoverage(sim.demandMap(), u) : cov;
    if (g.coverage === 0) g.floorReachable = sim.floorReachable(u.floor);
  }
  return g;
}

function gripeSlots(r: number[], g: Gripe | null): void {
  if (!g) {
    r.push(0, NaN, NaN, NaN, NaN, NaN, NaN, NaN);
    return;
  }
  r.push(
    1,
    codeOf(VACATE, g.cause),
    codeOf(BINDINGS, g.binding),
    optFlag(g.elevatorHere),
    optFlag(g.adjacent),
    optFlag(g.club),
    nan(g.coverage),
    optFlag(g.floorReachable),
  );
}

/** "Won't lease": the gate's verdict on an empty, on-market, reachable spot,
 *  the cause it held the spot for (congestion neutralized) and what holding
 *  it costs a month; null when a tenant would move in. */
function wontLease(sim: Simulation, u: Unit): { gripe: Gripe | null; carry: number } | null {
  if (
    !(u.kind === "office" || u.kind === "condo" || isLeaseAmenityKind(u.kind) || isRentalKind(u.kind)) ||
    u.state !== "empty" ||
    u.noRate ||
    !sim.tower.isFloorServed(u.floor) ||
    !sim.positionReachable(u.floor, u.x)
  ) {
    return null;
  }
  const ctx = buildSatisfactionContext(sim, true);
  if (!wouldEvictFreshTenant(sim, u, ctx)) return null;
  const cov = isUnmetDemandKind(u.kind) && ctx.demandMap ? unmetCoverage(ctx.demandMap, u) : null;
  const drain = cov === null ? null : sim.rules.unmetDemandDrain(cov);
  const unmetActive = drain !== null && (drain.erosion > 0 || drain.cap < 1);
  const cause = dominantGripe(sim, u, undefined, 0, undefined, undefined, undefined, unmetActive, cov);
  const catalog = towerCatalog(sim);
  const holdTax = u.kind === "condo" ? Math.ceil(price(sim, u) * catalog.economy.condoHoldTaxRate) : 0;
  return {
    gripe: cause ? gripeFacts(sim, u, cause, cov) : null,
    carry: catalog.economy.overheadPerUnitMonthly + holdTax,
  };
}

/** Unit `id`'s diagnostics facts in the layout's `unitFacts` slots, or an
 *  empty record for an id that names no unit. */
export function unitFacts(sim: Simulation, id: number): Float64Array {
  const u = whole(id) ? sim.tower.getUnit(id) : undefined;
  if (!u) return new Float64Array(0);
  const k = u.kind;
  const f = catalogFacility(towerCatalog(sim), k);
  const reaches = reachesLobby(sim, u);
  let access: string | undefined;
  if (f.population > 0 || f.dailyIncome !== null) {
    if (!sim.tower.isFloorServed(u.floor)) access = "notConnected";
    else if (!reaches) access = "cutOff";
    else access = sim.positionReachable(u.floor, u.x) ? "reachable" : "noRoute";
  }
  let noRate: string | undefined;
  if (u.noRate) noRate = isPresent(u) ? "occupied" : "offMarket";
  const farWalk =
    (k === "office" || k === "rentalApartment") &&
    u.floor !== 1 &&
    reaches &&
    sim.tower.nearestTransportDistance(u) > TRANSPORT_FAR_TILES;
  const r: number[] = [
    u.id,
    codeOf(KIND_CODES, k),
    codeOf(MODES, sim.rules.mode),
    codeOf(ACCESS, access),
    codeOf(NO_RATE, noRate),
    flag(farWalk),
  ];
  const drain = sim.rules.lobbyDistanceDrain(sim.tower.nearestLobbyFloorDistance(u.floor));
  if ((k === "office" || k === "condo" || isHotelKind(k) || k === "rentalApartment") && reaches && drain.cap < 1) {
    r.push(1, sim.tower.nearestLobbyFloorDistance(u.floor), flag(drain.erosion > SERVED_RECOVERY));
    const slot = sim.tower.nearestBuildableLobbySlot(u.floor);
    if (slot === null) r.push(0, NaN, NaN, NaN, NaN);
    else {
      const onSlot = slot === u.floor;
      const needsSupport = slot > sim.tower.highestFloor + 1;
      const clearFirst = !onSlot && !needsSupport && sim.tower.floorHasRoom(slot);
      r.push(1, slot, flag(onSlot), flag(needsSupport), flag(clearFirst));
    }
  } else r.push(0, NaN, NaN, 0, NaN, NaN, NaN, NaN);
  const griping =
    isPresent(u) &&
    u.state !== "vacating" &&
    u.satisfaction <= GRIPE_WARN &&
    (k === "office" || k === "condo" || isLeaseAmenityKind(k) || isHotelKind(k) || isRentalKind(k));
  const cause = griping ? sim.dominantGripe(u) : null;
  gripeSlots(r, cause ? gripeFacts(sim, u, cause, undefined) : null);
  const held = wontLease(sim, u);
  r.push(flag(held !== null), nan(held?.carry));
  gripeSlots(r, held?.gripe ?? null);
  if (u.state === "vacating" && u.vacateReason) {
    r.push(1, codeOf(VACATE, u.vacateReason), Math.max(0, (u.vacateAt ?? 0) - sim.clock.minutes), u.satisfaction, VACATE_RESCIND);
  } else r.push(0, NaN, NaN, NaN, NaN);
  return Float64Array.from(r);
}
