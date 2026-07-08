/**
 * Pure binary walker for the original 1994 SimTower `.TDT` save format.
 *
 * Layout facts come from `docs/canon/tdt-format.md` (our restatement of the
 * OpenSkyscraper notes, cross-checked against the dfloer/tower-docs
 * `tdt_spec.md` reverse-engineering); this module only mirrors the file
 * into a dumb intermediate model ({@link TdtTower}); all game-semantic
 * mapping (tenant IDs → FacilityKind, money ×100, frame → clock) lives in
 * `tdtImport.ts`.
 *
 * The original game barely validates its own saves, so every count and offset
 * here is treated as hostile input: the reader is bounds-checked, per-floor
 * tenant counts are capped BEFORE any loop, and every failure is a typed
 * {@link LegacyImportError} with a player-readable message; never a raw
 * RangeError or a hang. The header and floor map are load-bearing (a failure
 * there fails the import); everything after (people, retail, elevators,
 * finance, parking, stairs) is walked TOLERANTLY, so a misfit downgrades to
 * a warning and the importer falls back gracefully.
 */

/** A `.TDT` file that can't be read. `message` is always player-readable. */
export class LegacyImportError extends Error {}

/** Header magic: the u16 at offset 0 is `0x2400` in every known save. */
export const TDT_MAGIC = 0x2400;

/** Fixed header block size; the floor map starts at offset 560 (doc §1;
 *  confirmed by tower-docs, and by the arithmetic 560 + 10 × 194 empty
 *  basement records = 0x9C4, the ground-floor offset seen in real saves). */
export const TDT_HEADER_SIZE = 0x230;

/** Floor slots in the file: indexes 0–119 (doc §4). */
export const TDT_FLOOR_COUNT = 120;

/** One tenant record is 18 bytes (doc §4). */
export const TDT_TENANT_RECORD_SIZE = 18;

/** Each floor record ends with a 94-entry u16 index map (doc §4). */
export const TDT_FLOOR_INDEX_ENTRIES = 94;

/**
 * Hostile-input ceilings. Each floor record carries a 94-entry index map into
 * its tenant array (doc §4), so ~94 is the format's own structural bound on
 * tenants per floor; 256 is a generous ceiling above that (in case the map's
 * role is misunderstood upstream) that still refuses absurd counts before any
 * loop runs. The size ceiling comfortably holds a maxed tower (~120 floors ×
 * a few KB) while refusing a multi-gigabyte allocation.
 */
export const TDT_MAX_TENANTS_PER_FLOOR = 256;
export const TDT_MAX_FILE_BYTES = 4 * 1024 * 1024;
/** People cap for the tolerant tail walk (canon max census is 15,000; fast
 *  food counts workers+customers, so real files run higher; 100k is far past
 *  any legitimate save while still refusing absurd skip lengths). */
export const TDT_MAX_PEOPLE = 100_000;

/**
 * Byte sizes for the tail blocks (doc §6–§10): 16-byte person records after a
 * u32 count; 512 × 18-byte retail rows; 24 elevator entries (194-byte header
 * each, built shafts appending an unknown block, two per-floor structures,
 * one 324-byte entry per serviced floor and one 348-byte entry per car); a
 * 132-byte finance block; a 1,026-byte parking block; and 64 × 10-byte
 * stair/escalator records.
 */
export const TDT_PERSON_RECORD_SIZE = 16;
export const TDT_RETAIL_SLOTS = 512;
export const TDT_RETAIL_RECORD_SIZE = 18;
export const TDT_ELEVATOR_SLOTS = 24;
export const TDT_ELEVATOR_HEADER_SIZE = 194;
export const TDT_ELEVATOR_BUILT_FIXED = 480 + 2 * 120; // unknown block + two per-floor structures
export const TDT_ELEVATOR_PER_FLOOR_SIZE = 324;
export const TDT_ELEVATOR_PER_CAR_SIZE = 348;
export const TDT_FINANCE_SIZE = 132;
export const TDT_PARKING_SIZE = 2 + 512 * 2;
export const TDT_STAIR_SLOTS = 64;
export const TDT_STAIR_RECORD_SIZE = 10;

/** One tenant record, mirrored raw from the file (doc §4 / tower-docs unit
 *  record: extents, type, status byte, 10 reserved bytes, rent, subtype). */
