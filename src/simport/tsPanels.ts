import type { HeatmapMode } from "../engine/sim/constants";
import type { Simulation } from "../engine/Simulation";
import { isElevatorKind } from "../engine/facilities";
import { householdMix } from "../engine/households";
import { MILESTONES } from "../engine/milestones";
import { towerCatalog } from "../engine/towerCatalog";
import { unitPrice } from "../ui/catalogPricing";
import type {
  CongestionHotspot,
  HeatCellView,
  HousekeepingCoverageView,
  NextStarView,
  OnboardingFacts,
  StatsReport,
  TowerStats,
  TransportDetail,
  UnitDetail,
} from "./panels";

/**
 * The TypeScript adapter's panel answers (facade slice 4, #1211): each built
 * from the functions the panels called on the `Simulation` before the port,
 * field for field the JSON the Rust panel getter of the same name returns
 * (slice 6b, #1214), so this module is the one TypeScript definition of what
 * a panel shows. The getters' differential (6b's wrapper commit, still held)
 * is to compare the Rust answers with these on the conformance corpus once it
 * lands. It leaves with the TypeScript engine.
 *
 * Every answer is plain JSON: a field the TypeScript leaves undefined is
 * `null`, and each call builds a new object, so a caller may keep it.
 */

const nullish = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

export function tsTowerStats(sim: Simulation): TowerStats {
  return sim.stats();
}

export function tsStatsReport(sim: Simulation): StatsReport {
  const parking = sim.parkingDemand();
  const { averages, hasData } = sim.incomeBreakdown();
  const milestones = sim.achievedMilestones;
  const list = MILESTONES.map((m) => ({ id: m.id, done: milestones.has(m.id) }));
  return {
    stats: sim.stats(),
    ratingPopulation: sim.ratingPopulation(),
    hotelsCountTowardRating: sim.hotelsCountTowardRating(),
    functionalParking: sim.tower.functionalParkingSet().size,
    parkingDemand: { officePop: parking.officePop, offices: parking.offices, suites: parking.suites, total: parking.total },
    housekeeping: tsHousekeepingCoverage(sim),
    housekeepingReport: sim.economy.housekeepingReport(),
    recycling: { capacity: sim.recyclingCapacity(), demandMet: sim.recyclingDemandMet() },
    strandedFloors: sim.strandedFloors(),
    nextStarThreshold: sim.nextStarThreshold,
    nextStar: nextStar(sim),
    milestones: { achieved: list.filter((m) => m.done).length, total: list.length, list },
    income: { averages: { ...averages }, hasData },
    elevators: sim.elevatorStats(),
    vipVisits: sim.vipVisits,
    vipFavorable: sim.vipFavorable,
    exterminationDueDay: nullish(sim.exterminationDueDay),
    households: householdMix(sim.tower),
  };
}

function nextStar(sim: Simulation): NextStarView | null {
  const n = sim.nextStarRequirements();
  if (!n) return null;
  return {
    star: n.star,
    isTower: n.isTower,
    popHave: n.popHave,
    popNeed: n.popNeed,
    popMet: n.popMet,
    gates: n.gates.map((g) => ({ id: g.id, met: g.met })),
    allMet: n.allMet,
  };
}

export function tsHousekeepingCoverage(sim: Simulation): HousekeepingCoverageView {
  const c = sim.housekeepingCoverage();
  return {
    rooms: c.rooms,
    crews: c.crews,
    maids: c.maids,
    dailyCapacity: c.dailyCapacity,
    outOfReach: c.outOfReach,
    dirty: c.dirty,
    infested: c.infested,
  };
}

export function tsUnitDetail(sim: Simulation, id: number): UnitDetail | null {
  const u = sim.tower.getUnit(id);
  if (!u) return null;
  // A metro station is saved on its bottom row, but riders board on the
  // platform floor above it, the floor the card's elevator access reports.
  const accessFloor = u.kind === "metro" ? u.floor + 1 : u.floor;
  return {
    id: u.id,
    kind: u.kind,
    floor: u.floor,
    x: u.x,
    width: u.width,
    state: u.state,
    satisfaction: u.satisfaction,
    occupants: u.occupants,
    customersIn: nullish(u.customersIn),
    residents: nullish(u.residents),
    everOccupied: Boolean(u.everOccupied),
    noRate: Boolean(u.noRate),
    rent: nullish(u.rent),
    price: unitPrice(towerCatalog(sim), u),
    label: u.label,
    subtype: nullish(u.subtype),
    vacateReason: nullish(u.vacateReason),
    filmPolicy: nullish(u.filmPolicy),
    served: sim.tower.isFloorServed(accessFloor),
    reachable: sim.floorReachable(accessFloor),
    floorHasLobby: sim.tower.floorHasLobby(u.floor),
    blockbuster: u.kind === "cinema" ? sim.isShowingBlockbuster(u.id) : null,
  };
}

export function tsTransportDetail(sim: Simulation, id: number): TransportDetail | null {
  const t = sim.tower.getTransport(id);
  if (!t) return null;
  const hourly = sim.elevatorHourlyLoad(id);
  const origins = sim.elevatorOriginLoad(id);
  const stops: { floor: number; served: boolean; lobby: boolean; endpoint: boolean }[] = [];
  if (isElevatorKind(t.kind)) {
    const lobbies = new Set(sim.tower.lobbyFloors());
    for (let fl = t.top; fl >= t.bottom; fl--) {
      stops.push({ floor: fl, served: sim.tower.stopsAt(t, fl), lobby: lobbies.has(fl), endpoint: fl === t.bottom || fl === t.top });
    }
  }
  const ring = (slots: Map<number, number>[]) => slots.map((m) => [...m.entries()]);
  return {
    id: t.id,
    kind: t.kind,
    x: t.x,
    width: t.width,
    bottom: t.bottom,
    top: t.top,
    cars: t.cars,
    capacity: sim.transportCapacity(t),
    utilization: nullish(sim.elevatorUtilization(id)),
    hourly: hourly ? { weekday: [...hourly.weekday], weekend: [...hourly.weekend] } : null,
    origins: origins ? { weekday: ring(origins.weekday), weekend: ring(origins.weekend) } : null,
    stops,
  };
}

export function tsFloorHeatmap(sim: Simulation, mode: HeatmapMode): HeatCellView[] {
  return sim.floorHeatmap(mode);
}

export function tsPeakCongestionHotspot(sim: Simulation): CongestionHotspot {
  return sim.peakCongestionHotspot();
}

/** The Getting Started checklist's facts, in one pass over the units: a
 *  lobby, a floor above the lobby, an office, an office on a floor with a
 *  lobby connection, and an occupied office. */
export function tsOnboardingFacts(sim: Simulation): OnboardingFacts {
  let lobby = false;
  let floor = false;
  let office = false;
  let connect = false;
  let play = false;
  for (const u of sim.tower.units) {
    if (u.kind === "lobby") lobby = true;
    else if (u.kind === "floor") floor ||= u.floor >= 2;
    else if (u.kind === "office") {
      office = true;
      connect ||= sim.tower.isFloorServed(u.floor);
      play ||= u.state === "occupied";
    }
  }
  return { lobby, floor, office, connect, play };
}
