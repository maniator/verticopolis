import { rentConfig } from "../engine/econConfig";
import { FACILITIES, GRID, buildMinutes, facilityFloors, isHotelKind, maxCarsFor, maxSpanFor } from "../engine/facilities";
import { SAVE_VERSION } from "../engine/saveMigration";
import { minuteOfDayForFrame } from "../engine/timePacing";
import type { FacilityKind, SerializedGame, Transport, Unit, UnitState } from "../engine/types";
import { LegacyImportError, parseTdtBinary } from "./tdtFormat";
import type { TdtElevator, TdtStair, TdtTenant, TdtTower } from "./tdtFormat";

export { LegacyImportError };

/**
 * Importer for original 1994 SimTower `.TDT` saves: maps the raw
 * {@link TdtTower} the binary walker produces into our {@link SerializedGame}
 * schema plus an honest {@link ImportReport} of what did and didn't survive
 * the trip. The output is deliberately fed through `Simulation.deserialize`
 * by the caller; its trust-boundary hardening is the second validation
 * layer, so nothing here needs to be the last line of defense.
 *
 * Scope (see the backlog's tdt-importer row): the header, floor map,
 * elevator table and stairs table are decoded, including per-floor stop
 * settings, rent classes and hotel room states. When the transport blocks
 * can't be read (truncated/corrupt files), a deterministic layout is
 * SYNTHESIZED from the floor map instead, and the fidelity report says which
 * path ran. People, retail subtypes, finance history and named tenants are
 * queued follow-ups.
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

/** Result of a successful parse: the save plus its fidelity report. */
export interface ParsedLegacyTower {
  save: SerializedGame;
  report: ImportReport;
}

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
const SCREEN_PARTS: ReadonlySet<number> = new Set([34, 35]);

/** Elevator table `type` byte → our kind (doc §6): 0 express, 1 standard,
 *  2 service. Shared with the exporter, which inverts it. */
export const ELEVATOR_KINDS: readonly FacilityKind[] = [
  "elevatorExpress",
  "elevatorStandard",
  "elevatorService",
];

/** The metro tunnel: pure backdrop scenery, paved but never a unit and never
 *  merged into the station (a full-lot tunnel would inflate its width). */
const TDT_METRO_TUNNEL = 45;

const TDT_FLOOR = 0;
const TDT_LOBBY = 24;
export const TDT_BURNED = 48;

/** TDT floor index → our floor: uniform `ours = tdt − 9` (doc §4, proven by
 *  the lobby table; TDT 10/24/39/… = floors 1/15/30/…). */
export const TDT_FLOOR_OFFSET = 9;

/** Ceiling on the header's signed day counter (~1,000 in-game years) so a
 *  forged value can't blow the minutes math into precision-loss territory. */
const MAX_IMPORT_DAY = 360_000;

/** Hotel status-byte flags (unit byte 5; doc §4). */
export const HOTEL_OCCUPANT_MASK = 0x03;
export const HOTEL_ASLEEP_FLAG = 16;
export const HOTEL_DIRTY_FLAG = 32;
const HOTEL_INFESTED_FLAG = 64;

/** The ground floor (1) and every 15th floor above host a (sky) lobby;
 *  mirrors Tower.ts's isLobbyFloor, which is not exported. */
function isLobbyFloor(floor: number): boolean {
  return floor === 1 || (floor > 1 && floor % GRID.lobbyInterval === 0);
}

/** Mirror Tower.roomPlacementReason's floor rules on hostile files: basement-only
 *  kinds (parking, ramp, recycling, metro) stay below ground, no room may cover
 *  the ground concourse, and daylight kinds (offices, condos, hotels) stay above
 *  it. Legitimate 1994 saves already satisfy all three; only corrupt or forged
 *  data trips this, and deserialize doesn't rerun the placement rules. */
function misplacedOnFloor(kind: FacilityKind, floor: number): boolean {
  const hgt = facilityFloors(kind);
  if (FACILITIES[kind].basement && floor + hgt - 1 >= 1) return true;
  if (floor <= 1 && floor + hgt - 1 >= 1) return true; // covers the ground concourse
  if (floor < 1 && (kind === "office" || kind === "condo" || isHotelKind(kind))) return true;
  // The Wedding Hall crowns floor 100, nowhere else; a real winning save's
  // Cathedral always tops out there, so an off-crown cluster is corrupt data.
  if (kind === "weddingHall" && floor !== GRID.maxFloor) return true;
  return false;
}

