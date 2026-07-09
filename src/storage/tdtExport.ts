import { rentConfig } from "../engine/econConfig";
import {
  FACILITIES,
  GRID,
  facilityFloors,
  isHotelKind,
  maxCarsFor,
  maxSpanFor,
  residentCount,
  transportCarCapacity,
} from "../engine/facilities";
import { frameForMinuteOfDay } from "../engine/timePacing";
import type { FacilityKind, SerializedGame, SerializedUnit } from "../engine/types";
import {
  TDT_ELEVATOR_BUILT_FIXED,
  TDT_ELEVATOR_HEADER_SIZE,
  TDT_ELEVATOR_PER_CAR_SIZE,
  TDT_ELEVATOR_SCHEDULE_DEFAULT,
  TDT_ELEVATOR_PER_FLOOR_SIZE,
  TDT_ELEVATOR_SLOTS,
  TDT_DEFAULT_VIEW_X,
  TDT_DEFAULT_VIEW_Y,
  TDT_FINANCE_SIZE,
  TDT_FLOOR_COUNT,
  TDT_FLOOR_INDEX_ENTRIES,
  TDT_HEADER_SIZE,
  TDT_MAGIC,
  TDT_MAX_CENSUS,
  TDT_MAX_TENANTS_PER_FLOOR,
  TDT_PARKING_SIZE,
  TDT_PERSON_RECORD_SIZE,
  TDT_RETAIL_RECORD_SIZE,
  TDT_RETAIL_SLOTS,
  TDT_ROUTING_TAIL_SIZE,
  TDT_STAIR_RECORD_SIZE,
  TDT_STAIR_SLOTS,
} from "./tdtFormat";
import {
  ELEVATOR_KINDS,
  HOTEL_ASLEEP_FLAG,
  HOTEL_DIRTY_FLAG,
  HOTEL_OCCUPANT_MASK,
  TDT_BURNED,
  TDT_FLOOR_OFFSET,
  TENANT_KIND,
  rentFromClass,
} from "./tdtImport";

/**
 * Writer for original 1994 SimTower saves (`.TDT`): the importer's mirror.
 * Serializes a {@link SerializedGame} into the binary layout documented in
 * `docs/canon/tdt-format.md`, plus an honest {@link ExportReport} of what the
 * 1994 format can and cannot carry. Semantic tables the importer also owns
 * (tenant IDs, part families, hotel flags, rent classes, elevator kinds) are
 * imported from `tdtImport.ts` and inverted here, so reader and writer cannot
 * drift apart on those. {@link PART_STACKS} is writer-local because it adds
 * emission ORDER, which the reader never needs; consistency-tripwire tests
 * pin every entry to the shared `PART_FAMILY`/`FAMILY_STORIES` tables.
 *
 * Self-consistency is enforced by tests: every exported buffer must parse
 * back through `parseTDT` with zero warnings and identical room state.
 * Whether the REAL game accepts the zero-filled blocks we don't simulate
 * (people, finance history, schedules, the undocumented header region) is a
 * recorded follow-up; see the backlog's tdt-exporter row.
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

/** Result of a successful export build. */
export interface BuiltLegacyTower {
  bytes: Uint8Array;
  report: ExportReport;
}

/** Thrown for towers the 1994 format cannot represent at all. */
export class LegacyExportError extends Error {}

/** Kind → canonical single-story tenant ID: {@link TENANT_KIND} inverted,
 *  first (lowest) ID wins so security exports as 14 (never 17/SECOM). */
const KIND_TENANT: ReadonlyMap<FacilityKind, number> = (() => {
  const m = new Map<FacilityKind, number>();
  for (const [id, kind] of Object.entries(TENANT_KIND)) {
    const n = Number(id);
    if (!m.has(kind) || n < m.get(kind)!) m.set(kind, n);
  }
  return m;
})();

