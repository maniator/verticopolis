import type { LedgerCat } from "../engine/Ledger";
import type { HeatmapMode } from "../engine/sim/constants";
import type { StarGateId } from "../engine/sim/star";
import type { FacilityKind, UnitState, VacateReason } from "../engine/types";

/**
 * What the panels ask the engine and what it answers (facade slice 4, #1211).
 * Each answer is the JSON the Rust panel getter returns (slice 6b, #1214), so
 * the Rust adapter parses the engine's text into these types and the
 * TypeScript adapter (`tsPanels.ts`) builds the same objects from today's
 * functions. Plain JSON throughout: a field the TypeScript leaves undefined is
 * `null` here, since JSON has none, and a heat cell's `tint` is left out when
 * it has none, as the getter leaves it out.
 */

/** The HUD strip's counters (`stats()`). */
export interface TowerStats {
  readonly population: number;
  readonly parkingSpaces: number;
  readonly money: number;
  readonly star: number;
  readonly offices: number;
  readonly occupiedOffices: number;
  readonly condos: number;
  readonly soldCondos: number;
  readonly hotelRooms: number;
  readonly occupiedHotel: number;
  readonly dirty: number;
  readonly shops: number;
  readonly restaurants: number;
  readonly vacant: number;
  readonly vacantNoRate: number;
  readonly floors: number;
  readonly basements: number;
  readonly elevators: number;
  readonly transports: number;
  readonly fires: number;
}

/** The housekeeping readout (`housekeepingCoverage()`). */
export interface HousekeepingCoverageView {
  readonly rooms: number;
  readonly crews: number;
  readonly maids: number;
  readonly dailyCapacity: number;
  readonly outOfReach: number;
  readonly dirty: number;
  readonly infested: number;
}

/** One rung's progress: the population bar and the facility gates, by id. */
export interface NextStarView {
  readonly star: number;
  readonly isTower: boolean;
  readonly popHave: number;
  readonly popNeed: number;
  readonly popMet: boolean;
  readonly gates: ReadonlyArray<{ readonly id: StarGateId; readonly met: boolean }>;
  readonly allMet: boolean;
}

/** One passenger shaft's average load, busiest first. */
export interface ElevatorStatsRow {
  readonly id: number;
  readonly kind: FacilityKind;
  readonly bottom: number;
  readonly top: number;
  readonly cars: number;
  readonly capacity: number;
  readonly utilization: number;
}

/** Everything the stats screen shows, in one answer. */
export interface StatsReport {
  readonly stats: TowerStats;
  readonly ratingPopulation: number;
  readonly hotelsCountTowardRating: boolean;
  /** How many parking spaces a car can actually reach. */
  readonly functionalParking: number;
  readonly parkingDemand: { readonly officePop: number; readonly offices: number; readonly suites: number; readonly total: number };
  readonly housekeeping: HousekeepingCoverageView;
  /** Yesterday's shift, or null before the first one. */
  readonly housekeepingReport: { readonly cleaned: number; readonly leftover: number } | null;
  readonly recycling: { readonly capacity: number; readonly demandMet: boolean };
  readonly strandedFloors: ReadonlyArray<number>;
  readonly nextStarThreshold: number | null;
  /** Null once the tower is a TOWER. */
  readonly nextStar: NextStarView | null;
  /** Every milestone in the catalog's order, by id. */
  readonly milestones: {
    readonly achieved: number;
    readonly total: number;
    readonly list: ReadonlyArray<{ readonly id: string; readonly done: boolean }>;
  };
  readonly income: { readonly averages: Readonly<Record<LedgerCat, number>>; readonly hasData: boolean };
  readonly elevators: ReadonlyArray<ElevatorStatsRow>;
  readonly vipVisits: number;
  readonly vipFavorable: boolean;
  /** The day a booked exterminator arrives, or null when none is booked. */
  readonly exterminationDueDay: number | null;
  /** Homes in residence (condos and rental apartments), their people, and
   *  how many homes hold each household size, smallest first. */
  readonly households: {
    readonly households: number;
    readonly residents: number;
    readonly mix: ReadonlyArray<readonly [size: number, count: number]>;
  };
}

/** The unit inspector and editor card: the unit's own fields plus what the
 *  engine derives for it. */
export interface UnitDetail {
  readonly id: number;
  readonly kind: FacilityKind;
  readonly floor: number;
  readonly x: number;
  readonly width: number;
  readonly state: UnitState;
  readonly satisfaction: number;
  readonly occupants: number;
  readonly customersIn: number | null;
  readonly residents: number | null;
  readonly everOccupied: boolean;
  readonly noRate: boolean;
  readonly rent: number | null;
  /** The price the card shows (`unitPrice`): 0 off the market, the set price,
   *  or the catalog default. */
  readonly price: number;
  readonly label: string;
  readonly subtype: string | null;
  readonly vacateReason: VacateReason | null;
  readonly filmPolicy: "auto" | "feature" | "blockbuster" | null;
  /** The floor has a lobby connection (`isFloorServed`). */
  readonly served: boolean;
  /** A commuter completes the trip to the floor (`floorReachable`). */
  readonly reachable: boolean;
  readonly floorHasLobby: boolean;
  /** Whether a cinema is booked for the blockbuster; null off a cinema. */
  readonly blockbuster: boolean | null;
}

/** One floor of an elevator's stop list, top floor first. */
export interface StopRow {
  readonly floor: number;
  readonly served: boolean;
  readonly lobby: boolean;
  readonly endpoint: boolean;
}

/** An hour-by-hour figure for weekdays and weekends. */
export interface HourlyView {
  readonly weekday: ReadonlyArray<number>;
  readonly weekend: ReadonlyArray<number>;
}

/** Where riders boarded, per hour: `[floor, riders]` pairs in each slot. */
export interface OriginsView {
  readonly weekday: ReadonlyArray<ReadonlyArray<readonly [floor: number, riders: number]>>;
  readonly weekend: ReadonlyArray<ReadonlyArray<readonly [floor: number, riders: number]>>;
}

/** The transport inspector and editor card. */
export interface TransportDetail {
  readonly id: number;
  readonly kind: FacilityKind;
  readonly x: number;
  readonly width: number;
  readonly bottom: number;
  readonly top: number;
  readonly cars: number;
  /** Riders per trip (`transportCapacity`). */
  readonly capacity: number;
  /** Average car load, or null for a shaft with none recorded. */
  readonly utilization: number | null;
  readonly hourly: HourlyView | null;
  readonly origins: OriginsView | null;
  /** Elevators only; empty for stairs and escalators. */
  readonly stops: ReadonlyArray<StopRow>;
}

/** One run of floor tiles an overlay paints, with its severity. */
export interface HeatCellView {
  readonly floor: number;
  readonly minX: number;
  readonly maxX: number;
  readonly severity: number;
  readonly tint?: "infested" | "na";
}

/** The busiest populated, served floor and its congestion ratio. */
export interface CongestionHotspot {
  readonly ratio: number;
  readonly floor: number | null;
}

/** The five Getting Started steps, each true once the player has done it. */
export interface OnboardingFacts {
  readonly lobby: boolean;
  readonly floor: boolean;
  readonly office: boolean;
  readonly connect: boolean;
  readonly play: boolean;
}

export type { HeatmapMode, StarGateId };