export interface TdtTenant {
  /** Left/right extents in 8-pixel segments == our tiles (half-open range). */
  left: number;
  right: number;
  /** Tenant type ID (doc §5). Negative ⇒ under construction. */
  type: number;
  /** Status/flags byte at offset 5 (a bit field for hotels; nonzero ⇒
   *  tenanted for offices/condos, per the doc). */
  status: number;
  /** Rent/lease rate byte at offset 16: 0 very low … 3 high, 4 no rate
   *  (unused in v1; see the backlog's tdt-importer row). */
  rentRate: number;
  /** Per-type byte at offset 17 (retail variant / hotel dirty-days;
   *  unused in v1). */
  subtype: number;
}

/** One floor record: built extent plus its tenant list. */
export interface TdtFloor {
  /** TDT floor index 0–119 (0–9 = B10…B1, 10 = ground; doc §4). */
  index: number;
  /** Built extent in tiles (half-open; equal ⇒ nothing built here). */
  leftEdge: number;
  rightEdge: number;
  tenants: TdtTenant[];
}

/** The fixed-offset header fields v1 consumes (doc §1). */
export interface TdtHeader {
  /** File-format version word; `0x2400` (the magic). */
  version: number;
  /** 1–5 = star rating, 6 = TOWER. */
  level: number;
  /** Funds in STORED units; display dollars are ×100 (doc §2). Signed. */
  balance: number;
  /** Time of day in frames 0–2599 (doc §3). */
  frameTime: number;
  /** Days since "WD 1 / 1Q / Year 1". Signed in the file. */
  currentDay: number;
}

/** One decoded elevator entry (doc §8; floors are TDT indexes 0–119). */
export interface TdtElevator {
  /** 0 = express, 1 = standard, 2 = service. */
  type: number;
  /** Cars in the shaft, 1–8. */
  cars: number;
  /** Horizontal position in tiles from the left. */
  x: number;
  topFloor: number;
  bottomFloor: number;
  /** Per-floor stop flags (120 entries; nonzero = cars stop there). */
  serviced: Uint8Array;
  /** Home floor for each of the 8 car slots (TDT indexes). */
  carHomes: number[];
}

/** One decoded stair/escalator record (doc §8; floor is a TDT index). */
export interface TdtStair {
  /** 0 = escalator, 1 = stairs; 2/3 = two-story, 4/5 = three-story variants. */
  type: number;
  /** Left tile of the flight. */
  x: number;
  /** Base floor (TDT index). */
  floor: number;
}

/** The whole file, mirrored; no game semantics applied yet. */
export interface TdtTower {
  header: TdtHeader;
  floors: TdtFloor[];
  /** People count from the tail, when it could be read (else null). */
  peopleCount: number | null;
  /** Occupied rows found in the 512-slot retail table (null if unreadable). */
  retailRows: number | null;
  /** Decoded elevator shafts, or null when the block couldn't be read;
   *  the importer then falls back to synthesizing a layout. */
  elevators: TdtElevator[] | null;
  /** Decoded stair/escalator flights (null when unreadable). */
  stairs: TdtStair[] | null;
  /** The save's connected-parking-stall count (null when unreadable). */
  parkingConnected: number | null;
  /** Non-fatal oddities found while walking the tolerant tail. */
  warnings: string[];
}

/**
 * Bounds-checked little-endian reader. Every read names the block it happened
 * in (via {@link ByteReader.enterBlock}) so an overrun throws a typed, honest
 * "truncated at <block>" instead of a raw RangeError.
 */
export class ByteReader {
  private pos = 0;
  private block = "header";
  private readonly view: DataView;

  constructor(private readonly bytes_: Uint8Array) {
    this.view = new DataView(bytes_.buffer, bytes_.byteOffset, bytes_.byteLength);
  }

  /** Name the block subsequent reads belong to (for truncation messages). */
  enterBlock(name: string): void {
    this.block = name;
  }

  remaining(): number {
    return this.bytes_.byteLength - this.pos;
  }

  offset(): number {
    return this.pos;
  }

  private need(n: number): void {
    if (n < 0 || this.remaining() < n) {
      throw new LegacyImportError(
        `This SimTower save is cut short. The file ends in the middle of its ${this.block}.`,
      );
    }
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }

  /** Read `n` raw bytes as a copy (so later reads can't mutate it). */
  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes_.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
}

/**
 * Walk a `.TDT` byte stream into the raw {@link TdtTower} model. Throws a
 * {@link LegacyImportError} for anything that can't be a readable save
 * (wrong magic, truncation inside the header/floor map, absurd counts);
 * everything after the floor map; the only part v1 consumes; is walked
 * tolerantly, downgrading misfits to `warnings`.
 */
