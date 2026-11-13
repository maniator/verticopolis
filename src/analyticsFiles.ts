import { trackEvent } from "./analyticsCore";
import type { GameMode } from "./shared/types";
import type { HeaderView } from "./simport/view";
import type { ImportReportFacts } from "./storage/tdtImportReport";

/**
 * Tower file analytics (owner, 2026-11-13): whether an import or export
 * actually finished, for both file formats, and what a 1994 `.TDT` import had
 * to work around. The `import_*` and `export_*` app actions report the click
 * and `import_failed` / `export_failed` the refusals; these report the
 * outcome the click was for.
 *
 * Every field is a count, a flag or a closed code read from the tower header
 * or the import report's numbers. A tower name, a file name and the report's
 * note text never leave the page. Host-gated and never-throw through
 * {@link trackEvent}.
 */

/** The two tower file formats: the game's own `.vctower` save and the
 *  original 1994 SimTower `.TDT`. */
export type SaveFileFormat = "vctower" | "tdt";

/** What the file events say about the tower: its rule set and size. The
 *  `file_imported` and `file_exported` events carry exactly these fields. */
export type TowerFileProps = { format: SaveFileFormat; mode: GameMode; star: number; population: number };

/** The header fields the file events read. */
type TowerHeader = Pick<HeaderView, "mode" | "star" | "population">;

/** The file event's fields, or null when the header cannot be read: an import
 *  or export that worked must never fail on its own report. */
function towerFileProps(format: SaveFileFormat, header: () => TowerHeader): TowerFileProps | null {
  try {
    const { mode, star, population } = header();
    return { format, mode, star, population };
  } catch {
    return null;
  }
}

/** The header as it stands now, for an event sent later: an export's header
 *  is the one its file was written from, even if the game runs on before the
 *  download. The three fields are copied out, so a header object reused or
 *  changed later cannot change them. A read that throws now throws again when
 *  the event reads it, where the file event swallows it. */
export function headerNow(header: () => TowerHeader): () => TowerHeader {
  try {
    const { mode, star, population } = header();
    const now: TowerHeader = { mode, star, population };
    return () => now;
  } catch (err) {
    return () => {
      throw err;
    };
  }
}

/** A tower file finished importing and the tower it carried is open.
 *  `header` reads the header of the tower that arrived. */
export function trackFileImported(format: SaveFileFormat, header: () => TowerHeader): void {
  const props = towerFileProps(format, header);
  if (props) trackEvent("file_imported", props);
}

/** A tower file's download was handed to the browser. `header` reads the
 *  header of the tower exported. */
export function trackFileExported(format: SaveFileFormat, header: () => TowerHeader): void {
  const props = towerFileProps(format, header);
  if (props) trackEvent("file_exported", props);
}

/** The `.TDT` importer's workarounds the `tdt_import_read` event counts, by
 *  the import report's own count names. Each is something the 1994 file held
 *  that the tower could not take as it was. */
export const TDT_IMPORT_ANOMALIES = [
  "unknown",
  "droppedFloors",
  "offLot",
  "overlapping",
  "misplaced",
  "clamped",
  "widthMismatch",
  "asleepConverted",
] as const satisfies readonly (keyof ImportReportFacts["counts"])[];

/** The transport decode's workarounds, by the report's `decodeStats` names. */
export const TDT_TRANSPORT_ANOMALIES = ["droppedShafts", "adjustedShafts", "droppedFlights"] as const satisfies readonly (keyof ImportReportFacts["decodeStats"])[];

type TdtAnomalyName = (typeof TDT_IMPORT_ANOMALIES)[number] | (typeof TDT_TRANSPORT_ANOMALIES)[number];

/** The `tdt_import_read` fields: the tower's size, whether the transports
 *  decoded and the file carried a people roster, how many notes the report
 *  showed, each anomaly count, and their total for a quick filter. */
export type TdtImportReadProps = { [K in TdtAnomalyName]: number } & {
  star: number;
  floors: number;
  basements: number;
  rooms: number;
  shafts: number;
  flights: number;
  decoded: boolean;
  hasRoster: boolean;
  notes: number;
  anomalies: number;
};

/** The `tdt_import_read` fields for one import report's facts. Only numbers
 *  and flags are read: `towerName` and the notes' text are left behind. */
export function tdtImportReadProps(facts: ImportReportFacts): TdtImportReadProps {
  const counts = {} as { [K in TdtAnomalyName]: number };
  let anomalies = 0;
  for (const name of TDT_IMPORT_ANOMALIES) {
    counts[name] = facts.counts[name];
    anomalies += facts.counts[name];
  }
  for (const name of TDT_TRANSPORT_ANOMALIES) {
    counts[name] = facts.decodeStats[name];
    anomalies += facts.decodeStats[name];
  }
  return {
    ...counts,
    star: facts.star,
    floors: facts.floors,
    basements: facts.basements,
    rooms: facts.counts.rooms,
    shafts: facts.shafts,
    flights: facts.flights,
    decoded: facts.decoded,
    hasRoster: facts.peopleCount !== null,
    notes: facts.notes.length,
    anomalies,
  };
}

/** A `.TDT` read cleanly and its import report is on screen: the caller sends
 *  it from the report's `onShown`. Like the file events, it never stands
 *  between the player and the report. */
export function trackTdtImportRead(facts: ImportReportFacts): void {
  let props: TdtImportReadProps;
  try {
    props = tdtImportReadProps(facts);
  } catch {
    return;
  }
  trackEvent("tdt_import_read", props);
}