/** Heuristic for the import UI: is this picked file an original SimTower
 *  save? The .TDT extension first; else sniff the header magic, so a renamed
 *  or extension-less copy of a real save still routes here. */
export function looksLikeLegacyTower(filename: string, bytes?: Uint8Array): boolean {
  if (/\.tdt$/i.test(filename)) return true;
  return !!bytes && bytes.byteLength >= 2 && bytes[0] === 0x00 && bytes[1] === 0x24;
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

/** A multi-story part collected during the floor walk, pre-merge. */
interface PartRecord {
  kind: FacilityKind;
  typeId: number;
  floor: number;
  left: number;
  right: number;
  construction: boolean;
}

/** A merged multi-story unit: the cluster's base floor, top floor, and
 *  horizontal union. */
interface MergedPart {
  kind: FacilityKind;
  floor: number;
  topFloor: number;
  left: number;
  right: number;
  construction: boolean;
}

/**
 * Merge per-floor parts into whole units. Two parts belong to the same
 * building only when their extents STRICTLY overlap within the family's
 * story-height window (a building's stories stack), or, for the theatre
 * alone, when a screen half sits flush against a hall half on the same
 * floor. Plain touching is deliberately NOT enough: two independent
 * same-kind units built flush against each other (or on far-apart floors at
 * the same x) must stay two units. Each cluster becomes one unit anchored at
 * its lowest floor, spanning the horizontal union.
 *
 * Known imperfection: a screen sandwiched exactly between two flush theatres
 * can chain them; the width-mismatch report line flags the result.
 */
function mergeParts(parts: PartRecord[]): MergedPart[] {
  const byFamily = new Map<FacilityKind, PartRecord[]>();
  for (const p of parts) {
    const arr = byFamily.get(p.kind);
    if (arr) arr.push(p);
    else byFamily.set(p.kind, [p]);
  }
  const merged: MergedPart[] = [];
  for (const [kind, records] of byFamily) {
    const stories = FAMILY_STORIES[kind] ?? 1;
    // Union-find over this family's parts (a tower holds at most a few dozen).
    const parent = records.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let i = 0; i < records.length; i++) {
      for (let j = i + 1; j < records.length; j++) {
        const a = records[i];
        const b = records[j];
        const overlaps = a.left < b.right && b.left < a.right;
        const withinStories = Math.abs(a.floor - b.floor) < stories;
        const screenTouch =
          kind === "cinema" &&
          a.floor === b.floor &&
          (a.right === b.left || b.right === a.left) &&
          SCREEN_PARTS.has(a.typeId) !== SCREEN_PARTS.has(b.typeId);
        if ((overlaps && withinStories) || screenTouch) union(i, j);
      }
    }
    const clusters = new Map<number, PartRecord[]>();
    for (let i = 0; i < records.length; i++) {
      const root = find(i);
      const arr = clusters.get(root);
      if (arr) arr.push(records[i]);
      else clusters.set(root, [records[i]]);
    }
    for (const cluster of clusters.values()) {
      // Two same-kind buildings stacked on ADJACENT floor pairs (e.g. one
      // recycling on 10/11 and another on 12/13) chain through the union: the
      // upper half of one sits within the story window of the lower half of
      // the other. Split any cluster taller than the family's story count
      // into consecutive-floor groups so each building stays its own unit.
      cluster.sort((a, b) => a.floor - b.floor);
      let group: PartRecord[] = [];
      const flush = (): void => {
        if (group.length === 0) return;
        const m: MergedPart = {
          kind,
          floor: group[0].floor,
          topFloor: group[0].floor,
          left: group[0].left,
          right: group[0].right,
          construction: group[0].construction,
        };
        for (const p of group) {
          m.left = Math.min(m.left, p.left);
          m.right = Math.max(m.right, p.right);
          m.topFloor = Math.max(m.topFloor, p.floor);
          m.construction = m.construction || p.construction;
        }
        merged.push(m);
        group = [];
      };
      for (const p of cluster) {
        if (group.length > 0 && p.floor - group[0].floor >= stories) flush();
        group.push(p);
      }
      flush();
    }
  }
  return merged;
}

/**
 * Parse an original SimTower `.TDT` buffer into our save schema plus a
 * fidelity report. Throws {@link LegacyImportError} (player-readable) for
 * anything unreadable; never adopts or persists anything itself.
 */
