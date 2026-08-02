import { GRID } from "../engine/facilities";
import type { SerializedGame } from "../engine/types";
import { TDT_ELEVATOR_SLOTS } from "./tdtConstants";
import { legacyFilename } from "./tdtExportTables";
import type { GatheredTower } from "./tdtExportGather";
import type { EncodeStats } from "./tdtEncoder";

/**
 * The reverse fidelity report for a `.TDT` export: an honest account of what
 * the 1994 format can and cannot carry. Extracted from `tdtExport.ts`; reads
 * the gather tally and the encode stats, invents nothing.
 */

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

export function buildExportReport(save: SerializedGame, gathered: GatheredTower, stats: EncodeStats): ExportReport {
  const { extents, counts } = gathered;
  const { balance, money, star } = stats;

  let topFloor = 0;
  let basements = 0;
  for (const [floor] of extents) {
    // Count only floors the encoded file can contain (TDT rows 0-109): a
    // skipped out-of-range room widened extents the reserved rows never
    // echo, and the modal facts must match the bytes.
    if (floor < GRID.minFloor || floor > GRID.maxFloor) continue;
    if (floor > topFloor) topFloor = floor;
    if (floor < 1) basements = Math.max(basements, 1 - floor);
  }
  // Shafts that will actually be THERE in 1994. Every express after the first
  // is lost to the game-side desync (see the staysBehind line below), so
  // counting encoded records here would have the modal promise a shaft in one
  // breath and take it away in the next.
  const shafts = Math.min(stats.elevatorsLen, TDT_ELEVATOR_SLOTS) - Math.max(0, stats.expressLen - 1);
  const flights = stats.walkwaysLen - stats.flightsDropped;
  const comesAlong: string[] = [
    `${counts.rooms.toLocaleString()} room${counts.rooms === 1 ? "" : "s"} with their occupancy and hotel states.`,
    `${shafts} elevator shaft${shafts === 1 ? "" : "s"} with per-floor stop settings, and ${flights} stairway/escalator flight${flights === 1 ? "" : "s"}.`,
    `Your funds (${fmtMoney(balance * 100)}), star rating, and the clock.`,
  ];
  const staysBehind: string[] = [];
  // The 1994 game loses every shaft written after an express one. We order
  // express shafts last so a tower with one loses nothing, but a second express
  // still costs the player the shafts behind it, and the modal must not claim
  // every shaft arrives. See the backlog's `tdt-express-desync`.
  if (stats.expressLen > 1) {
    const lost = stats.expressLen - 1;
    staysBehind.push(
      `${lost} express elevator${lost === 1 ? "" : "s"} won't appear in 1994: the original loses any shaft built after the first express. Rebuild ${lost === 1 ? "it" : "them"} there.`,
    );
  }
  if (counts.burnedOut > 0) {
    staysBehind.push(
      `${counts.burnedOut} burned or burning room${counts.burnedOut === 1 ? " arrives" : "s arrive"} cleared (bare floor, or lobby on a lobby row); rebuild ${counts.burnedOut === 1 ? "it" : "them"} in 1994.`,
    );
  }
  if (counts.vacancyHistoryLost > 0) {
    staysBehind.push(
      `${counts.vacancyHistoryLost} vacant room${counts.vacancyHistoryLost === 1 ? "" : "s"} lose their rental history (1994 only records a sitting tenant).`,
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
    staysBehind.push("Funds round to the nearest $100 (the format stores hundreds).");
  }
  staysBehind.push("The income ledger and finance history start fresh in 1994.");
  staysBehind.push("People in transit are not carried; the crowd re-simulates on load.");
  staysBehind.push("Satisfaction detail resets; tenants re-judge the tower as it runs.");

  return {
    towerName: save.towerName,
    filename: legacyFilename(save.towerName),
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