/** Multi-story kinds → part IDs from the BOTTOM story up (doc §5; matches the
 *  importer's merge fixtures: recycling 21 under 20, theatre 19 under 18,
 *  metro 33/32/31, cathedral 36…40 rising to the crown). The theatre's
 *  separate screen halves (34/35) are not emitted: our model holds one
 *  full-width cinema, and inventing a hall/screen split point would be a
 *  guess; the importer merges either shape identically. Real-game rendering
 *  of a screenless theatre is a recorded validation follow-up. */
const PART_STACKS: Readonly<Partial<Record<FacilityKind, readonly number[]>>> = {
  cinema: [19, 18],
  recycling: [21, 20],
  partyHall: [30, 29],
  metro: [33, 32, 31],
  weddingHall: [36, 37, 38, 39, 40],
};

/** Inverse of {@link rentFromClass}: a unit's rent → the nearest of the four
 *  1994 lease classes. Unset (or unpriced kinds) export as 2 (Average), which
 *  the importer reads back as "keep the default". */
export function classFromRent(kind: FacilityKind, rent: number | undefined): number {
  const band = rentConfig(kind);
  if (!band || rent === undefined) return 2;
  // Anchors come from the SAME function the importer applies on read-back, so
  // "nearest class" is measured against what the class will actually become.
  const values: [number, number][] = [
    [0, rentFromClass(kind, 0) ?? band.min],
    [1, rentFromClass(kind, 1) ?? band.min],
    [2, band.default],
    [3, rentFromClass(kind, 3) ?? band.max],
  ];
  let best = 2;
  let bestDist = Infinity;
  for (const [cls, value] of values) {
    const d = Math.abs(rent - value);
    if (d < bestDist) {
      bestDist = d;
      best = cls;
    }
  }
  return best;
}

/** Names DOS/Win9x reserve for devices: a file by these names cannot exist on
 *  the filesystems the real game lives on. */
const DOS_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** DOS-safe download name: A–Z0–9 from the tower name, upper-cased, capped at
 *  8 characters (the real game lives on 8.3 filesystems), never empty and
 *  never a reserved device name (CON, PRN, COM1...). */
export function legacyFilename(towerName: string): string {
  const stem = towerName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return `${!stem || DOS_RESERVED.has(stem) ? "TOWER1" : stem}.TDT`;
}

/** One tenant record, pre-encoding. */
interface OutTenant {
  left: number;
  right: number;
  type: number; // negative = under construction
  status: number;
  rentClass: number;
}

/**
 * Build the `.TDT` bytes plus the reverse fidelity report for a serialized
 * tower. Throws {@link LegacyExportError} for towers the format cannot hold
 * (modern mode is refused earlier, in the UI flow, with its own message).
 */