export function parseTDT(buffer: ArrayBuffer, filename: string): ParsedLegacyTower {
  const bytes = new Uint8Array(buffer);
  const tdt: TdtTower = parseTdtBinary(bytes);

  // Header fields are hostile input; every clamp that fires is SAID in the
  // report; the fidelity modal's whole point is honesty about what changed.
  const headerNotes: string[] = [];
  const star = Math.max(1, Math.min(6, tdt.header.level));
  if (tdt.header.level < 1 || tdt.header.level > 6) {
    headerNotes.push(`The save's star rating (${tdt.header.level}) was out of range and was clamped.`);
  }
  const money = tdt.header.balance * 100;
  const day = Math.max(0, Math.min(MAX_IMPORT_DAY, tdt.header.currentDay));
  if (tdt.header.currentDay < 0) {
    headerNotes.push("The save's day counter was negative (a known quirk of the format) and was reset to day 1.");
  } else if (tdt.header.currentDay > MAX_IMPORT_DAY) {
    headerNotes.push("The save's day counter was impossibly far in the future and was clamped.");
  }
  // Clamp the clock into the documented 0–2599 tick range (a u16 can carry
  // more); minuteOfDayForFrame would wrap it anyway, but a corrupt value
  // deserves a report line, not a silent wrap.
  const frame = Math.max(0, Math.min(2599, tdt.header.frameTime));
  if (tdt.header.frameTime > 2599) {
    headerNotes.push("The save's clock was out of range and was reset to the end of the night.");
  }
  // The original's date changes at tick 2300 (midnight), so ticks ≥ 2300 are
  // the small hours of `currentDay` itself; minuteOfDayForFrame already
  // returns 0..419 for them, making the sum below correct on both sides of
  // the wrap (doc §3).
  const minutes = day * 1440 + minuteOfDayForFrame(frame);

  // ---- Floor map → units ---------------------------------------------------
  const counts = {
    rooms: 0,
    offices: 0,
    occupiedOffices: 0,
    condos: 0,
    soldCondos: 0,
    hotelRooms: 0,
    hotelAsleep: 0,
    hotelDirty: 0,
    hotelBooked: 0,
    asleepConverted: 0,
    infested: 0,
    venues: 0, // food, retail, entertainment
    services: 0, // security/medical/housekeeping/recycling/parking/ramp/metro/weddingHall
    parkingStalls: 0,
    construction: 0,
    rentsApplied: 0,
    twinRooms: 0,
    secom: 0,
    cathedral: 0,
    burned: 0,
    unknown: 0,
    droppedFloors: 0,
    offLot: 0,
    overlapping: 0,
    misplaced: 0,
    clamped: 0,
    widthMismatch: 0,
  };
  // Paved tiles per (our) floor; rooms sit ON structure in our model, so the
  // paving pass below re-lays the corridor layer the same way the in-game
  // builder does (width-1 floor/lobby tiles).
  const paved = new Map<number, Uint8Array>();
  const paveRange = (floor: number, left: number, right: number): void => {
    const lo = Math.max(0, Math.min(GRID.width, left));
    const hi = Math.max(0, Math.min(GRID.width, right));
    if (hi <= lo) return;
    let row = paved.get(floor);
    if (!row) {
      row = new Uint8Array(GRID.width);
      paved.set(floor, row);
    }
    row.fill(1, lo, hi);
  };
  // Tiles already claimed by a kept ROOM per floor: a corrupt file can carry
  // overlapping tenant extents, and two units sharing tiles would corrupt the
  // engine's per-tile room index (last-wins on register, shared-tile deletes
  // on unregister); so later overlappers are dropped with a report line.
  const roomClaimed = new Map<number, Uint8Array>();
  const rowFor = (floor: number): Uint8Array => {
    let row = roomClaimed.get(floor);
    if (!row) {
      row = new Uint8Array(GRID.width);
      roomClaimed.set(floor, row);
    }
    return row;
  };
  // Claim EVERY story the engine will register (facilityFloors), or none: a
  // cinema's upper story colliding with a kept room is the same index
  // corruption as a base-floor collision.
  const claimRoom = (kind: FacilityKind, floor: number, left: number, right: number): boolean => {
    const stories = facilityFloors(kind);
    for (let f = floor; f < floor + stories; f++) {
      const row = rowFor(f);
      for (let i = left; i < right; i++) if (row[i]) return false;
    }
    for (let f = floor; f < floor + stories; f++) rowFor(f).fill(1, left, right);
    return true;
  };
  // Clamp a tenant's extents onto the lot. Returns null (and counts) for a
  // degenerate or fully off-lot extent. Extents are u16s (never negative), so
  // only the RIGHT edge can poke past.
  const clampExtent = (t: TdtTenant): { x: number; right: number } | null => {
    const x = t.left;
    let right = t.right;
    if (right <= x || x >= GRID.width) {
      counts.offLot++;
      return null;
    }
    if (right > GRID.width) {
      right = GRID.width;
      counts.clamped++;
    }
    return { x, right };
  };

  let nextId = 1;
  const units: Unit[] = [];
  const partRecords: PartRecord[] = [];
  const pushUnit = (
    kind: FacilityKind,
    floor: number,
    x: number,
    width: number,
    state: UnitState,
    extras: Partial<Unit> = {},
  ): Unit => {
    const unit: Unit = {
      id: nextId++,
      kind,
      floor,
      x,
      width,
      state,
      satisfaction: 1,
      occupants: 0,
      everOccupied: false,
      pendingIncome: 0,
      label: FACILITIES[kind].name,
      ...extras,
    };
    units.push(unit);
    counts.rooms++;
    if (width !== FACILITIES[kind].width) counts.widthMismatch++;
    if (state === "construction") counts.construction++;
    return unit;
  };

  for (const fl of tdt.floors) {
    const ours = fl.index - TDT_FLOOR_OFFSET;
    if (ours > GRID.maxFloor) {
      // Indexes 110–119 are reserved rows (doc §4); never buildable here.
      if (fl.tenants.length > 0 || fl.rightEdge > fl.leftEdge) counts.droppedFloors++;
      continue;
    }
    paveRange(ours, fl.leftEdge, fl.rightEdge);
    for (const t of fl.tenants) {
      const underConstruction = t.type < 0;
      const typeId = Math.abs(t.type);
      if (typeId === TDT_FLOOR || typeId === TDT_LOBBY) {
        paveRange(ours, t.left, t.right);
        continue;
      }
      if (typeId === TDT_BURNED) {
        paveRange(ours, t.left, t.right);
        counts.burned++;
        continue;
      }
      if (typeId === TDT_METRO_TUNNEL) {
        // Backdrop scenery: paved, never a unit, never merged into the
        // station (a full-lot tunnel would inflate the station's width).
        paveRange(ours, t.left, t.right);
        continue;
      }
      const partKind = PART_FAMILY[typeId];
      if (partKind) {
        const ext = clampExtent(t);
        if (!ext) continue;
        paveRange(ours, ext.x, ext.right);
        partRecords.push({
          kind: partKind,
          typeId,
          floor: ours,
          left: ext.x,
          right: ext.right,
          construction: underConstruction,
        });
        continue;
      }
      const kind = TENANT_KIND[typeId];
      if (!kind) {
        counts.unknown++;
        continue;
      }
      const ext = clampExtent(t);
      if (!ext) continue;
      if (misplacedOnFloor(kind, ours)) {
        counts.misplaced++;
        continue;
      }
      if (!claimRoom(kind, ours, ext.x, ext.right)) {
        counts.overlapping++;
        continue;
      }
      paveRange(ours, ext.x, ext.right);

      // State: construction wins; hotels decode their status bit field
      // (doc §4; dirty / occupied-overnight / bug-infested); offices and
      // condos read nonzero status as tenanted; everything else starts empty.
      let state: UnitState = underConstruction ? "construction" : "empty";
      let everOccupied = false;
      let occupants = 0;
      if (!underConstruction && (kind === "office" || kind === "condo") && t.status !== 0) {
        state = "occupied";
        everOccupied = true;
      } else if (!underConstruction && isHotelKind(kind) && t.status !== 0) {
        if (t.status & HOTEL_INFESTED_FLAG) {
          state = "dirty";
          everOccupied = true;
          counts.infested++;
          counts.hotelDirty++;
        } else if (t.status & HOTEL_DIRTY_FLAG) {
          state = "dirty";
          everOccupied = true;
          counts.hotelDirty++;
        } else if (t.status & HOTEL_ASLEEP_FLAG) {
          everOccupied = true;
          // Our engine wakes sleepers only at the NEXT 8:00 checkout. A save
          // written after this morning's checkout (8:00 to 20:00) would leave
          // its guests asleep all day, so those rooms arrive as checked-out
          // rooms awaiting housekeeping instead.
          const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
          if (minuteOfDay >= 8 * 60 && minuteOfDay < 20 * 60) {
            state = "dirty";
            counts.hotelDirty++;
            counts.asleepConverted++;
          } else {
            state = "asleep";
            occupants = Math.max(1, t.status & HOTEL_OCCUPANT_MASK);
            counts.hotelAsleep++;
          }
        } else {
          // Nonzero status without a decoded flag: a booked room whose guests
          // are out in the tower (the normal daytime state). Day guests are
          // not carried over; the room has been booked, so the "ever booked"
          // flag survives.
          everOccupied = true;
          counts.hotelBooked++;
        }
      }
      // Rent class (unit byte 16) → our price band, for priced kinds.
      const rent = rentFromClass(kind, t.rentRate);
      if (rent !== undefined) counts.rentsApplied++;

      pushUnit(kind, ours, ext.x, ext.right - ext.x, state, {
        everOccupied,
        occupants,
        rent,
        ...(underConstruction ? { completeAt: minutes + buildMinutes(kind) } : {}),
      });

      if (kind === "office") {
        counts.offices++;
        if (state === "occupied") counts.occupiedOffices++;
      } else if (kind === "condo") {
        counts.condos++;
        if (state === "occupied") counts.soldCondos++;
      } else if (isHotelKind(kind)) {
        counts.hotelRooms++;
      } else if (kind === "fastFood" || kind === "restaurant" || kind === "shop") {
        counts.venues++;
      } else {
        counts.services++;
        if (kind === "parking") counts.parkingStalls++;
      }
      if (typeId === 4) counts.twinRooms++;
      if (typeId === 17) counts.secom++;
    }
  }

  // ---- Merge multi-story parts into whole units ----------------------------
  for (const m of mergeParts(partRecords)) {
    // The Cathedral CROWNS its five stories; our one-story Wedding Hall
    // stands in at the cluster's TOP floor (floor 100 in a real winning
    // tower, the canon spot), not its base.
    const floor = m.kind === "weddingHall" ? m.topFloor : m.floor;
    // Reject a footprint poking past the buildable top: deserialize would
    // clamp it DOWN a floor, where it could overlap a room this guard
    // already accepted.
    if (floor + facilityFloors(m.kind) - 1 > GRID.maxFloor) {
      counts.offLot++;
      continue;
    }
    if (misplacedOnFloor(m.kind, floor)) {
      counts.misplaced++;
      continue;
    }
    if (!claimRoom(m.kind, floor, m.left, m.right)) {
      counts.overlapping++;
      continue;
    }
    pushUnit(m.kind, floor, m.left, m.right - m.left, m.construction ? "construction" : "empty", {
      ...(m.construction ? { completeAt: minutes + buildMinutes(m.kind) } : {}),
    });
    if (m.kind === "cinema" || m.kind === "partyHall") counts.venues++;
    else counts.services++;
    if (m.kind === "weddingHall") counts.cathedral++; // clusters, not parts
  }

  // ---- Paving pass: the corridor layer under everything --------------------
  // Width-1 tiles, exactly like in-game placement, so every downstream
  // consumer (structure index, bulldozer, renderer) sees the shape it knows.
  // Lobby floors pave as lobby across their built extent (canon: the ground
  // concourse and every 15th floor).
  const builtExtents = new Map<number, { left: number; right: number }>();
  for (const [floor, row] of paved) {
    const kind: FacilityKind = isLobbyFloor(floor) ? "lobby" : "floor";
    let left = -1;
    let right = -1;
    for (let xTile = 0; xTile < GRID.width; xTile++) {
      if (!row[xTile]) continue;
      if (left === -1) left = xTile;
      right = xTile + 1;
      units.push({
        id: nextId++,
        kind,
        floor,
        x: xTile,
        width: 1,
        state: "empty",
        satisfaction: 1,
        occupants: 0,
        everOccupied: false,
        pendingIncome: 0,
        label: FACILITIES[kind].name,
      });
    }
    if (left !== -1) builtExtents.set(floor, { left, right });
  }

  // Every paved basement tile was dug in the legacy game, so seed the
  // excavation history: without it, bulldozing and rebuilding an imported
  // basement room would count as fresh ground and could re-pay the
  // buried-treasure windfall for space the tower already excavated.
  const excavated: string[] = [];
  for (const [floor, row] of paved) {
    if (floor > 0) continue;
    for (let xTile = 0; xTile < GRID.width; xTile++) {
      if (row[xTile]) excavated.push(`${floor}:${xTile}`);
    }
  }

  // ---- Transports: decoded from the save, or synthesized as a fallback -----
  const decoded = tdt.elevators !== null;
  let transports: Transport[];
  let decodeStats = { droppedShafts: 0, adjustedShafts: 0, droppedFlights: 0 };
  if (tdt.elevators !== null) {
    const d = transportsFromDecoded(tdt.elevators, tdt.stairs ?? [], nextId);
    transports = d.transports;
    decodeStats = d;
  } else {
    const hotelFloors = units.filter((u) => isHotelKind(u.kind)).map((u) => u.floor);
    const staffFloors = units.filter((u) => u.kind === "housekeeping").map((u) => u.floor);
    transports = synthesizeTransports(builtExtents, hotelFloors, staffFloors, nextId);
  }
  nextId += transports.length;

  const towerName = towerNameFromFilename(filename);
  const hasWeddingHall = units.some((u) => u.kind === "weddingHall");
  // A save with the Cathedral built but not yet at TOWER is mid-evaluation:
  // seed the pending VIP inspection (the same +3 days building the hall
  // schedules), or the hall cap would strand the tower below TOWER forever
  // (checkVip never runs at -1 and a second hall can't be built).
  const vipVisitDay = hasWeddingHall && star < 6 ? Math.floor(minutes / 1440) + 3 : -1;
  const save: SerializedGame = {
    version: SAVE_VERSION,
    seed: hashSeed(bytes),
    money,
    star,
    minutes,
    mode: "classic",
    units,
    transports,
    nextId,
    towerName,
    builtWeddingHall: hasWeddingHall,
    evaluatedTower: star >= 6,
    vipVisitDay,
    // A 4-star-or-better save already passed the original's favorable-suite
    // VIP review (it gates 4 stars there too); without this, evaluateStar
    // clamps the imported tower back to 3 stars until a NEW VIP stay.
    vipFavorable: star >= 4,
    excavated,
  };

  return { save, report: buildReport(save, counts, tdt, decoded, decodeStats, headerNotes) };
}

