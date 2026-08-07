import { subtypeIndex } from "../engine/retailSubtypes";
import { rentConfig } from "../engine/econConfig";
import { FACILITIES, GRID, facilityFloors, isCommercialKind, isHotelKind, residentCount } from "../engine/facilities";
import type { SerializedGame, SerializedUnit } from "../engine/types";
import { isPresent } from "../engine/types";
import { TDT_FLOOR_OFFSET } from "./tdtConstants";
import { HOTEL_ASLEEP_FLAG, HOTEL_DIRTY_FLAG, HOTEL_OCCUPANT_MASK, isLobbyFloor } from "./tdtTables";
import { rentFromClass } from "./tdtTables";
import { KIND_TENANT, PART_STACKS, classFromRent, type OutTenant } from "./tdtExportTables";

/**
 * The gather pass of the `.TDT` export: walk the serialized tower into
 * per-floor tenant records, paving spans, header aggregate counts, and a
 * people census, without writing any bytes. Extracted from `tdtExport.ts`; the
 * encoder consumes the {@link GatheredTower} this returns.
 */

/** Serialized units may omit width/state/label (older saves): normalize once,
 *  the same defaults deserialize applies. */
function norm(u: SerializedUnit) {
  return {
    ...u,
    width: u.width ?? FACILITIES[u.kind].width,
    state: u.state ?? "empty",
    occupants: u.occupants ?? 0,
    everOccupied: u.everOccupied ?? false,
    label: u.label,
  };
}

/** A normalized room (a unit with its optional fields defaulted), plus whether
 *  the gather pass wrote a tenant record for it, and why not when it did not.
 *  A room that emits nothing (a burned shell, or a footprint that does not fit
 *  the TDT rows) still appears here, so anything reasoning about what the FILE
 *  contains must read `emitted` rather than re-derive the test. Out-of-range is
 *  checked first, so a burned room that ALSO falls outside the rows reports as
 *  out of range, matching the order the tenant loop used to test them in. */
export type GatheredRoom = ReturnType<typeof norm> & {
  emitted: boolean;
  skipReason?: "outOfRange" | "burned" | "unmappable";
};

/** Loss/quirk tally the exporter fills while gathering; consumed by the report. */
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

/** The header aggregate counts the 1994 game trusts (doc §1). */
export interface ExportHeaderCounts {
  recycling: number;
  commercial: number;
  security: number;
  hallCinema: number;
}

/** Everything the gather pass produces for the encoder and report. */
export interface GatheredTower {
  /** Tenant records keyed by TDT floor index (0–119). */
  tenantsByTdt: Map<number, OutTenant[]>;
  /** Built extent [left, right) per OUR floor. */
  extents: Map<number, { left: number; right: number }>;
  /** §7 retail-table rows (TDT-space floor + canon variant), bounded at 512. */
  retailRows: { floor: number; variant: number }[];
  counts: ExportCounts;
  header: ExportHeaderCounts;
  hasGroundLobby: boolean;
  /** Resident/worker/customer census written as the people count. */
  peoplePop: number;
  /** The normalized rooms (non-structure units); the encoder reuses them for
   *  the connected-parking-stall count. */
  rooms: GatheredRoom[];
}

