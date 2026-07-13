/**
 * Importer for original 1994 SimTower `.TDT` saves. This file is the barrel:
 * every public name keeps its `./tdtImport` import path, while the work lives
 * in cohesive siblings:
 *   - `tdtParse.ts`: the parse pass (`parseTDT`).
 *   - `tdtImportHelpers.ts`: the file sniff, tower-name, and seed hash.
 *   - `tdtTables.ts`: the shared semantic tables + placement helpers
 *                     (also imported by the exporter, which inverts them).
 *   - `tdtPartMerge.ts`: the multi-story part merge.
 *   - `tdtTransports.ts`: the elevator/stairs decode + the synthesized fallback.
 *   - `tdtImportReport.ts`: the fidelity report + the shared ImportCounts tally.
 */
import { LegacyImportError, TDT_FLOOR_OFFSET } from "./tdtFormat";

// LegacyImportError and TDT_FLOOR_OFFSET originate in tdtFormat; re-exported
// here so existing importers/tests keep their `./tdtImport` path.
export { LegacyImportError, TDT_FLOOR_OFFSET };

export { parseTDT } from "./tdtParse";
export type { ParsedLegacyTower } from "./tdtParse";
export { looksLikeLegacyTower, towerNameFromFilename } from "./tdtImportHelpers";

export type { ImportReport } from "./tdtImportReport";

export {
  TENANT_KIND,
  PART_FAMILY,
  FAMILY_STORIES,
  ELEVATOR_KINDS,
  TDT_BURNED,
  HOTEL_OCCUPANT_MASK,
  HOTEL_ASLEEP_FLAG,
  HOTEL_DIRTY_FLAG,
  isLobbyFloor,
  rentFromClass,
} from "./tdtTables";

export { synthesizeTransports, transportsFromDecoded } from "./tdtTransports";
export type { DecodedTransports } from "./tdtTransports";