/** What the decode-path mapping produced, with honest loss accounting. */
export interface DecodedTransports {
  transports: Transport[];
  /** Corrupt shafts dropped (degenerate, out of range, or overlapping). */
  droppedShafts: number;
  /** Shafts whose extents were trimmed (lot range or canon span). */
  adjustedShafts: number;
  /** Walkway flights dropped at the 64-link pool cap. */
  droppedFlights: number;
}

/** True when placing a transport at (x, width, bottom..top) would overlap one
 *  already placed. Exact-footprint stacked walkways may share their landing
 *  floor (the engine's own stacking rule), so that one case is allowed. */
function overlapsPlaced(
  placed: readonly Transport[],
  kind: FacilityKind,
  x: number,
  width: number,
  bottom: number,
  top: number,
): boolean {
  const isWalkway = kind === "stairs" || kind === "escalator";
  for (const t of placed) {
    if (x >= t.x + t.width || t.x >= x + width) continue;
    if (bottom > t.top || t.bottom > top) continue;
    const otherWalkway = t.kind === "stairs" || t.kind === "escalator";
    if (isWalkway && otherWalkway && t.x === x && t.width === width && (bottom === t.top || top === t.bottom)) {
      continue; // stacked flights sharing exactly the landing floor
    }
    return true;
  }
  return false;
}

