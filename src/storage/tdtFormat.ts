/**
 * Pure binary walker for the original 1994 SimTower `.TDT` save format.
 *
 * Layout facts come from `docs/canon/tdt-format.md` (our restatement of the
 * OpenSkyscraper reverse-engineering notes) — this module only mirrors the
 * file into a dumb intermediate model ({@link TdtTower}); all game-semantic
 * mapping (tenant IDs → FacilityKind, money ×100, frame → clock) lives in
 * `tdtImport.ts`.
 *
 * The original game barely validates its own saves, so every count and offset
 * here is treated as hostile input: the reader is bounds-checked, per-floor
 * tenant counts are capped BEFORE any loop, and every failure is a typed
 * {@link LegacyImportError} with a player-readable message — never a raw
 * RangeError or a hang.
 */

/** A `.TDT` file that can't be read. `message` is always player-readable. */
export class LegacyImportError extends Error {}

/** Header magic: the u16 at offset 0 is `0x2400` in every known save. */
export const TDT_MAGIC = 0x2400;

/** Fixed header block size — the floor map starts here (doc §1). */
export const TDT_HEADER_SIZE = 0x22c;

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
 *  food counts workers+customers, so real files run higher — 100k is far past
 *  any legitimate save while still refusing absurd skip lengths). */
export const TDT_MAX_PEOPLE = 100_000;

/**
 * Byte sizes for the partially documented tail blocks (doc §6–§7). The person
 * record's field list is known but its exact packing is not confirmed, so the
 * tail is walked TOLERANTLY: a misfit here downgrades to a warning, never an
 * import failure — nothing v1 imports lives past the floor map.
 */
export const TDT_PERSON_RECORD_SIZE = 14;
export const TDT_RETAIL_SLOTS = 512;
export const TDT_RETAIL_RECORD_SIZE = 18;

/** One tenant record, mirrored raw from the file (doc §4 field order). */
export interface TdtTenant {
  /** Left/right extents in 8-pixel segments == our tiles (half-open range). */
  left: number;
  right: number;
  /** Tenant type ID (doc §5). Negative ⇒ under construction. */
  type: number;
  /** Status / occupant-count byte (nonzero ⇒ tenanted, per the doc). */
  status: number;
  /** Per-type data index (unused in v1). */
  dataIndex: number;
  /** Offset into the people block (unused in v1). */
  peopleOffset: number;
  /** Index of this tenant within its floor (unused in v1). */
  indexInFloor: number;
  /** Rent-class byte (unused in v1 — see the backlog's tdt-importer row). */
  rentClass: number;
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
  /** File-format version word — `0x2400` (the magic). */
  version: number;
  /** 1–5 = star rating, 6 = TOWER. */
  level: number;
  /** Funds in STORED units — display dollars are ×100 (doc §2). Signed. */
  balance: number;
  /** Time of day in frames 0–2599 (doc §3). */
  frameTime: number;
  /** Days since "WD 1 / 1Q / Year 1". Signed in the file. */
  currentDay: number;
}

/** The whole file, mirrored — no game semantics applied yet. */
export interface TdtTower {
  header: TdtHeader;
  floors: TdtFloor[];
  /** People count from the tail, when it could be read (else null). */
  peopleCount: number | null;
  /** Occupied rows found in the 512-slot retail table (null if unreadable). */
  retailRows: number | null;
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

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Name the block subsequent reads belong to (for truncation messages). */
  enterBlock(name: string): void {
    this.block = name;
  }

  remaining(): number {
    return this.bytes.byteLength - this.pos;
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
 * everything after the floor map — the only part v1 consumes — is walked
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
      const dataIndex = r.u16();
      const peopleOffset = r.u32();
      const indexInFloor = r.u16();
      const rentClass = r.u8();
      r.skip(3); // undocumented padding closing out the 18-byte record
      tenants.push({ left, right, type, status, dataIndex, peopleOffset, indexInFloor, rentClass });
    }
    r.skip(TDT_FLOOR_INDEX_ENTRIES * 2); // per-floor index map into the tenant array
    floors.push({ index, leftEdge, rightEdge, tenants });
  }

  const tail = walkTolerantTail(r);
  return { header, floors, ...tail };
}

/**
 * Walk the blocks after the floor map — nothing there is imported in v1.
 * The people/retail/elevator/finance/name blocks are only partially
 * documented (the person record's exact packing is a best guess), so a misfit
 * here must never fail the import: record a warning and stop walking.
 */
function walkTolerantTail(r: ByteReader): Pick<TdtTower, "peopleCount" | "retailRows" | "warnings"> {
  const warnings: string[] = [];
  const stop = (warning: string, peopleCount: number | null = null) => {
    warnings.push(warning);
    return { peopleCount, retailRows: null, warnings };
  };

  r.enterBlock("people block");
  if (r.remaining() < 4) {
    return stop("The file ends right after the floor map, so no people or retail data is present.");
  }
  const peopleCount = r.u32();
  if (peopleCount > TDT_MAX_PEOPLE) {
    return stop("The people table claims an impossible head count, so the rest of the file was skipped.");
  }
  const peopleBytes = peopleCount * TDT_PERSON_RECORD_SIZE;
  if (r.remaining() < peopleBytes) {
    return stop("The people table runs past the end of the file, so the rest of the file was skipped.", peopleCount);
  }
  r.skip(peopleBytes);

  r.enterBlock("retail table");
  if (r.remaining() < TDT_RETAIL_SLOTS * TDT_RETAIL_RECORD_SIZE) {
    return stop("The retail table is missing or cut short, so retail subtypes were skipped.", peopleCount);
  }
  let occupied = 0;
  for (let slot = 0; slot < TDT_RETAIL_SLOTS; slot++) {
    // A negative floor marks an empty slot (doc §7); the rest of the row is
    // subtype data v1 doesn't consume (see the backlog's retail-subtypes row).
    const floor = r.i16();
    r.skip(TDT_RETAIL_RECORD_SIZE - 2);
    if (floor >= 0) occupied++;
  }
  // Elevator, finance and named-tenant blocks follow; v1 leaves them
  // undecoded (transports are synthesized — see tdtImport.ts).
  return { peopleCount, retailRows: occupied, warnings };
}
