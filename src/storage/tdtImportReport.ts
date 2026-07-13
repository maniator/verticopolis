import type { SerializedGame } from "../engine/types";
import type { TdtTower } from "./tdtFormat";

/**
 * The fidelity-report builder for a `.TDT` import. Extracted from
 * `tdtImport.ts`. The `parseTDT` walk fills an {@link ImportCounts} tally while
 * it decodes; {@link buildReport} turns that tally into the honest
 * player-facing {@link ImportReport} shown before the tower is adopted.
 */

/** What the fidelity-report modal shows before the player adopts the tower. */
export interface ImportReport {
  towerName: string;
  /** 1–5 stars; 6 = TOWER. */
  star: number;
  /** Funds in display dollars (already ×100). */
  money: number;
  /** In-game day the save was on, 1-indexed; matches the report's own
   *  "The clock: day N" line (the engine's Clock.day is 0-indexed). */
  day: number;
  /** Above-ground floors built (highest floor), and basement levels. */
  floors: number;
  basements: number;
  /** Rooms imported (paving and transports not counted). */
  unitsImported: number;
  /** One honest sentence per thing that made it over. */
  broughtOver: string[];
  /** One honest sentence per approximation, divergence, or loss. */
  couldNotBring: string[];
}

/**
 * The running tally `parseTDT` fills while decoding the floor map. Promoted to
 * a shared interface (it used to be an inline object literal in `parseTDT` plus
 * a duplicate parameter shape on `buildReport`) so the producer and consumer
 * cannot drift.
 */
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
}