export function buildTDT(save: SerializedGame): BuiltLegacyTower {
  if (save.mode === "modern") {
    throw new LegacyExportError(
      "This tower uses Modern rules. SimTower (1994) can only load Classic towers.",
    );
  }

  // ---- Gather rooms, paving extents, and per-floor tenant records ---------
  const tenantsByTdt = new Map<number, OutTenant[]>();
  const extents = new Map<number, { left: number; right: number }>();
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

  const counts = {
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
  const header = { recycling: 0, commercial: 0, security: 0, hallCinema: 0 };
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

  // Serialized units may omit width/state/label (older saves): normalize once,
  // the same defaults deserialize applies.
  const norm = (u: SerializedUnit) => ({
    ...u,
    width: u.width ?? FACILITIES[u.kind].width,
    state: u.state ?? "empty",
    occupants: u.occupants ?? 0,
    everOccupied: u.everOccupied ?? false,
    label: u.label,
  });
  const rooms: ReturnType<typeof norm>[] = [];
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
    rooms.push(u);
    for (let fl = u.floor; fl < u.floor + facilityFloors(u.kind); fl++) {
      widen(fl, u.x, u.x + u.width);
    }
  }

  for (const u of rooms) {
    if (!fitsTdtRows(u.floor, facilityFloors(u.kind))) {
      counts.outOfRange++;
      continue;
    }
    // A burned-out shell (or a room mid-fire) is not a healthy tenant: the
    // format has its own marker (type 48), which the importer clears back to
    // bare floor with a report line, exactly what 1994 would show.
    if (u.state === "fire" || u.state === "gutted") {
      pushTenant(u.floor, {
        left: u.x,
        right: u.x + u.width,
        type: TDT_BURNED,
        status: 0,
        rentClass: 2,
      });
      counts.burnedOut++;
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
    const rentClass = classFromRent(u.kind, u.rent);
    if (u.rent !== undefined) {
      // What the class reads back as on import: class 2 means "the default".
      const back = rentClass === 2 ? rentConfig(u.kind)?.default : rentFromClass(u.kind, rentClass);
      if (back !== undefined && back !== u.rent) counts.rentsSnapped++;
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
            rentClass: 2,
          });
        }
      } else {
        for (let i = 0; i < stack.length; i++) {
          pushTenant(u.floor + i, {
            left: u.x,
            right: u.x + u.width,
            type: construction ? -stack[i] : stack[i],
            status: 0,
            rentClass: 2,
          });
        }
      }
      counts.rooms++;
      continue;
    }

    const id = KIND_TENANT.get(u.kind);
    if (id === undefined) continue; // no 1994 equivalent (defensive; none today)
    pushTenant(u.floor, {
      left: u.x,
      right: u.x + u.width,
      type: construction ? -id : id,
      status,
      rentClass,
    });
    counts.rooms++;
  }

  // ---- Encode ---------------------------------------------------------------
  const chunks: number[] = [];
  const u8 = (v: number) => chunks.push(v & 0xff);
  const u16 = (v: number) => chunks.push(v & 0xff, (v >> 8) & 0xff);
  const i32 = (v: number) =>
    chunks.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  const pad = (n: number) => {
    for (let i = 0; i < n; i++) chunks.push(0);
  };
  const padFF = (n: number) => {
    for (let i = 0; i < n; i++) chunks.push(0xff);
  };

  // Header (doc §1). The undocumented region is zero-filled; whether the real
  // game needs anything there is the recorded real-game validation risk.
  // Guard non-finite money and star (deserialize doesn't harden them yet;
  // see the backlog's deserialize-coercion row): NaN through a clamp would
  // write 0 to the file while the modal showed the raw garbage. One
  // sanitized value feeds BOTH the header and the report, so the modal can
  // never claim a rating the bytes don't carry.
  const money = Number.isFinite(save.money) ? save.money : 0;
  const balance = Math.max(-0x80000000, Math.min(0x7fffffff, Math.round(money / 100)));
  const star = Number.isFinite(save.star) ? Math.max(1, Math.min(6, Math.round(save.star))) : 1;
  const minuteOfDay = ((save.minutes % 1440) + 1440) % 1440;
  u16(TDT_MAGIC);
  u16(star);
  i32(balance);
  i32(0); // otherIncome
  i32(0); // constructionCosts
  i32(0); // lastQuarterMoney
  u16(frameForMinuteOfDay(minuteOfDay));
  i32(Math.max(0, Math.floor(save.minutes / 1440)));
  pad(TDT_HEADER_SIZE - chunks.length);

  // Backfill the header aggregate counts (doc §1) at their fixed offsets in the
  // now-zero-padded header. The 1994 game reads these directly for advisories
  // (e.g. the recycling nag) rather than recomputing from the floor map, so a
  // zero here misreports the tower. Clamp to the canon caps.
  const setHdrU16 = (off: number, v: number) => {
    chunks[off] = v & 0xff;
    chunks[off + 1] = (v >> 8) & 0xff;
  };
  setHdrU16(0x1c, hasGroundLobby ? 1 : 0); // lobbyHeight: 0 with no ground lobby, else 1 (canon is 1–3; we model single-story lobbies)
  // recycling + hallCinema have no canon count cap (unlike security/parking), but
  // still clamp to the u16 ceiling so a forged/huge tower can't wrap the field to
  // a small value (setHdrU16 masks, it doesn't clamp) -- consistent with the
  // sibling counts and the people census.
  setHdrU16(0x2a, Math.min(header.recycling, 0xffff)); // recyclingCount
  setHdrU16(0x2e, Math.min(header.commercial, 512)); // commercialCount (one retail unit per slot, so <=512)
  setHdrU16(0x30, Math.min(header.security, 10)); // securityCount (canon max 10)
  setHdrU16(0x32, Math.min(counts.parkingStalls, 512)); // parkingStallCount (max 512 stalls)
  setHdrU16(0x36, Math.min(header.hallCinema, 0xffff)); // hallCinemaCount (party halls + cinemas)
  // Saved view-scroll position (0x26 = x, 0x28 = y, world pixels). Left at 0 the
  // game opens a loaded tower at the top-left sky; we write the game's own New
  // Tower default so it opens on the ground lobby, the tower's entrance.
  setHdrU16(0x26, TDT_DEFAULT_VIEW_X);
  setHdrU16(0x28, TDT_DEFAULT_VIEW_Y);

  // A floor whose tenant count exceeds what the format (and our own parser's
  // hostile-file cap) allows cannot be represented; refuse rather than emit a
  // file that every reader rejects. Unreachable from live play (rooms are at
  // least 4 tiles wide on a 375-tile lot); only forged saves get here.
  for (const [, tenants] of tenantsByTdt) {
    // Same boundary as the reader (which rejects strictly greater): a floor
    // AT the ceiling is still parseable and must export.
    if (tenants.length > TDT_MAX_TENANTS_PER_FLOOR) {
      throw new LegacyExportError(
        "One floor holds more rooms than a SimTower (1994) save can carry.",
      );
    }
  }

  // Floor map: 120 records (doc §4). Reserved rows 110–119 stay empty, even
  // when an out-of-range (skipped) room widened an extent up there.
  for (let index = 0; index < TDT_FLOOR_COUNT; index++) {
    const ours = index - TDT_FLOOR_OFFSET;
    const tenants = tenantsByTdt.get(index) ?? [];
    const ext = ours <= GRID.maxFloor ? extents.get(ours) : undefined;
    u16(tenants.length);
    u16(ext?.left ?? 0);
    u16(ext?.right ?? 0);
    for (const t of tenants) {
      u16(t.left);
      u16(t.right);
      u8(t.type); // i8 via two's complement
      u8(t.status);
      pad(10); // reserved bytes 6–15
      u8(t.rentClass);
      u8(0); // subtype (retail variant / days-dirty): not modeled
    }
    pad(TDT_FLOOR_INDEX_ENTRIES * 2); // per-floor remap table
  }

  // People block: a u32 count followed by that many 16-byte records. The crowd
  // re-simulates on load, so the records are zero-filled (no live positions to
  // invent), but the COUNT must be nonzero for a populated tower or the 1994
  // game faults reading this block (an empty tower loads fine at 0; both
  // confirmed against the game via the SimTower harness). We write the tower's
  // resident/worker census, clamped to the canon maximum so a forged save can't
  // bloat the file. See TDT_ROUTING_TAIL_SIZE for the companion trailing-region
  // fix that lets the whole file reach the length the game reads.
  // Commercial venues (shops, restaurants, fast food) draw crowds in the game
  // but have zero catalog residents, so a tower built only from them sums to a
  // zero census and would fault like an empty people block. Floor the count at
  // the emitted room count whenever the tower has rooms: the game rebuilds the
  // real crowd from the map regardless of this number (our census ran ~77 for a
  // tower the game repopulated to ~291), so any nonzero value is safe, and a
  // lobby-only/empty tower correctly stays 0.
  const finitePop = Number.isFinite(peoplePop) ? Math.round(peoplePop) : 0;
  const peopleCount = Math.max(0, Math.min(Math.max(finitePop, counts.rooms), TDT_MAX_CENSUS));
  i32(peopleCount);
  pad(peopleCount * TDT_PERSON_RECORD_SIZE);

  // Retail table: all slots empty (0xFF floor marker).
  for (let slot = 0; slot < TDT_RETAIL_SLOTS; slot++) {
    u8(0xff);
    pad(TDT_RETAIL_RECORD_SIZE - 1);
  }

  // Elevator table: 24 slots (doc §6). Live passenger payloads zero-filled at
  // their documented sizes; kind → type via the importer's ELEVATOR_KINDS
  // order (0 express, 1 standard, 2 service).
  //
  // Transports are sanitized into three buckets first, mirroring the
  // importer's own trimming rules (transportsFromDecoded): the live game
  // never produces bad values, but buildTDT takes any serialized input, and
  // an unclamped coordinate would wrap through the u8/u16 masks into a
  // structurally-valid-but-nonsensical file the report knows nothing about.
  const elevators: { kind: FacilityKind; x: number; bottom: number; top: number; cars: number; carPositions: number[]; skipFloors?: number[] }[] = [];
  const walkways: { kind: FacilityKind; x: number; bottom: number }[] = [];
  let transportsDropped = 0;
  for (const t of save.transports) {
    const width = FACILITIES[t.kind]?.width ?? 0;
    if (t.kind === "stairs" || t.kind === "escalator") {
      // A flight must sit fully inside the buildable range (same guard the
      // importer applies to decoded stair records). Round first, like the
      // elevator path: a fractional floor would silently truncate in u16.
      const bottom = Number.isFinite(t.bottom) ? Math.round(t.bottom) : NaN;
      if (!Number.isFinite(bottom) || bottom < GRID.minFloor || bottom + 1 > GRID.maxFloor) {
        transportsDropped++;
        continue;
      }
      const x = Math.max(0, Math.min(GRID.width - width, Math.round(Number.isFinite(t.x) ? t.x : 0)));
      walkways.push({ kind: t.kind, x, bottom });
      continue;
    }
    if (!ELEVATOR_KINDS.includes(t.kind)) {
      transportsDropped++; // no 1994 equivalent (forged kind)
      continue;
    }
    if (!Number.isFinite(t.bottom) || !Number.isFinite(t.top)) {
      transportsDropped++;
      continue;
    }
    const bottom = Math.max(GRID.minFloor, Math.round(t.bottom));
    let top = Math.min(GRID.maxFloor, Math.round(t.top));
    if (top <= bottom) {
      transportsDropped++; // degenerate or wholly out of range
      continue;
    }
    if (top - bottom > maxSpanFor(t.kind)) top = bottom + maxSpanFor(t.kind);
    const x = Math.max(0, Math.min(GRID.width - width, Math.round(Number.isFinite(t.x) ? t.x : 0)));
    elevators.push({
      kind: t.kind,
      x,
      bottom,
      top,
      cars: t.cars,
      carPositions: t.carPositions ?? [],
      skipFloors: t.skipFloors,
    });
  }
  // The 24-slot table can't hold more (only forged saves exceed the pooled
  // cap); the drop is counted for the report, never silent.
  const shaftsDropped = Math.max(0, elevators.length - TDT_ELEVATOR_SLOTS);
  for (let slot = 0; slot < TDT_ELEVATOR_SLOTS; slot++) {
    const e = elevators[slot];
    // Inverse of the importer's shared ELEVATOR_KINDS order.
    const type = e ? ELEVATOR_KINDS.indexOf(e.kind) : -1;
    if (!e || type < 0) {
      pad(TDT_ELEVATOR_HEADER_SIZE); // empty slot: used = 0
      continue;
    }
    // Same clamp the importer applies on read (1..maxCarsFor); an unclamped
    // (or non-finite) count would desync the header byte from the payload
    // size computed below.
    const rawCars = Number.isFinite(e.cars) ? Math.round(e.cars) : 1;
    const cars = Math.max(1, Math.min(maxCarsFor(e.kind), rawCars));
    u8(1); // used
    u8(type);
    u8(transportCarCapacity(e.kind)); // informational; canon 42/21/10
    u8(cars);
    // Per-shaft schedule/config block: the game dispatches cars from this; a
    // zero-fill reads as "run no cars" and traps everyone in a shaft with no
    // cars. Emit the game's own built-shaft default so exported shafts run.
    for (const v of TDT_ELEVATOR_SCHEDULE_DEFAULT) u8(v);
    u8(1); // visible
    u8(0); // reserved
    u16(e.x);
    u8(e.top + TDT_FLOOR_OFFSET);
    u8(e.bottom + TDT_FLOOR_OFFSET);
    const skip = new Set(e.skipFloors ?? []);
    let servicedCount = 0;
    for (let fl = 0; fl < TDT_FLOOR_COUNT; fl++) {
      const ours = fl - TDT_FLOOR_OFFSET;
      // Endpoints always stop (the importer reads skip flags for interior
      // floors only), so a degenerate endpoint skip can't poison the map.
      const stops =
        ours >= e.bottom &&
        ours <= e.top &&
        (!skip.has(ours) || ours === e.bottom || ours === e.top);
      u8(stops ? 1 : 0);
      if (stops) servicedCount++;
    }
    for (let c = 0; c < 8; c++) {
      const raw = e.carPositions[c];
      const home = Number.isFinite(raw) ? Math.round(raw) : e.bottom;
      u8(Math.max(e.bottom, Math.min(e.top, home)) + TDT_FLOOR_OFFSET);
    }
    pad(
      TDT_ELEVATOR_BUILT_FIXED +
        servicedCount * TDT_ELEVATOR_PER_FLOOR_SIZE +
        cars * TDT_ELEVATOR_PER_CAR_SIZE,
    );
  }

  // Finance history: not modeled; zero-filled at the documented size.
  pad(TDT_FINANCE_SIZE);

  // Parking: the connected count is CHAINED stalls only (canon: a space works
  // only when contiguous spaces link it back to a ramp on its floor); a lot
  // full of orphan stalls exports 0, exactly what 1994 could produce itself.
  const connectedStalls = (() => {
    const byFloor = new Map<number, { x: number; w: number; ramp: boolean }[]>();
    for (const u of rooms) {
      if (u.kind !== "parking" && u.kind !== "parkingRamp") continue;
      const arr = byFloor.get(u.floor) ?? [];
      arr.push({ x: u.x, w: u.width, ramp: u.kind === "parkingRamp" });
      byFloor.set(u.floor, arr);
    }
    let connected = 0;
    for (const arr of byFloor.values()) {
      arr.sort((a, b) => a.x - b.x);
      const linked = arr.map((it) => it.ramp);
      // Chains are one-dimensional: two sweeps settle flush adjacency.
      for (let i = 1; i < arr.length; i++) {
        if (!linked[i] && linked[i - 1] && arr[i - 1].x + arr[i - 1].w >= arr[i].x) linked[i] = true;
      }
      for (let i = arr.length - 2; i >= 0; i--) {
        if (!linked[i] && linked[i + 1] && arr[i].x + arr[i].w >= arr[i + 1].x) linked[i] = true;
      }
      for (let i = 0; i < arr.length; i++) if (linked[i] && !arr[i].ramp) connected++;
    }
    return connected;
  })();
  u16(Math.min((TDT_PARKING_SIZE - 2) / 2, connectedStalls)); // 512-slot stall table
  pad(TDT_PARKING_SIZE - 2);

  // Stairs table: 64 slots (doc §8). Our walkways are one-story flights;
  // exact-footprint stacks collapse into the original's 2- and 3-story
  // variants (types 2/3 and 4/5), remainder as 1-story records.
  const stairRecords: { type: number; x: number; floor: number }[] = [];
  const sorted = [...walkways].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.x - b.x || a.bottom - b.bottom,
  );
  for (let i = 0; i < sorted.length; ) {
    const first = sorted[i];
    let run = 1;
    while (
      i + run < sorted.length &&
      sorted[i + run].kind === first.kind &&
      sorted[i + run].x === first.x &&
      sorted[i + run].bottom === first.bottom + run
    ) {
      run++;
    }
    const isStairs = first.kind === "stairs";
    let base = first.bottom;
    let left = run;
    while (left > 0) {
      const stories = Math.min(3, left);
      // type: 0/1 one-story, 2/3 two-story, 4/5 three-story; odd = stairs.
      const type = (stories - 1) * 2 + (isStairs ? 1 : 0);
      stairRecords.push({ type, x: first.x, floor: base + TDT_FLOOR_OFFSET });
      base += stories;
      left -= stories;
    }
    i += run;
  }
  // Records past the 64-slot table are dropped and COUNTED (a dropped 3-story
  // record is 3 flights); the report never overstates what made the trip.
  let flightsDropped = 0;
  for (let slot = TDT_STAIR_SLOTS; slot < stairRecords.length; slot++) {
    const type = stairRecords[slot].type;
    flightsDropped += type <= 1 ? 1 : type <= 3 ? 2 : 3;
  }
  for (let slot = 0; slot < TDT_STAIR_SLOTS; slot++) {
    const s = stairRecords[slot];
    if (!s) {
      pad(TDT_STAIR_RECORD_SIZE);
      continue;
    }
    u8(1); // built
    u8(s.type);
    u16(s.x);
    u16(s.floor);
    u16(0); // people up (live state)
    u16(0); // people down
  }

  // Trailing routing/reachability region (doc §11+). The 1994 game reads this
  // fixed-size block after the stairs table; without it the file ends ~25 KB
  // short and the game overruns it on load (page fault 0x0799). Filled with the
  // format's 0xFF empty-slot sentinel so the game rebuilds reachability and the
  // crowd from the floor map rather than reading the fill as live population.
  // See TDT_ROUTING_TAIL_SIZE for the harness evidence and the size caveat.
  padFF(TDT_ROUTING_TAIL_SIZE);

  // ---- Report ---------------------------------------------------------------
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
  const shafts = Math.min(elevators.length, TDT_ELEVATOR_SLOTS);
  const flights = walkways.length - flightsDropped;
  const comesAlong: string[] = [
    `${counts.rooms.toLocaleString()} room${counts.rooms === 1 ? "" : "s"} with their occupancy and hotel states.`,
    `${shafts} elevator shaft${shafts === 1 ? "" : "s"} with per-floor stop settings, and ${flights} stairway/escalator flight${flights === 1 ? "" : "s"}.`,
    `Your funds (${fmtMoney(balance * 100)}), star rating, and the clock.`,
  ];
  const staysBehind: string[] = [];
  if (counts.burnedOut > 0) {
    staysBehind.push(
      `${counts.burnedOut} burned-out room${counts.burnedOut === 1 ? "" : "s"} export as burned floor; rebuild them in 1994.`,
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
  if (shaftsDropped > 0) {
    staysBehind.push(
      `${shaftsDropped} elevator shaft${shaftsDropped === 1 ? "" : "s"} past 1994's 24-shaft limit stayed behind.`,
    );
  }
  if (flightsDropped > 0) {
    staysBehind.push(
      `${flightsDropped} stairway/escalator flight${flightsDropped === 1 ? "" : "s"} past 1994's 64-slot table stayed behind.`,
    );
  }
  if (transportsDropped > 0) {
    staysBehind.push(
      `${transportsDropped} transport${transportsDropped === 1 ? "" : "s"} couldn't be represented in a 1994 save and stayed behind.`,
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

  const report: ExportReport = {
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
  return { bytes: new Uint8Array(chunks), report };
}

function fmtMoney(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString()}`;
}
