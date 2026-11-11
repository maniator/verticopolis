import type { StatsReport, TowerStats } from "../../simport/panels";
import type { GameMode } from "../../shared/types";
import type { StatsScreen } from "../../ui/templates/stats";
import { catalogFor } from "../catalogFixture";
import { LAYOUT } from "../portKit/mockPort";

/**
 * Hand-built stats screens for the template tests: the report the engine
 * answers (`statsReport` decodes it; its fields on the Rust engine are the
 * engine's panel tests), the header's date and the pinned catalog. A test
 * states the fields its branch reads over a small 1-star tower.
 */

export interface ScreenParts {
  mode?: GameMode;
  towerName?: string;
  stats?: Partial<TowerStats>;
  report?: Partial<Omit<StatsReport, "stats">>;
}

const STATS: TowerStats = {
  population: 6,
  parkingSpaces: 0,
  money: 2_000_000,
  star: 1,
  offices: 1,
  occupiedOffices: 1,
  condos: 0,
  soldCondos: 0,
  hotelRooms: 0,
  occupiedHotel: 0,
  dirty: 0,
  shops: 0,
  restaurants: 0,
  vacant: 0,
  vacantNoRate: 0,
  floors: 2,
  basements: 0,
  elevators: 1,
  transports: 1,
  fires: 0,
};

const LEDGER = { offices: 0, condos: 0, hotels: 0, retail: 0, food: 0, entertainment: 0, upkeep: 0 };

/** The milestone list with `done` marked achieved, in the engine's order. */
export function milestoneList(done: readonly string[] = []): StatsReport["milestones"] {
  const ids = (LAYOUT as unknown as { milestones: string[] }).milestones;
  return { achieved: done.length, total: ids.length, list: ids.map((id) => ({ id, done: done.includes(id) })) };
}

export function statsScreenFor(parts: ScreenParts = {}): StatsScreen {
  const stats = { ...STATS, ...parts.stats };
  const report: StatsReport = {
    stats,
    ratingPopulation: stats.population,
    hotelsCountTowardRating: stats.star < 4,
    functionalParking: 0,
    parkingDemand: { officePop: 0, offices: 0, suites: 0, total: 0 },
    housekeeping: { rooms: 0, crews: 0, maids: 0, dailyCapacity: 0, outOfReach: 0, dirty: 0, infested: 0 },
    housekeepingReport: null,
    recycling: { capacity: 0, demandMet: true },
    strandedFloors: [],
    nextStarThreshold: 300,
    nextStar: { star: 2, isTower: false, popHave: stats.population, popNeed: 300, popMet: false, gates: [], allMet: false },
    milestones: milestoneList(),
    income: { averages: LEDGER, hasData: false },
    elevators: [{ id: 1, kind: "elevatorStandard", bottom: 1, top: 2, cars: 1, capacity: 21, utilization: 0 }],
    vipVisits: 0,
    vipFavorable: false,
    exterminationDueDay: null,
    households: { households: 0, residents: 0, mix: [] },
    ...parts.report,
  };
  const header = { minutes: 420, day: 0, dayOfWeek: 0, isWeekend: false, quarter: 0, year: 0, weekDays: 7, weekendDays: 2, mode: parts.mode ?? "classic" } as StatsScreen["header"];
  return { report, header, towerName: parts.towerName ?? "Tower One", catalog: catalogFor(parts.mode ?? "classic") };
}

/** The ledger with `values` set, every other category at zero. */
export const ledger = (values: Partial<typeof LEDGER>): StatsReport["income"]["averages"] => ({ ...LEDGER, ...values });
