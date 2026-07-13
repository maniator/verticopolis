import { rentConfig } from "../engine/econConfig";
import { FACILITIES, GRID, buildMinutes, facilityFloors, isHotelKind } from "../engine/facilities";
import { canonicalSubtype, FASTFOOD_SUBTYPES, RESTAURANT_SUBTYPES, SHOP_SUBTYPES } from "../engine/retailSubtypes";
import { SAVE_VERSION } from "../engine/saveMigration";
import { minuteOfDayForFrame } from "../engine/timePacing";
import type { FacilityKind, SerializedGame, Transport, Unit, UnitState } from "../engine/types";
import { parseTdtBinary, TDT_FLOOR_OFFSET, viewFromViewWords } from "./tdtFormat";
import type { TdtTenant, TdtTower } from "./tdtFormat";
import {
  HOTEL_ASLEEP_FLAG,
  HOTEL_DIRTY_FLAG,
  HOTEL_INFESTED_FLAG,
  HOTEL_OCCUPANT_MASK,
  MAX_IMPORT_DAY,
  PART_FAMILY,
  TDT_BURNED,
  TDT_FLOOR,
  TDT_LOBBY,
  TDT_METRO_TUNNEL,
  TENANT_KIND,
  isLobbyFloor,
  misplacedOnFloor,
  rentFromClass,
} from "./tdtTables";
import { mergeParts, type PartRecord } from "./tdtPartMerge";
import { synthesizeTransports, transportsFromDecoded } from "./tdtTransports";
import { buildReport, type ImportCounts, type ImportReport } from "./tdtImportReport";
import { hashSeed, towerNameFromFilename } from "./tdtImportHelpers";

/**
 * The `.TDT` parse pass: map the raw {@link TdtTower} the binary walker
 * produces into our {@link SerializedGame} schema plus an honest
 * {@link ImportReport}. Extracted from `tdtImport.ts` (which is now the barrel);
 * the output is deliberately fed through `Simulation.deserialize` by the
 * caller, whose trust-boundary hardening is the second validation layer, so
 * nothing here needs to be the last line of defense.
 *
 * Scope (see the backlog's tdt-importer row): the header, floor map,
 * elevator table and stairs table are decoded, including per-floor stop
 * settings, rent classes and hotel room states. When the transport blocks
 * can't be read (truncated/corrupt files), a deterministic layout is
 * SYNTHESIZED from the floor map instead, and the fidelity report says which
 * path ran. People, finance history and named tenants are queued follow-ups.
 */

/** Result of a successful parse: the save plus its fidelity report. */
export interface ParsedLegacyTower {
  save: SerializedGame;
  report: ImportReport;
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
  const counts: ImportCounts = {
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
        // Seed a live headcount from imported occupancy so imported towers don't
        // render/behave as empty until the first hourly presence sync.
        occupants = FACILITIES[kind].population;
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
      } else if (!underConstruction && (kind === "fastFood" || kind === "restaurant" || kind === "shop")) {
        // Commercial venues carry footprint-scaled catalog customers (see the
        // FACILITIES fastFood/restaurant/shop population values); seed them as
        // occupied so EconomySystem recognizes them as running on the first
        // tick. customersIn stays unset (undefined, which census reads treat
        // as 0): no meal customers have eaten yet; the crowd system builds the
        // live count organically as the sim runs.
        state = "occupied";
        everOccupied = true;
      }
      // Rent class (unit byte 16) → our price band, for priced kinds.
      const rent = rentFromClass(kind, t.rentRate);
      if (rent !== undefined) counts.rentsApplied++;
      // Rent class 4 ("No Rate") on a priced kind: the unit is deliberately off
      // the market, charging nothing. Leave `rent` at default and flag it, so
      // `rentOf` yields $0. Class 4 on a non-priced kind carries no band, so it
      // gets no flag.
      const noRate = t.rentRate === 4 && rentConfig(kind) !== null;

      // Canon retail variant: unit-record byte 6 (`t.variant`), where the real
      // 1994 game stores it (byte 17 is 0 in every game-written save; see
      // TdtTenant.variant). Whitelist-coerce against our canon lists so an
      // out-of-range byte drops to undefined (generic name). Only the three
      // retail kinds carry a canon variant; every other kind stays generic.
      let subtype: string | undefined;
      if (kind === "shop") subtype = canonicalSubtype(kind, SHOP_SUBTYPES[t.variant]);
      else if (kind === "fastFood") subtype = canonicalSubtype(kind, FASTFOOD_SUBTYPES[t.variant]);
      else if (kind === "restaurant") subtype = canonicalSubtype(kind, RESTAURANT_SUBTYPES[t.variant]);

      pushUnit(kind, ours, ext.x, ext.right - ext.x, state, {
        everOccupied,
        occupants,
        rent,
        ...(noRate ? { noRate: true } : {}),
        ...(subtype !== undefined ? { subtype } : {}),
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
  // Bring the 1994 save's view scroll over so the tower opens where its
  // player last stood (no zoom: the format has none). (0, 0) means no saved
  // view; out-of-grid values clamp at the deserialize trust boundary.
  const view = viewFromViewWords(tdt.header.viewX, tdt.header.viewY);
  if (view) save.view = view;

  return { save, report: buildReport(save, counts, tdt, decoded, decodeStats, headerNotes) };
}