export function gatherTower(save: SerializedGame): GatheredTower {
  // ---- Gather rooms, paving extents, and per-floor tenant records ---------
  const tenantsByTdt = new Map<number, OutTenant[]>();
  const extents = new Map<number, { left: number; right: number }>();
  // Tiles an emitted tenant record covers, per OUR floor: a paved tile under a
  // record carries no floor/lobby span (the record wins, so type-0/24 spans are
  // only the gaps between records). Rebuilt from the emitted records themselves
  // (below), not the input footprints, so it exactly matches every record we
  // wrote, including multi-story PART_STACKS parts on their lower floors and
  // burned shells; a footprint-based set would miss those and let a span overlap.
  const coveredTiles = new Map<number, Set<number>>();
  // Rows for the §7 retail table: one per emitted shop / fastFood / restaurant,
  // carrying the TDT-space floor byte and the canon variant. Filled in tenant
  // gathering, drained by the retail-table write loop. Bounded at 512 slots.
  const retailRows: { floor: number; variant: number }[] = [];
  const widen = (floor: number, left: number, right: number): void => {
    const e = extents.get(floor);
    if (!e) extents.set(floor, { left, right });
    else {
      e.left = Math.min(e.left, left);
      e.right = Math.max(e.right, right);
    }
  };
  const pushTenant = (floor: number, t: OutTenant): void => {
    const tdt = floor + TDT_FLOOR_OFFSET;
    const arr = tenantsByTdt.get(tdt);
    if (arr) arr.push(t);
    else tenantsByTdt.set(tdt, [t]);
  };
  /** True when every story of a footprint sits on a writable TDT row (0–109).
   *  The live game can't build outside it, but buildTDT takes any serialized
   *  input, and a room written into the reserved rows (or onto a negative map
   *  key the encoder never reads) would be lost or corrupt the file. */
  const fitsTdtRows = (floor: number, stories: number): boolean => {
    const bottom = floor + TDT_FLOOR_OFFSET;
    return bottom >= 0 && bottom + stories - 1 <= 109;
  };

  const counts: ExportCounts = {
    rooms: 0,
    rentsSnapped: 0,
    namesDropped: 0,
    hotelStates: 0,
    occupied: 0,
    construction: 0,
    parkingStalls: 0,
    burnedOut: 0,
    vacancyHistoryLost: 0,
    outOfRange: 0,
  };

  // TDT header aggregate counts the 1994 game TRUSTS (docs/canon/tdt-format.md
  // §1). Derived from what actually lands in the floor map below, NOT the input
  // units, so a room dropped as out-of-range, or written as a burned shell,
  // never inflates a count the reader believes. That mismatch is the very bug
  // this fixes: a zeroed recyclingCount made the real game nag "your tower needs
  // a Recycling Center" on a tower that had two (confirmed + fixed via the
  // SimTower harness, tools/simtower/). parkingStallCount reuses counts.parkingStalls.
  const header: ExportHeaderCounts = { recycling: 0, commercial: 0, security: 0, hallCinema: 0 };
  let hasGroundLobby = false;
  // Resident/worker census of the emitted tenants, written as the people count
  // below. The 1994 game rebuilds the live crowd on load, so the record bytes
  // are zero-filled, but a POPULATED tower must carry a nonzero count here or the
  // game faults reading its people block (an empty tower is fine at 0; both
  // confirmed via the SimTower harness, tools/simtower/).
  let peoplePop = 0;
  // Guard each addend: residentCount returns a forged condo's raw `residents`,
  // so one NaN would poison the whole sum to NaN (then count 0, no records) and
  // re-open the very crash this census prevents. Matches the NaN-hardening the
  // money/star/coordinate fields already get.
  const addResidents = (u: Parameters<typeof residentCount>[0]): void => {
    const r = residentCount(u);
    if (Number.isFinite(r)) peoplePop += r;
  };

  const rooms: GatheredRoom[] = [];
  for (const raw of save.units) {
    const u = norm(raw);
    if (u.kind === "floor" || u.kind === "lobby") {
      // Ground lobby (our floor 1 = TDT ground row 10) drives lobbyHeight; we
      // model only single-story lobbies today (see backlog `lobby-height`). A
      // gutted/burning lobby is not a real lobby: excluding it keeps the same
      // invariant as the counts (a burned shell never inflates a header field).
      if (u.kind === "lobby" && u.floor === 1 && u.state !== "fire" && u.state !== "gutted") {
        hasGroundLobby = true;
      }
      widen(u.floor, u.x, u.x + u.width);
      continue;
    }
    // Decide ONCE whether this room will produce a tenant record, and carry the
    // answer on the room itself. Two kinds of room reach `rooms` and write
    // nothing: a footprint that does not fit the TDT rows, and a burned shell.
    // The format HAS a burned marker (type 48) but the retail game renders such
    // a record as garbage pixels (measured on the Wine harness, one wide record
    // and a strip of 1-tile records alike), so a burned room is cleared instead:
    // emitting nothing leaves the tiles to the paving pass, which fills them
    // with bare floor (lobby on the ground row) exactly as the original shows
    // once debris is cleared, and matches what our own importer does with a
    // type-48 record it reads. The EXPORT report carries that loss; the file
    // cannot, since nothing then distinguishes those tiles from floor that never
    // burned. See docs/canon/tdt-format.md §5.
    //
    // Every consumer that reasons about what is IN the file (the tenant loop
    // below, the parking chain, the cathedral stack probe) reads this flag.
    // Re-deriving the test per site is how three separate consumers each ended
    // up wrong in their own way.
    const burned = u.state === "fire" || u.state === "gutted";
    const fits = fitsTdtRows(u.floor, facilityFloors(u.kind));
    // A kind with no 1994 equivalent writes nothing either (no tenant id and no
    // part stack). Nothing buildable in Classic lands here today, but a forged
    // or mode-mismatched save carrying a Modern-only room would, and the flag
    // has to describe the FILE, not the intent.
    const mappable = KIND_TENANT.has(u.kind) || PART_STACKS[u.kind] !== undefined;
    let skipReason: GatheredRoom["skipReason"];
    if (!fits) skipReason = "outOfRange";
    else if (burned) skipReason = "burned";
    else if (!mappable) skipReason = "unmappable";
    const room: GatheredRoom = {
      ...u,
      emitted: !burned && fits && mappable,
      skipReason,
    };
    rooms.push(room);
    // A non-emitting room's tiles are filled by the paving pass instead, and
    // that pass clamps its runs into the lot, so widen the extent by the CLAMPED
    // footprint: an unclamped one (a forged unit hanging off the lot edge) would
    // advertise a floor extent whose tail no record fills, the same
    // header/record inconsistency as the #318 sky gap. Non-finite coordinates
    // are refused outright, since NaN survives every comparison below.
    const clamp = (v: number) => Math.max(0, Math.min(GRID.width, v));
    const finite = Number.isFinite(u.x) && Number.isFinite(u.width);
    let left = 0;
    let right = 0;
    if (room.emitted) {
      left = u.x;
      right = u.x + u.width;
    } else if (finite) {
      left = clamp(u.x);
      right = clamp(u.x + u.width);
    }
    if (!room.emitted && right <= left) continue; // wholly off-lot or unusable: claim nothing
    for (let fl = u.floor; fl < u.floor + facilityFloors(u.kind); fl++) {
      widen(fl, left, right);
    }
  }

  for (const u of rooms) {
    // Consume the flag decided above rather than re-deriving its inputs here:
    // this loop IS what "emitted" describes, so re-testing the same conditions
    // is exactly how the flag and the file could drift apart again.
    if (!u.emitted) {
      if (u.skipReason === "outOfRange") counts.outOfRange++;
      else if (u.skipReason === "burned") counts.burnedOut++;
      // "unmappable" is counted nowhere on purpose: no Classic kind reaches it,
      // and inventing a player-facing line for a state only a forged save can
      // produce would say more than we know.
      continue;
    }
    const construction = u.state === "construction";
    // Moving-in and vacating tenants are still tenants (rent flows; the 1994
    // format has no notice period), so they export as occupied.
    const tenanted = u.state === "occupied" || u.state === "moving_in" || u.state === "vacating";
    let status = 0;
    if (!construction) {
      if ((u.kind === "office" || u.kind === "condo") && tenanted) {
        status = 1;
        counts.occupied++;
        addResidents(u);
      } else if (isCommercialKind(u.kind) && FACILITIES[u.kind].population > 0) {
        // Census-counted commercial venues (fastFood/restaurant/shop, population > 0):
        // add catalog customers when the venue is present (isPresent: occupied,
        // moving in, vacating, or asleep), regardless of opening hours. Cinema is
        // isCommercialKind but carries population = 0 and falls through here,
        // matching Tower/Simulation.
        if (isPresent(u)) addResidents(u);
      } else if (isHotelKind(u.kind)) {
        // Inverse of the importer's flag decode; "booked but out for the day"
        // (a tenanted or ever-booked room without a sleep/dirty flag) is the
        // flagless nonzero status it reads back.
        if (u.state === "dirty") status = HOTEL_DIRTY_FLAG;
        else if (u.state === "asleep") {
          status = HOTEL_ASLEEP_FLAG | Math.min(Math.max(u.occupants, 1), HOTEL_OCCUPANT_MASK);
        } else if (tenanted || u.everOccupied) status = 1;
        if (status !== 0) {
          counts.hotelStates++;
          addResidents(u);
        }
      }
      // A vacant-but-once-occupied office/condo has no 1994 encoding (nonzero
      // status means TENANTED there): the vacancy history stays behind.
      if ((u.kind === "office" || u.kind === "condo") && !tenanted && u.everOccupied) {
        counts.vacancyHistoryLost++;
      }
    } else {
      counts.construction++;
    }
    // A No-Rate unit (off the market) emits lease class 4, overriding the
    // rent-derived class, so it round-trips as "No Rate". Only priced kinds
    // carry the flag, matching the importer.
    const rentClass = u.noRate && rentConfig(u.kind) ? 4 : classFromRent(u.kind, u.rent);
    const priceBand = rentConfig(u.kind);
    if (priceBand && !u.noRate) {
      // Fidelity: compare what the class reads back as on import (every class
      // 0-3 now reads the exact rung dollars) against the unit's EFFECTIVE
      // price, through the same fallback rentOf applies: an unset override
      // reads the band default, which for condos/hotels is NOT the Average
      // rung, so an unset unit exporting as class 2 is a real (if tiny) price
      // shift and counts. Since the pricing split a Classic tower's rents
      // already sit on explicit rungs (build stamps, snap-on-load stamps), so
      // this stays 0 in practice and the "rents snap" stays-behind line no
      // longer appears; it still catches in-memory off-rung values honestly.
      const effective = u.rent ?? priceBand.default;
      const back = rentFromClass(u.kind, rentClass);
      if (back !== undefined && back !== effective) counts.rentsSnapped++;
    }
    if (u.label && u.label !== FACILITIES[u.kind].name) counts.namesDropped++;
    if (u.kind === "parking") counts.parkingStalls++;
    // Tally the header aggregates from this EMITTED room (burned/out-of-range
    // rooms already `continue`d above, so they never count; see the header note).
    switch (u.kind) {
      case "recycling":
        header.recycling++;
        break;
      case "shop":
      case "restaurant":
      case "fastFood":
        header.commercial++;
        break;
      case "security":
        header.security++;
        break;
      case "partyHall":
      case "cinema":
        header.hallCinema++;
        break;
    }

    const stack = PART_STACKS[u.kind];
    if (stack) {
      // Multi-story: one part per story, bottom ID first. Our one-story
      // Wedding Hall crowns floor 100; the cathedral's five parts stack DOWN
      // from it, each floor taken only while it is free of other rooms (a
      // shorter stack still round-trips: the importer anchors at the top).
      if (u.kind === "weddingHall") {
        const parts: number[] = [];
        for (let i = 0; i < stack.length; i++) {
          const fl = u.floor - i;
          // Story-aware: a multi-story room whose UPPER story occupies `fl`
          // (a cinema at 98 reaching 99) blocks the stack just like a room
          // based there, or the file would carry overlapping tenant records.
          const collides =
            fl < GRID.minFloor ||
            (i > 0 &&
              rooms.some(
                (o) =>
                  o !== u &&
                  // Only a room that actually writes a record can collide. A
                  // burned shell (cleared to paving) or an out-of-range
                  // footprint writes nothing, so letting either block the stack
                  // truncates the cathedral with nothing in the file to show why.
                  o.emitted &&
                  fl >= o.floor &&
                  fl < o.floor + facilityFloors(o.kind) &&
                  o.x < u.x + u.width &&
                  u.x < o.x + o.width,
              ));
          if (collides) break;
          parts.push(stack[stack.length - 1 - i]); // 40 at the crown, downward
        }
        for (let i = 0; i < parts.length; i++) {
          const fl = u.floor - i;
          widen(fl, u.x, u.x + u.width);
          pushTenant(fl, {
            left: u.x,
            right: u.x + u.width,
            type: construction ? -parts[i] : parts[i],
            status: 0,
            rentClass,
          });
        }
      } else {
        for (let i = 0; i < stack.length; i++) {
          pushTenant(u.floor + i, {
            left: u.x,
            right: u.x + u.width,
            type: construction ? -stack[i] : stack[i],
            status: 0,
            rentClass,
          });
        }
      }
      counts.rooms++;
      continue;
    }

    const id = KIND_TENANT.get(u.kind);
    if (id === undefined) continue; // no 1994 equivalent (defensive; none today)
    // Canon retail variant: the three retail kinds carry a named subtype whose
    // ordinal in the §7 list gets written into unit-record byte 17 AND the
    // matching retail-table slot. `subtypeIndex` returns -1 for non-retail or
    // an absent name; we collapse -1 to 0 (the canon "generic" slot the game
    // treats as the first variant, matching pre-feature behavior).
    const subIdx = subtypeIndex(u.kind, u.subtype);
    pushTenant(u.floor, {
      left: u.x,
      right: u.x + u.width,
      type: construction ? -id : id,
      status,
      rentClass,
      subtypeIdx: subIdx >= 0 ? subIdx : undefined,
    });
    // Retail table (§7): one 18-byte row per shop / fastFood / restaurant that
    // will be emitted. Populated even for a legacy retail unit lacking a
    // subtype (variant byte falls back to 0), so the game's header commercial
    // count and this table stay consistent. Clamped to the 512-slot cap
    // (setHdrU16 also clamps commercialCount to 512 above).
    if (u.kind === "shop" || u.kind === "fastFood" || u.kind === "restaurant") {
      if (retailRows.length < 512) {
        retailRows.push({ floor: u.floor + TDT_FLOOR_OFFSET, variant: subIdx >= 0 ? subIdx : 0 });
      }
    }
    counts.rooms++;
  }

  // Coverage for the paving pass, rebuilt from the records ACTUALLY emitted
  // above (single-story rooms, multi-story PART_STACKS parts on their lower
  // floors, burned shells): a paving span is emitted only where no record sits,
  // so a span can never overlap a record on any floor. Bounds are clamped to
  // finite tiles in [0, GRID.width] so a forged record extent cannot spin the
  // mark loop. Keyed by OUR floor to match the paving pass below.
  for (const [tdt, records] of tenantsByTdt) {
    const floor = tdt - TDT_FLOOR_OFFSET;
    let set = coveredTiles.get(floor);
    for (const r of records) {
      const lo = Math.max(0, Math.min(GRID.width, Math.floor(Number.isFinite(r.left) ? r.left : 0)));
      const hi = Math.max(lo, Math.min(GRID.width, Math.floor(Number.isFinite(r.right) ? r.right : 0)));
      if (hi === lo) continue;
      if (!set) {
        set = new Set();
        coveredTiles.set(floor, set);
      }
      for (let xTile = lo; xTile < hi; xTile++) set.add(xTile);
    }
  }

  // Emit the paving as span records, the exact inverse of the importer's read:
  // it paves each floor's ENTIRE extent [left, right) as one solid block, then
  // reconstructs every paved tile's kind from the FLOOR (isLobbyFloor), never
  // from the record type. So we walk the same extent we write to the floor
  // header, skip tiles under a record (its record wins; type-0/24 records are
  // the gaps between records), and coalesce each contiguous non-covered run into
  // one span. Kind is by floor: lobby floors export type 24 (status 0), all
  // others type 0 (status 2); both carry rentClass 4 (No Rate) and no subtype.
  // Status is round-trip-immaterial (the importer ignores it) but mirrors the
  // real save's bytes. Records go through pushTenant, so they count toward the
  // per-floor cap enforced below. Reserved rows 110-119 carry no paving. The
  // iteration bounds are clamped to finite tiles in [0, GRID.width] so a forged
  // floor/lobby unit width (Infinity or huge) cannot make this loop run forever.
  const TDT_LOBBY_TYPE = 24;
  const TDT_FLOOR_TYPE = 0;
  for (const [floor, ext] of extents) {
    if (!fitsTdtRows(floor, 1)) continue;
    const lobby = isLobbyFloor(floor);
    const covered = coveredTiles.get(floor);
    const lo = Math.max(0, Math.min(GRID.width, Math.floor(Number.isFinite(ext.left) ? ext.left : 0)));
    const hi = Math.max(lo, Math.min(GRID.width, Math.floor(Number.isFinite(ext.right) ? ext.right : 0)));
    let runStart = -1;
    const flush = (end: number): void => {
      if (runStart === -1) return;
      pushTenant(floor, {
        left: runStart,
        right: end,
        type: lobby ? TDT_LOBBY_TYPE : TDT_FLOOR_TYPE,
        status: lobby ? 0 : 2,
        rentClass: 4,
        subtypeIdx: undefined,
      });
      runStart = -1;
    };
    for (let xTile = lo; xTile < hi; xTile++) {
      if (covered?.has(xTile)) {
        flush(xTile);
      } else if (runStart === -1) {
        runStart = xTile;
      }
    }
    flush(hi);
  }

  return { tenantsByTdt, extents, retailRows, counts, header, hasGroundLobby, peoplePop, rooms };
}
