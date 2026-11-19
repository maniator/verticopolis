/**
 * The numbers the 1994 `.TDT` reports read: the tallies and stats the Rust
 * codec counts while it decodes (`loadTdt`) and encodes (`tdtExport`), as
 * `tdtRecords.ts` reads them off the port. The sentences the player sees are
 * built from these in `storage/tdtImportReport.ts` and
 * `storage/tdtExportReport.ts`.
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
  /** Shops, restaurants and fast food past the 512 style rows a 1994 file holds. */
  retailRowsDropped: number;
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

/** The numbers an export report reads: the engine port answers them as the
 *  `tdtExport` record, with the tower's name. */
export interface ExportReportFacts {
  towerName: string;
  /** The download's name, from the engine (`tdtFilename`). */
  filename: string;
  counts: ExportCounts;
  stats: EncodeStats;
  /** The highest floor and the basement levels the file can contain. */
  topFloor: number;
  basements: number;
}

/** The running tally the Rust codec fills while decoding the floor map. */
export interface ImportCounts {
  rooms: number;
  offices: number;
  occupiedOffices: number;
  condos: number;
  soldCondos: number;
  hotelRooms: number;
  hotelAsleep: number;
  hotelDirty: number;
  hotelBooked: number;
  asleepConverted: number;
  infested: number;
  venues: number; // food, retail, entertainment
  services: number; // security/medical/housekeeping/recycling/parking/ramp/metro/weddingHall
  parkingStalls: number;
  construction: number;
  rentsApplied: number;
  twinRooms: number;
  secom: number;
  cathedral: number;
  burned: number;
  unknown: number;
  droppedFloors: number;
  offLot: number;
  overlapping: number;
  misplaced: number;
  clamped: number;
  widthMismatch: number;
  /** People placed in offices, condos and hotel rooms from the file's own counts. */
  residentsSeeded: number;
}

/** The numbers an import report reads: the engine port answers them as the
 *  `loadTdt` record, with the notes from `tdtNote`. */
export interface ImportReportFacts {
  towerName: string;
  counts: ImportCounts;
  decoded: boolean;
  decodeStats: { droppedShafts: number; adjustedShafts: number; droppedFlights: number };
  /** The save's connected-stall and roster counts, null when it had none. */
  parkingConnected: number | null;
  peopleCount: number | null;
  /** The highest floor built and the basement levels. */
  floors: number;
  basements: number;
  minutes: number;
  /** Elevator shafts, and stairway and escalator flights. */
  shafts: number;
  flights: number;
  star: number;
  money: number;
  /** The header's notes, then the walk's warnings, said as they are. */
  notes: readonly string[];
}