export function parseTdtBinary(bytes: Uint8Array): TdtTower {
  if (bytes.byteLength > TDT_MAX_FILE_BYTES) {
    throw new LegacyImportError("This file is too large to be a SimTower save.");
  }
  if (bytes.byteLength < TDT_HEADER_SIZE) {
    throw new LegacyImportError("This file is too small to be a SimTower save.");
  }
  const r = new ByteReader(bytes);

  r.enterBlock("header");
  const version = r.u16();
  if (version !== TDT_MAGIC) {
    throw new LegacyImportError("This file doesn't look like a SimTower save.");
  }
  const level = r.u16();
  const balance = r.i32();
  r.skip(12); // otherIncome, constructionCosts, lastQuarterMoney (finance import is a queued follow-up)
  const frameTime = r.u16();
  const currentDay = r.i32();
  // The rest of the ~518-byte misc block (screen position words, undocumented
  // fields) carries nothing v1 imports.
  r.skip(TDT_HEADER_SIZE - r.offset());
  const header: TdtHeader = { version, level, balance, frameTime, currentDay };

  const floors: TdtFloor[] = [];
  for (let index = 0; index < TDT_FLOOR_COUNT; index++) {
    r.enterBlock(`floor map (floor record ${index})`);
    const tenantCount = r.u16();
    const leftEdge = r.u16();
    const rightEdge = r.u16();
    // Cap and pre-check BEFORE the loop: a forged count must fail loudly here,
    // not allocate/iterate its way into a hang.
    if (tenantCount > TDT_MAX_TENANTS_PER_FLOOR) {
      throw new LegacyImportError(
        `This SimTower save is corrupt: one floor claims ${tenantCount.toLocaleString()} rooms.`,
      );
    }
    const floorBytes = tenantCount * TDT_TENANT_RECORD_SIZE + TDT_FLOOR_INDEX_ENTRIES * 2;
    if (r.remaining() < floorBytes) {
      throw new LegacyImportError(
        "This SimTower save is cut short. The file ends in the middle of its floor map.",
      );
    }
    const tenants: TdtTenant[] = [];
    for (let t = 0; t < tenantCount; t++) {
      const left = r.u16();
      const right = r.u16();
      const type = r.i8();
      const status = r.u8();
      r.skip(10); // reserved bytes 6–15 (tower-docs)
      const rentRate = r.u8();
      const subtype = r.u8();
      tenants.push({ left, right, type, status, rentRate, subtype });
    }
    r.skip(TDT_FLOOR_INDEX_ENTRIES * 2); // per-floor index map into the tenant array
    floors.push({ index, leftEdge, rightEdge, tenants });
  }

  const tail = walkTolerantTail(r);
  return { header, floors, ...tail };
}

/** Everything walkTolerantTail can produce. */
type TdtTail = Pick<TdtTower, "peopleCount" | "retailRows" | "elevators" | "stairs" | "parkingConnected" | "warnings">;

/**
 * Walk the blocks after the floor map; people, retail, elevators, finance,
 * parking, stairs (file order per doc §6–§10). A misfit here must never fail
 * the import: each stage that can't be read is recorded as a warning and
 * nulled out, and the importer degrades gracefully (a null elevator/stairs
 * decode makes it synthesize a transport layout instead).
 */
