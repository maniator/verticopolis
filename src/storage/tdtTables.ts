import { rentConfig } from "../engine/econConfig";
import { FACILITIES, GRID, facilityFloors, isHotelKind } from "../engine/facilities";
import type { FacilityKind } from "../engine/types";

/**
 * Shared semantic tables and placement helpers for the `.TDT` codec: the ONE
 * source of truth the reader (`tdtImport`) and writer (`tdtExport`) both depend
 * on, so their type/flag mappings cannot drift. The exporter inverts these
 * tables; extracting them into this leaf breaks the old import/export coupling
 * (export used to import them from import).
 */

/**
 * Single-story tenant type ID → our FacilityKind (doc §5). IDs 0 (floor),
 * 24 (lobby) and 48 (burned) are structural/cleared and handled by the
 * paving pass; multi-story parts live in {@link PART_FAMILY}; anything in
 * neither table is dropped with a report line.
 */
export const TENANT_KIND: Readonly<Record<number, FacilityKind>> = {
  3: "hotelSingle",
  4: "hotelDouble", // the original's "twin"; closest match, reported as lossy
  5: "hotelSuite",
  6: "restaurant",
  7: "office",
  9: "condo",
  10: "shop",
  11: "parking",
  12: "fastFood",
  13: "medical",
  14: "security",
  15: "housekeeping",
  17: "security", // SECOM; a cut 1994 feature; approximated, reported
  44: "parkingRamp", // parkade ramp (doc §5; [TD]'s corrected reading)
};

/**
 * Multi-story units arrive as one part PER FLOOR (doc §5); top/bottom
 * halves, the theatre's separate screen halves, the metro's three stories,
 * the cathedral's five stacked parts. The importer merges each cluster of
 * parts into ONE unit; placing every part would double- (or quintuple-)
 * place them.
 */
export const PART_FAMILY: Readonly<Record<number, FacilityKind>> = {
  18: "cinema", // theatre top half
  19: "cinema", // theatre bottom half
  34: "cinema", // theatre screen, top
  35: "cinema", // theatre screen, bottom
  20: "recycling",
  21: "recycling",
  29: "partyHall",
  30: "partyHall",
  31: "metro",
  32: "metro",
  33: "metro",
  36: "weddingHall", // the Cathedral's five stacked parts;
  37: "weddingHall", //   our deliberate divergence (PARITY.md)
  38: "weddingHall",
  39: "weddingHall",
  40: "weddingHall",
};

/** How many stories each part family stacks (bounds the merge window). */
export const FAMILY_STORIES: Readonly<Partial<Record<FacilityKind, number>>> = {
  cinema: 2,
  recycling: 2,
  partyHall: 2,
  metro: 3,
  weddingHall: 5,
};

/** The theatre's screen halves: allowed to sit flush AGAINST the hall halves
 *  on the same floor (the one legitimate touch-merge). */
export const SCREEN_PARTS: ReadonlySet<number> = new Set([34, 35]);

/** Elevator table `type` byte → our kind (doc §6): 0 express, 1 standard,
 *  2 service. Shared with the exporter, which inverts it. */
export const ELEVATOR_KINDS: readonly FacilityKind[] = [
  "elevatorExpress",
  "elevatorStandard",
  "elevatorService",
];

/** The metro tunnel: pure backdrop scenery, paved but never a unit and never
 *  merged into the station (a full-lot tunnel would inflate its width). */
export const TDT_METRO_TUNNEL = 45;

export const TDT_FLOOR = 0;
export const TDT_LOBBY = 24;
export const TDT_BURNED = 48;

/** Ceiling on the header's signed day counter (~1,000 in-game years) so a
 *  forged value can't blow the minutes math into precision-loss territory. */
export const MAX_IMPORT_DAY = 360_000;

/** Hotel status-byte flags (unit byte 5; doc §4). */
export const HOTEL_OCCUPANT_MASK = 0x03;
export const HOTEL_ASLEEP_FLAG = 16;
export const HOTEL_DIRTY_FLAG = 32;
export const HOTEL_INFESTED_FLAG = 64;

/** The ground floor (1) and every 15th floor above host a (sky) lobby;
 *  mirrors Tower.ts's isLobbyFloor, which is not exported. Exported so the TDT
 *  exporter can pave floors as the importer reconstructs them (kind by floor,
 *  never by record type): one source, so reader and writer cannot drift. */
export function isLobbyFloor(floor: number): boolean {
  return floor === 1 || (floor > 1 && floor % GRID.lobbyInterval === 0);
}

/** Mirror Tower.roomPlacementReason's floor rules on hostile files: basement-only
 *  kinds (parking, ramp, recycling, metro) stay below ground, no room may cover
 *  the ground concourse, and daylight kinds (offices, condos, hotels) stay above
 *  it. Legitimate 1994 saves already satisfy all three; only corrupt or forged
 *  data trips this, and deserialize doesn't rerun the placement rules. */
export function misplacedOnFloor(kind: FacilityKind, floor: number): boolean {
  const hgt = facilityFloors(kind);
  if (FACILITIES[kind].basement && floor + hgt - 1 >= 1) return true;
  if (floor <= 1 && floor + hgt - 1 >= 1) return true; // covers the ground concourse
  if (floor < 1 && (kind === "office" || kind === "condo" || isHotelKind(kind))) return true;
  // The Wedding Hall crowns floor 100, nowhere else; a real winning save's
  // Cathedral always tops out there, so an off-crown cluster is corrupt data.
  if (kind === "weddingHall" && floor !== GRID.maxFloor) return true;
  return false;
}

/** Map the unit record's rent/lease byte (doc §4: 0 Very Low, 1 Low,
 *  2 Average, 3 High, 4 No Rate) onto our per-kind price band. Average and
 *  No Rate (and garbage) leave the unit on the default via `undefined`. */
export function rentFromClass(kind: FacilityKind, rentClass: number): number | undefined {
  const band = rentConfig(kind);
  if (!band) return undefined;
  switch (rentClass) {
    case 0:
      return band.min;
    case 1: {
      // Halfway between minimum and default, snapped to the band's step grid
      // (the same grid the in-game price editor uses). Guard the divisor: a
      // misconfigured zero step must not mint a NaN rent.
      const step = band.step > 0 ? band.step : 1;
      const mid = (band.min + band.default) / 2;
      return Math.round((mid - band.min) / step) * step + band.min;
    }
    case 3:
      return band.max;
    default:
      return undefined;
  }
}