/**
 * Map the DECODED elevator and stairs tables onto our transports. Live
 * passenger/queue state is deliberately not carried over (the crowd
 * re-simulates), but the shafts themselves come across faithfully: kind,
 * position, extent, car count, per-floor stop settings (the serviced-floors
 * map becomes `skipFloors`), and each car's home floor as its starting
 * position. Two- and three-story walkway variants become stacked flights
 * (exact-footprint stacking is how the engine models a continuous run).
 *
 * Corrupt entries are dropped or trimmed, never invented: a shaft wholly
 * outside the buildable range is discarded (not clamped into a phantom stub),
 * spans obey the engine's canon `maxSpanFor`, and no transport may overlap
 * one already placed. Every drop/trim is counted for the fidelity report.
 */
export function transportsFromDecoded(
  elevators: readonly TdtElevator[],
  stairs: readonly TdtStair[],
  firstId: number,
): DecodedTransports {
  const out: Transport[] = [];
  let droppedShafts = 0;
  let adjustedShafts = 0;
  let droppedFlights = 0;
  for (const e of elevators) {
    const kind = ELEVATOR_KINDS[e.type];
    const rawBottom = e.bottomFloor - TDT_FLOOR_OFFSET;
    const rawTop = e.topFloor - TDT_FLOOR_OFFSET;
    if (rawTop <= rawBottom) {
      droppedShafts++; // degenerate shaft in a corrupt save
      continue;
    }
    // Trim into the buildable range; a shaft with no height left inside it is
    // corrupt data, not something to fold into a phantom stub at the edge.
    const bottom = Math.max(GRID.minFloor, rawBottom);
    let top = Math.min(GRID.maxFloor, rawTop);
    if (top <= bottom) {
      droppedShafts++;
      continue;
    }
    let trimmed = bottom !== rawBottom || top !== rawTop;
    // The engine's canon span cap (standard/service 30; express unlimited).
    if (top - bottom > maxSpanFor(kind)) {
      top = bottom + maxSpanFor(kind);
      trimmed = true;
    }
    const width = FACILITIES[kind].width;
    const x = Math.max(0, Math.min(GRID.width - width, e.x));
    if (overlapsPlaced(out, kind, x, width, bottom, top)) {
      droppedShafts++;
      continue;
    }
    if (trimmed) adjustedShafts++;
    const cars = Math.max(1, Math.min(maxCarsFor(kind), e.cars));
    // The 120-byte serviced-floors map is the original's per-floor stop
    // configuration: exactly our skipFloors, inverted. Endpoints always stop.
    const skipFloors: number[] = [];
    for (let fl = bottom + 1; fl < top; fl++) {
      if (!e.serviced[fl + TDT_FLOOR_OFFSET]) skipFloors.push(fl);
    }
    const carPositions = Array.from({ length: cars }, (_, i) => {
      const home = e.carHomes[i] - TDT_FLOOR_OFFSET;
      return Math.max(bottom, Math.min(top, home));
    });
    out.push({
      id: firstId + out.length,
      kind,
      x,
      width,
      bottom,
      top,
      cars,
      carPositions,
      carDir: Array.from({ length: cars }, () => 0),
      load: 0,
      skipFloors,
    });
  }
  let walkways = 0;
  for (const s of stairs) {
    if (s.type > 5) continue; // undocumented variant in a corrupt save
    const kind: FacilityKind = s.type % 2 === 1 ? "stairs" : "escalator";
    const stories = s.type <= 1 ? 1 : s.type <= 3 ? 2 : 3;
    const width = FACILITIES[kind].width;
    const x = Math.max(0, Math.min(GRID.width - width, s.x));
    const base = s.floor - TDT_FLOOR_OFFSET;
    for (let i = 0; i < stories; i++) {
      const bottom = base + i;
      if (bottom < GRID.minFloor || bottom + 1 > GRID.maxFloor) continue;
      if (walkways >= 64) {
        droppedFlights++; // past the shared 64-link walkway pool
        continue;
      }
      if (overlapsPlaced(out, kind, x, width, bottom, bottom + 1)) {
        droppedFlights++;
        continue;
      }
      walkways++;
      out.push({
        id: firstId + out.length,
        kind,
        x,
        width,
        bottom,
        top: bottom + 1,
        cars: 0,
        carPositions: [],
        carDir: [],
        load: 0,
      });
    }
  }
  return { transports: out, droppedShafts, adjustedShafts, droppedFlights };
}