function walkTolerantTail(r: ByteReader): TdtTail {
  const warnings: string[] = [];
  const tail: TdtTail = {
    peopleCount: null,
    retailRows: null,
    elevators: null,
    stairs: null,
    parkingConnected: null,
    warnings,
  };

  r.enterBlock("people block");
  if (r.remaining() < 4) {
    warnings.push("The file ends right after the floor map, so no people or transport data is present.");
    return tail;
  }
  const peopleCount = r.u32();
  if (peopleCount > TDT_MAX_PEOPLE) {
    warnings.push("The people table claims an impossible head count, so the rest of the file was skipped.");
    return tail;
  }
  const peopleBytes = peopleCount * TDT_PERSON_RECORD_SIZE;
  if (r.remaining() < peopleBytes) {
    warnings.push("The people table runs past the end of the file, so the rest of the file was skipped.");
    tail.peopleCount = peopleCount;
    return tail;
  }
  r.skip(peopleBytes);
  tail.peopleCount = peopleCount;

  r.enterBlock("retail table");
  if (r.remaining() < TDT_RETAIL_SLOTS * TDT_RETAIL_RECORD_SIZE) {
    warnings.push("The retail table is missing or cut short, so the save's transport data couldn't be reached.");
    return tail;
  }
  let occupied = 0;
  for (let slot = 0; slot < TDT_RETAIL_SLOTS; slot++) {
    // Byte 0 is the row's floor, 0xFF marking an empty slot (doc §7); the
    // rest is status/variant data not yet consumed (see the backlog's
    // retail-subtypes row).
    const floor = r.u8();
    r.skip(TDT_RETAIL_RECORD_SIZE - 1);
    if (floor !== 0xff) occupied++;
  }
  tail.retailRows = occupied;

  // ---- Elevator table (doc §8): 24 entries, variable-width when built -----
  r.enterBlock("elevator table");
  const elevators: TdtElevator[] = [];
  for (let slot = 0; slot < TDT_ELEVATOR_SLOTS; slot++) {
    if (r.remaining() < TDT_ELEVATOR_HEADER_SIZE) {
      warnings.push("The elevator table is cut short, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.");
      return tail;
    }
    const used = r.u8();
    const type = r.u8();
    r.skip(1); // car capacity; ours comes from the engine's canon table
    const cars = r.u8();
    r.skip(56); // per-day-type car schedule block (not imported)
    r.skip(2); // visibility flag + reserved byte
    const x = r.u16();
    const topFloor = r.u8();
    const bottomFloor = r.u8();
    const serviced = r.bytes(TDT_FLOOR_COUNT);
    const carHomes: number[] = [];
    for (let c = 0; c < 8; c++) carHomes.push(r.u8());
    if (used === 0) continue; // empty slot: header only, no payload
    if (used !== 1 || type > 2 || cars < 1 || cars > 8) {
      // The entry doesn't parse as documented; the payload size below would
      // be a guess, and every later slot would misalign. Bail to synthesis.
      warnings.push("The elevator table doesn't match the documented layout, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.");
      return tail;
    }
    // Built shafts append live passenger/queue state we deliberately skip:
    // our crowd re-simulates. One 324-byte entry per SERVICED floor and one
    // 348-byte entry per car, after a fixed unknown+per-floor block.
    let servicedCount = 0;
    for (let i = 0; i < serviced.length; i++) if (serviced[i] !== 0) servicedCount++;
    const payload =
      TDT_ELEVATOR_BUILT_FIXED + servicedCount * TDT_ELEVATOR_PER_FLOOR_SIZE + cars * TDT_ELEVATOR_PER_CAR_SIZE;
    if (r.remaining() < payload) {
      warnings.push("The elevator table is cut short, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.");
      return tail;
    }
    r.skip(payload);
    elevators.push({ type, cars, x, topFloor, bottomFloor, serviced, carHomes });
  }
  tail.elevators = elevators;

  // ---- Finance block (doc §9); a queued follow-up; skip over it ----------
  r.enterBlock("finance block");
  if (r.remaining() < TDT_FINANCE_SIZE) {
    warnings.push("The finance block is cut short; stairs and escalators couldn't be read.");
    return tail;
  }
  r.skip(TDT_FINANCE_SIZE);

  // ---- Parking block (doc §10): connected-stall count + stall table -------
  r.enterBlock("parking block");
  if (r.remaining() < TDT_PARKING_SIZE) {
    warnings.push("The parking block is cut short; stairs and escalators couldn't be read.");
    return tail;
  }
  tail.parkingConnected = r.u16();
  r.skip(TDT_PARKING_SIZE - 2);

  // ---- Stairs/escalators (doc §8): fixed 64 × 10-byte records -------------
  r.enterBlock("stairs table");
  if (r.remaining() < TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE) {
    warnings.push("The stairs table is missing or cut short, so stairways and escalators stayed behind.");
    return tail;
  }
  const stairs: TdtStair[] = [];
  for (let slot = 0; slot < TDT_STAIR_SLOTS; slot++) {
    const built = r.u8();
    const type = r.u8();
    const x = r.u16();
    const floor = r.u16();
    r.skip(4); // live people-up/people-down counts; the crowd re-simulates
    if (built === 1) stairs.push({ type, x, floor });
  }
  tail.stairs = stairs;
  // Named-tenant and other ancillary blocks follow; not yet imported.
  return tail;
}
