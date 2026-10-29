import { legacyFilename } from "./tdtFilename";

/** The elevator slots a `.TDT` file holds. */
const TDT_ELEVATOR_SLOTS = 24;

/** Flights SimTower kept from our exports of towers that have more (#1501). */
const STAIR_FLIGHTS_SIMTOWER_KEEPS = 48;

/**
 * The reverse fidelity report for a `.TDT` export: an honest account of what
 * the 1994 format can and cannot carry. Reads the export tally and the encode
 * stats the Rust codec counts (the `tdtExport` record), invents nothing.
 */

/** Loss/quirk tally of an export. */
export interface ExportCounts {
  rooms: number;
  rentsSnapped: number;
  namesDropped: number;
  hotelStates: number;
  occupied: number;
  construction: number;
  parkingStalls: number;
  burnedOut: number;
  vacancyHistoryLost: number;
  outOfRange: number;
}

/** Numbers the report reads from the encode pass (header money/star + the
 *  transport drops counted while writing the tables). */
export interface EncodeStats {
  balance: number;
  money: number;
  star: number;
  shaftsDropped: number;
  shaftsColliding: number;
  flightsDropped: number;
  transportsDropped: number;
  /** Elevator/walkway counts BEFORE the table caps, for the report's tallies. */
  elevatorsLen: number;
  walkwaysLen: number;
  /** Express shafts written. Every one is sized the way the game sizes it
   *  (doc §8), so none is lost; the count stays in the record for the report
   *  facts. */
  expressLen: number;
}

/** What the reverse fidelity modal shows before the player downloads. */
export interface ExportReport {
  towerName: string;
  /** The DOS-safe filename the download will use. */
  filename: string;
  /** 1–5 stars; 6 = TOWER. */
  star: number;
  /** Funds as the 1994 file will store them (already rounded to $100). */
  money: number;
  floors: number;
  basements: number;
  roomsExported: number;
  /** One honest sentence per thing that makes the trip. */
  comesAlong: string[];
  /** One honest sentence per thing 1994 cannot represent. */
  staysBehind: string[];
}

/** The numbers an export report reads: the engine port answers them as the
 *  `tdtExport` record, with the tower's name. */
export interface ExportReportFacts {
  towerName: string;
  counts: ExportCounts;
  stats: EncodeStats;
  /** The highest floor and the basement levels the file can contain. */
  topFloor: number;
  basements: number;
}

/** The reverse fidelity report from its numbers. */
export function exportReport(facts: ExportReportFacts): ExportReport {
  const { counts, stats, topFloor, basements, towerName } = facts;
  const { balance, money, star } = stats;

  const shafts = Math.min(stats.elevatorsLen, TDT_ELEVATOR_SLOTS);
  const flights = stats.walkwaysLen - stats.flightsDropped;
  const comesAlong: string[] = [
    `${counts.rooms.toLocaleString()} room${counts.rooms === 1 ? "" : "s"} with their occupancy and hotel states.`,
    `${shafts} elevator shaft${shafts === 1 ? "" : "s"} with per-floor stop settings, and ${flights} stairway/escalator flight${flights === 1 ? "" : "s"}.`,
    `Your funds (${fmtMoney(balance * 100)}), star rating, and the clock.`,
  ];
  const staysBehind: string[] = [];
  if (counts.burnedOut > 0) {
    staysBehind.push(
      `${counts.burnedOut} burned or burning room${counts.burnedOut === 1 ? " arrives" : "s arrive"} cleared (bare floor, or lobby on a lobby row); rebuild ${counts.burnedOut === 1 ? "it" : "them"} in 1994.`,
    );
  }
  if (counts.vacancyHistoryLost > 0) {
    staysBehind.push(
      `${counts.vacancyHistoryLost} vacant room${counts.vacancyHistoryLost === 1 ? " loses its" : "s lose their"} rental history (1994 only records a sitting tenant).`,
    );
  }
  if (counts.outOfRange > 0) {
    staysBehind.push(
      `${counts.outOfRange} room${counts.outOfRange === 1 ? " sits" : "s sit"} outside the floors a 1994 save can hold and stayed behind.`,
    );
  }
  if (stats.shaftsDropped > 0) {
    staysBehind.push(
      `${stats.shaftsDropped} elevator shaft${stats.shaftsDropped === 1 ? "" : "s"} past 1994's 24-shaft limit stayed behind.`,
    );
  }
  if (stats.shaftsColliding > 0) {
    staysBehind.push(
      `${stats.shaftsColliding} transport${stats.shaftsColliding === 1 ? "" : "s"} overlap${stats.shaftsColliding === 1 ? "s" : ""} a neighbor at 1994's fixed footprint widths and may be dropped when the save loads.`,
    );
  }
  if (stats.flightsDropped > 0) {
    staysBehind.push(
      `${stats.flightsDropped} stairway/escalator flight${stats.flightsDropped === 1 ? "" : "s"} past 1994's 64-slot table stayed behind.`,
    );
  }
  if (flights > STAIR_FLIGHTS_SIMTOWER_KEEPS) {
    staysBehind.push(
      `With more than ${STAIR_FLIGHTS_SIMTOWER_KEEPS} stairway/escalator flights, SimTower dropped 16 of them when it loaded our test files (a file SimTower saved itself keeps all 64). Check your stairs after loading.`,
    );
  }
  if (stats.transportsDropped > 0) {
    staysBehind.push(
      `${stats.transportsDropped} transport${stats.transportsDropped === 1 ? "" : "s"} couldn't be represented in a 1994 save and stayed behind.`,
    );
  }
  if (counts.namesDropped > 0) {
    staysBehind.push(
      `${counts.namesDropped} custom room name${counts.namesDropped === 1 ? "" : "s"} (the 1994 format has nowhere to keep them).`,
    );
  }
  if (counts.rentsSnapped > 0) {
    staysBehind.push(
      `Exact rents on ${counts.rentsSnapped} room${counts.rentsSnapped === 1 ? "" : "s"} snap to 1994's four lease classes.`,
    );
  }
  if (money !== balance * 100) {
    staysBehind.push(
      "Funds round to the nearest $100 (the format stores hundreds).",
    );
  }
  staysBehind.push(
    "The income ledger and finance history start fresh in 1994.",
  );
  staysBehind.push(
    "People in transit are not carried; the crowd re-simulates on load.",
  );
  staysBehind.push(
    "Satisfaction detail resets; tenants re-judge the tower as it runs.",
  );

  return {
    towerName,
    filename: legacyFilename(towerName),
    star,
    money: balance * 100,
    floors: topFloor,
    basements,
    roomsExported: counts.rooms,
    comesAlong,
    staysBehind,
  };
}

function fmtMoney(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString()}`;
}