/**
 * FALLBACK deterministic elevator layout from the floor map alone; used only
 * when the save's transport blocks can't be read (truncated or corrupt
 * files); reported to the player. Pure and RNG-free: the same floor map
 * always yields byte-identical shafts.
 *
 * - Standard shafts in ≤30-floor bands: one anchored at the LOWEST built
 *   floor (so basements ride the ground band), then one per 15th-floor sky
 *   lobby that extends coverage; every band clamped into the built range so
 *   a sparse tower never gets a shaft hanging below its lowest floor.
 * - One express shaft when the tower tops ~30 floors, stopping at its
 *   endpoints plus the (sky) lobby floors between them.
 * - Service elevator(s) chained over the hotel/housekeeping floors when
 *   hotels exist and that range actually spans floors; housekeeping is
 *   unreachable without staff transport (an all-on-one-floor hotel needs no
 *   shaft; staff walk).
 * - 8 cars per shaft; the 24-shaft pooled cap is respected (never reached by
 *   a legal 110-floor tower, but a guard is a guard).
 */
export function synthesizeTransports(
  builtExtents: ReadonlyMap<number, { left: number; right: number }>,
  hotelFloors: readonly number[],
  staffFloors: readonly number[],
  firstId: number,
): Transport[] {
  if (builtExtents.size === 0) return [];
  let bottom = Infinity;
  let top = -Infinity;
  let minLeft = Infinity;
  let maxRight = -Infinity;
  for (const [floor, ext] of builtExtents) {
    bottom = Math.min(bottom, floor);
    top = Math.max(top, floor);
    minLeft = Math.min(minLeft, ext.left);
    maxRight = Math.max(maxRight, ext.right);
  }
  const center = Math.round((minLeft + maxRight) / 2);

  const specs: { kind: FacilityKind; bottom: number; top: number; skipFloors?: number[] }[] = [];
  // Standard bands: ground first (basements included), then each sky-lobby
  // anchor that extends coverage upward. Consecutive bands overlap at a sky
  // lobby, so a two-ride trip can always transfer.
  let covered = -Infinity;
  const groundTop = Math.min(bottom + 30, top);
  if (groundTop > bottom) {
    specs.push({ kind: "elevatorStandard", bottom, top: groundTop });
    covered = groundTop;
  }
  for (let anchor = GRID.lobbyInterval; anchor < top; anchor += GRID.lobbyInterval) {
    // Clamp the anchor into the built range: a sparse tower (nothing built
    // below floor 40, say) must not get a shaft hanging under its own floors.
    const bandBottom = Math.max(anchor, bottom);
    const bandTop = Math.min(bandBottom + 30, top);
    if (bandTop <= covered || bandTop <= bandBottom) continue;
    specs.push({ kind: "elevatorStandard", bottom: bandBottom, top: bandTop });
    covered = bandTop;
  }
  // Express once the tower is genuinely tall: from the ground (or the lowest
  // built floor when the tower floats above it), stopping lobby-to-lobby.
  if (top >= 30) {
    const exBottom = Math.max(1, bottom);
    if (top > exBottom) {
      const skip: number[] = [];
      for (let fl = exBottom + 1; fl < top; fl++) if (!isLobbyFloor(fl)) skip.push(fl);
      specs.push({ kind: "elevatorExpress", bottom: exBottom, top, skipFloors: skip });
    }
  }
  // Service chain over the staff range; only when there are hotels to clean.
  // Anchored at the ground concourse but clamped into the built range; when
  // every hotel and housekeeping sits on one floor, staff walk (no shaft).
  if (hotelFloors.length > 0) {
    const staffRange = [...hotelFloors, ...staffFloors, 1];
    let lo = Math.max(Math.min(...staffRange), bottom);
    const hi = Math.min(Math.max(...staffRange), top);
    while (lo < hi) {
      const t = Math.min(lo + 30, hi);
      specs.push({ kind: "elevatorService", bottom: lo, top: t });
      lo = t;
    }
  }

  // The pooled 24-shaft cap: unreachable for a legal tower (≤ ~11 shafts),
  // but never emit more than the game itself allows.
  const capped = specs.slice(0, 24);

  // Lay the shafts side by side around the built extent's horizontal center.
  const totalWidth = capped.reduce((w, s) => w + FACILITIES[s.kind].width, 0);
  let x = Math.max(0, Math.min(GRID.width - totalWidth, Math.round(center - totalWidth / 2)));
  const transports: Transport[] = [];
  for (const s of capped) {
    const width = FACILITIES[s.kind].width;
    const cars = 8;
    transports.push({
      id: firstId + transports.length,
      kind: s.kind,
      x,
      width,
      bottom: s.bottom,
      top: s.top,
      cars,
      carPositions: Array.from({ length: cars }, (_, i) => Math.min(s.bottom + i, s.top)),
      carDir: Array.from({ length: cars }, () => 0),
      load: 0,
      skipFloors: s.skipFloors,
    });
    x += width;
  }
  return transports;
}

/** Tower name from the FILENAME (never from file bytes): basename minus
 *  extension, separators to spaces, printable ASCII only, capped length. */
export function towerNameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const name = base
    .replace(/\.[^.]*$/, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24)
    .trim();
  return name || "SimTower Import";
}

/** FNV-1a over the file bytes: a stable, deterministic RNG seed for the
 *  imported tower (same file, same seed; golden-testable). */
function hashSeed(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  h &= 0x7fffffff;
  return h === 0 ? 1 : h;
}

function buildReport(
  save: SerializedGame,
  counts: {
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
    venues: number;
    services: number;
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
  },
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
  couldNotBring.push("Tenant names, retail varieties, and finance history aren't imported yet.");
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
