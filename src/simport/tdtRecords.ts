import type { EncodeStats } from "../storage/tdtEncoder";
import type { ExportReportFacts } from "../storage/tdtExportReport";
import type { ExportCounts } from "../storage/tdtExportGather";
import type { ImportCounts, ImportReportFacts } from "../storage/tdtImportReport";
import type { EnginePort, PortRecord } from "./enginePort";
import type { PortCodes } from "./portCodes";

/**
 * The 1994 `.TDT` reports' numbers, read off the port's `loadTdt` and
 * `tdtExport` records by the layout's slot names (`records.loadTdt`,
 * `records.tdtExport`), in the order both engines write them
 * (`engine-rs/src/wasm_port_files.rs`, `src/engine/port/files.ts`). The
 * sentences stay with `tdtImportReport.ts` and `tdtExportReport.ts`. Read once
 * per file, never per frame.
 */

const IMPORT_COUNTS = [
  "rooms",
  "offices",
  "occupiedOffices",
  "condos",
  "soldCondos",
  "hotelRooms",
  "hotelAsleep",
  "hotelDirty",
  "hotelBooked",
  "asleepConverted",
  "infested",
  "venues",
  "services",
  "parkingStalls",
  "construction",
  "rentsApplied",
  "twinRooms",
  "secom",
  "cathedral",
  "burned",
  "unknown",
  "droppedFloors",
  "offLot",
  "overlapping",
  "misplaced",
  "clamped",
  "widthMismatch",
] as const satisfies readonly (keyof ImportCounts)[];

const EXPORT_COUNTS = [
  "rooms",
  "rentsSnapped",
  "namesDropped",
  "hotelStates",
  "occupied",
  "construction",
  "parkingStalls",
  "burnedOut",
  "vacancyHistoryLost",
  "outOfRange",
] as const satisfies readonly (keyof ExportCounts)[];

const ENCODE_STATS = [
  "balance",
  "money",
  "star",
  "shaftsDropped",
  "shaftsColliding",
  "flightsDropped",
  "transportsDropped",
  "elevatorsLen",
  "walkwaysLen",
  "expressLen",
] as const satisfies readonly (keyof EncodeStats)[];

/** The record's slots by name. */
function slots(rec: PortRecord, names: readonly string[]): (name: string) => number {
  return (name) => rec[names.indexOf(name)];
}

function pick<K extends string>(at: (name: string) => number, keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, at(k)])) as Record<K, number>;
}

const orNull = (v: number): number | null => (Number.isNaN(v) ? null : v);

/** A done `loadTdt`'s import report numbers, with the staged file's notes
 *  and name from `tdtNote` and `tdtTowerName`. */
export function importFacts(
  rec: PortRecord,
  codes: PortCodes,
  port: Pick<EnginePort, "tdtNote" | "tdtTowerName">,
): ImportReportFacts {
  const at = slots(rec, codes.fields("loadTdt"));
  const notes: string[] = [];
  const told = at("notes") + at("warnings");
  for (let i = 0; i < told; i++) notes.push(port.tdtNote(i) ?? "");
  return {
    towerName: port.tdtTowerName() ?? "",
    counts: pick(at, IMPORT_COUNTS),
    decoded: at("decoded") === 1,
    decodeStats: pick(at, ["droppedShafts", "adjustedShafts", "droppedFlights"]),
    parkingConnected: orNull(at("parkingConnected")),
    peopleCount: orNull(at("peopleCount")),
    floors: at("floors"),
    basements: at("basements"),
    minutes: at("minutes"),
    shafts: at("shafts"),
    flights: at("flights"),
    star: at("star"),
    money: at("money"),
    notes,
  };
}

/** A done `tdtExport`'s export report numbers, for the tower named
 *  `towerName`. */
export function exportFacts(rec: PortRecord, codes: PortCodes, towerName: string | undefined): ExportReportFacts {
  const at = slots(rec, codes.fields("tdtExport"));
  return {
    towerName: towerName ?? "",
    counts: pick(at, EXPORT_COUNTS),
    stats: pick(at, ENCODE_STATS),
    topFloor: at("topFloor"),
    basements: at("basements"),
  };
}