export function buildReport(
  save: SerializedGame,
  counts: ImportCounts,
  tdt: TdtTower,
  decoded: boolean,
  decodeStats: { droppedShafts: number; adjustedShafts: number; droppedFlights: number },
  headerNotes: string[],
): ImportReport {
  let floors = 0;
  let basements = 0;
  for (const u of save.units) {
    if (u.floor > floors) floors = u.floor;
    if (u.floor < 1) basements = Math.max(basements, 1 - u.floor);
  }
  const day = Math.floor(save.minutes / 1440) + 1; // 1-indexed, as shown to the player
  let shafts = 0;
  let flights = 0;
  for (const t of save.transports) {
    if (t.kind === "stairs" || t.kind === "escalator") flights++;
    else shafts++;
  }

  const broughtOver: string[] = [];
  const rating = save.star >= 6 ? "the TOWER rating" : `your ${save.star}-star rating`;
  // Minus before the dollar sign, matching the stats panel's money formatting.
  const funds = `${save.money < 0 ? "-" : ""}$${Math.abs(save.money).toLocaleString()}`;
  broughtOver.push(`${funds} in funds and ${rating}.`);
  broughtOver.push(
    `${floors} floor${floors === 1 ? "" : "s"} of structure` +
      (basements > 0 ? ` and ${basements} basement level${basements === 1 ? "" : "s"}.` : "."),
  );
  if (decoded) {
    broughtOver.push(
      shafts + flights > 0
        ? `${shafts} elevator shaft${shafts === 1 ? "" : "s"} and ${flights} stairway/escalator flight${flights === 1 ? "" : "s"}, with their stop settings, straight from the save.`
        : "The save had no elevators or stairways built yet.",
    );
  }
  if (counts.offices > 0) {
    broughtOver.push(`${counts.offices} office${counts.offices === 1 ? "" : "s"} (${counts.occupiedOffices} with tenants).`);
  }
  if (counts.condos > 0) {
    broughtOver.push(`${counts.condos} condo${counts.condos === 1 ? "" : "s"} (${counts.soldCondos} sold).`);
  }
  if (counts.hotelRooms > 0) {
    const states: string[] = [];
    if (counts.hotelAsleep > 0) states.push(`${counts.hotelAsleep} with sleeping guests`);
    if (counts.hotelDirty > 0) states.push(`${counts.hotelDirty} awaiting housekeeping`);
    broughtOver.push(
      `${counts.hotelRooms} hotel room${counts.hotelRooms === 1 ? "" : "s"}${states.length ? ` (${states.join(", ")})` : ", ready for guests"}.`,
    );
  }
  if (counts.venues > 0) {
    broughtOver.push(`${counts.venues} food, retail, and entertainment venue${counts.venues === 1 ? "" : "s"}.`);
  }
  if (counts.services > 0) {
    broughtOver.push(`${counts.services} service and special facilit${counts.services === 1 ? "y" : "ies"}.`);
  }
  if (counts.rentsApplied > 0) {
    broughtOver.push(`Rent levels for ${counts.rentsApplied} unit${counts.rentsApplied === 1 ? "" : "s"}, from the save's rent classes.`);
  }
  if (counts.parkingStalls > 0 && tdt.parkingConnected !== null && tdt.parkingConnected <= 512) {
    // 512 is the format's own stall-table size; a bigger count is corrupt and
    // must not be echoed at the player.
    broughtOver.push(
      `${counts.parkingStalls} parking stall${counts.parkingStalls === 1 ? "" : "s"} (the save counted ${tdt.parkingConnected} connected to a ramp).`,
    );
  }
  if (counts.construction > 0) {
    broughtOver.push(`${counts.construction} room${counts.construction === 1 ? "" : "s"} still under construction; work resumes now.`);
  }
  broughtOver.push(`The clock: day ${day}, ${formatClock(save.minutes)}.`);

  const couldNotBring: string[] = [];
  if (!decoded) {
    couldNotBring.push(
      `The save's elevator data couldn't be read, so a working layout was rebuilt from your floors (${shafts} shaft${shafts === 1 ? "" : "s"}).`,
    );
  }
  if (counts.twinRooms > 0) {
    couldNotBring.push(`${counts.twinRooms} twin room${counts.twinRooms === 1 ? "" : "s"} imported as Double Rooms (the closest match).`);
  }
  if (counts.secom > 0) {
    couldNotBring.push(`${counts.secom} SECOM office${counts.secom === 1 ? "" : "s"} imported as Security (SECOM never shipped in the original).`);
  }
  if (counts.cathedral > 0) {
    couldNotBring.push("The Cathedral arrives as our Wedding Hall (a deliberate divergence).");
  }
  if (counts.infested > 0) {
    couldNotBring.push(
      `${counts.infested} bug-infested room${counts.infested === 1 ? "" : "s"} arrived as dirty rooms (infestations don't exist here yet).`,
    );
  }
  if (counts.hotelBooked > 0) {
    couldNotBring.push(
      `${counts.hotelBooked} booked hotel room${counts.hotelBooked === 1 ? "" : "s"} arrived empty and ready to re-book (day guests aren't carried over).`,
    );
  }
  if (counts.asleepConverted > 0) {
    couldNotBring.push(
      `${counts.asleepConverted} room${counts.asleepConverted === 1 ? "" : "s"} with guests asleep past checkout arrived as rooms awaiting housekeeping.`,
    );
  }
  if (decodeStats.droppedShafts > 0) {
    couldNotBring.push(
      `${decodeStats.droppedShafts} elevator shaft${decodeStats.droppedShafts === 1 ? " was" : "s were"} corrupt (impossible position) and stayed behind.`,
    );
  }
  if (decodeStats.adjustedShafts > 0) {
    couldNotBring.push(
      `${decodeStats.adjustedShafts} elevator shaft${decodeStats.adjustedShafts === 1 ? " was" : "s were"} trimmed to fit the buildable range.`,
    );
  }
  if (decodeStats.droppedFlights > 0) {
    couldNotBring.push(
      `${decodeStats.droppedFlights} stairway/escalator flight${decodeStats.droppedFlights === 1 ? "" : "s"} past the 64-link limit (or overlapping another) stayed behind.`,
    );
  }
  if (counts.burned > 0) {
    couldNotBring.push(`${counts.burned} burned-out area${counts.burned === 1 ? " was" : "s were"} cleared back to bare floor.`);
  }
  if (counts.unknown > 0) {
    couldNotBring.push(`${counts.unknown} room${counts.unknown === 1 ? "" : "s"} of a type we don't recognize stayed behind.`);
  }
  if (counts.droppedFloors > 0) {
    couldNotBring.push(
      `${counts.droppedFloors} reserved floor row${counts.droppedFloors === 1 ? "" : "s"} above floor 100 held data and stayed behind.`,
    );
  }
  if (counts.offLot > 0) {
    couldNotBring.push(`${counts.offLot} room${counts.offLot === 1 ? " sat" : "s sat"} outside the lot and stayed behind.`);
  }
  if (counts.overlapping > 0) {
    couldNotBring.push(
      `${counts.overlapping} room${counts.overlapping === 1 ? "" : "s"} overlapped another room and stayed behind.`,
    );
  }
  if (counts.misplaced > 0) {
    couldNotBring.push(
      `${counts.misplaced} room${counts.misplaced === 1 ? " was" : "s were"} on a floor its kind can't occupy (corrupt data) and stayed behind.`,
    );
  }
  if (counts.clamped > 0) {
    couldNotBring.push(`${counts.clamped} room${counts.clamped === 1 ? " was" : "s were"} trimmed to fit the lot edge.`);
  }
  if (counts.widthMismatch > 0) {
    couldNotBring.push(
      `${counts.widthMismatch} room${counts.widthMismatch === 1 ? " keeps" : "s keep"} the original's size, which differs from what new construction here would use.`,
    );
  }
  if (counts.occupiedOffices + counts.soldCondos > 0) {
    couldNotBring.push("Occupancy is approximate: any office or condo with people recorded imports as occupied.");
  }
  if (tdt.peopleCount !== null && tdt.peopleCount > 0) {
    couldNotBring.push(
      `The ${tdt.peopleCount.toLocaleString()} people on the save's roster aren't carried over one by one; your tower re-populates as it runs.`,
    );
  }
  couldNotBring.push("Tenant names and finance history aren't imported yet.");
  couldNotBring.push(...headerNotes);
  couldNotBring.push(...tdt.warnings);

  return {
    towerName: save.towerName,
    star: save.star,
    money: save.money,
    day,
    floors,
    basements,
    unitsImported: counts.rooms,
    broughtOver,
    couldNotBring,
  };
}

/** "7:00 AM"-style clock text for the report. */
function formatClock(minutes: number): string {
  const mod = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(mod / 60);
  const m = Math.floor(mod % 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}
