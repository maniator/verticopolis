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
 * each, built shafts appending a 3,140-byte fixed block, then one 324-byte entry
 * per serviced floor and one 348-byte entry per car; the 3,140 was measured, see
 * TDT_ELEVATOR_BUILT_FIXED); a 132-byte finance block; a 1,026-byte parking
 * block; and 64 × 10-byte stair/escalator records.
 */
export const TDT_PERSON_RECORD_SIZE = 16;
/** Upper bound the exporter clamps its people count to: the canon TOWER census
 *  (15,000). Bounds the people block a forged save can inflate (each unit adds
 *  16 bytes) while still covering any legitimate tower. */
export const TDT_MAX_CENSUS = 15_000;
/** Default saved view-scroll the exporter writes into the header (0x26 = x,
 *  0x28 = y, in world pixels): the value the 1994 game itself stores for a fresh
 *  New Tower, which opens the view on the ground lobby. Left at 0 a loaded tower
 *  opens at the top-left sky instead of on its entrance. */
export const TDT_DEFAULT_VIEW_X = 1105;
export const TDT_DEFAULT_VIEW_Y = 3491;
export const TDT_RETAIL_SLOTS = 512;
export const TDT_RETAIL_RECORD_SIZE = 18;
export const TDT_ELEVATOR_SLOTS = 24;
export const TDT_ELEVATOR_HEADER_SIZE = 194;
// Built shafts append a fixed block whose true size (3140 B) was measured from
// real 1994 saves via the tools/simtower round-trip harness: walking the three
// shafts in my_tower.TDT, the record stride
//   194-byte header + 3140 + 324 * servicedFloors + 348 * cars
// reproduces every shaft's exact file offset. The earlier 480 + 2 * 120 = 720
// estimate undercounted this block by 2420 B, which desynced the whole table
// after the first shaft and forced the importer to synthesize fakes instead.
export const TDT_ELEVATOR_BUILT_FIXED = 3140;
export const TDT_ELEVATOR_PER_FLOOR_SIZE = 324;
export const TDT_ELEVATOR_PER_CAR_SIZE = 348;
/**
 * The 56-byte per-shaft schedule/config block (bytes 4–59 of an elevator
 * header) the 1994 game reads to dispatch cars. Every built shaft in a sampled
 * real save carried this exact default; a zero-filled block instead reads as
 * "run no cars", so the shaft loads with EMPTY cars and traps everyone
 * (confirmed via the SimTower harness). The exporter emits this so exported
 * shafts actually run. The precise per-hour scheduling model (the WD/WE strip
 * in the elevator editor) is a separate feature; see the backlog's
 * `elevator-scheduling`. Layout: 14 bytes 0x01, 14 bytes 0x05, 28 bytes 0x00.
 */
export const TDT_ELEVATOR_SCHEDULE_DEFAULT: readonly number[] = [
  ...(Array(14).fill(0x01) as number[]),
  ...(Array(14).fill(0x05) as number[]),
  ...(Array(28).fill(0x00) as number[]),
];
export const TDT_FINANCE_SIZE = 132;
export const TDT_PARKING_SIZE = 2 + 512 * 2;
export const TDT_STAIR_SLOTS = 64;
export const TDT_STAIR_RECORD_SIZE = 10;
/**
 * Size of the trailing routing/reachability region the 1994 game reads AFTER
 * the stairs table (doc §11+: lobby/reachability tables and related caches).
 *
 * The importer skips this region (its live crowd re-simulates), but the real
 * game reads it at a FIXED extent on load. Our exporter used to end right after
 * the stairs table, ~25 KB short of that extent, so the game read off the end of
 * the file and page-faulted (0x0799, surfaced as "This file is already open, or
 * damaged"). The exporter now emits this region so the file reaches the length
 * the game expects.
 *
 * It is filled with 0xFF, the format's empty-slot sentinel. That choice is
 * load-bearing and was confirmed with the SimTower harness (tools/simtower/):
 * ZERO-filling the same span loads but makes the game read the zeros as live
 * routing data and invent a phantom population (an empty tower reported Pop
 * 1,280 and a bogus star), whereas 0xFF reads as "every slot empty", so the game
 * rebuilds reachability and the crowd from the floor map and reports the right
 * population (an empty tower loads at Pop 0).
 *
 * This fixed size is validated against real saves for Classic towers up to two
 * stars. The exact per-tower size for larger towers (more elevators, sky
 * lobbies, big crowds) is not yet pinned down and is a follow-up; see the
 * backlog's `tdt-export-routing-tail` row. Over-emitting is safe (the game
 * ignores trailing slack); under-emitting is the crash, so this is generous.
 */
export const TDT_ROUTING_TAIL_SIZE = 0x6400;
/** Sanity bounds used to recognize a real stair record while scanning for the
 *  table: a built flight sits within the tower's tile span, on a valid floor,
 *  with a plausible waiting-crowd count. Generous on purpose (validation, not
 *  gameplay): the goal is to reject finance/parking bytes, not to clamp data. */
export const TDT_MAX_TILE = 800;
export const TDT_MAX_STAIR_CROWD = 4000;
/** How far past the elevator table to scan for the stairs table (bytes). The
 *  finance block (132) + parking/lobby region between the elevator table and the
 *  stairs table measured ~0.7 KB in a real save and is bounded by parking's
 *  512-stall table (~1 KB); 4 KB covers that with slack while keeping the scan
 *  away from the far §11 lobby/§12 named-tenant blocks (smaller window = less
 *  chance a coincidental later window out-counts the real table). */
export const TDT_STAIR_SCAN_WINDOW = 4096;

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
  /** The elevator kind: 0 = express, 1 = standard, 2 = service. This byte is
   *  authoritative (confirmed against the real game: a service shaft imported as
   *  service only from this byte). */
  type: number;
  /** Byte 2 of the header. The doc calls it per-car capacity (42/21/10), but a
   *  real save read 21 for BOTH standard AND service shafts, so it is NOT a
   *  reliable kind signal; {@link type} is. Kept for research; our per-car
   *  capacity comes from the engine's canon table, not this byte. */
  capacity: number;
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
  /** Per-slot canon variant byte from the 512-slot retail table (null if
   *  unreadable). `0xFF` marks empty. Length 512 when read. The importer keys
   *  variants off the unit-record byte 17 (§4, stronger evidence than §7),
   *  but this array is preserved so a round-trip export can rewrite the
   *  same table without silently zeroing legitimate variants. */
  retailVariants: Uint8Array | null;
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

  /** The underlying buffer, for tail structures we locate by scanning for a
   *  record signature rather than by a byte offset we can't pin down. */
  raw(): Uint8Array {
    return this.bytes_;
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
type TdtTail = Pick<TdtTower, "peopleCount" | "retailRows" | "retailVariants" | "elevators" | "stairs" | "parkingConnected" | "warnings">;

/**
 * Locate and decode the 64 × 10-byte stairs/escalator table (doc §8) by
 * scanning for its record signature, starting at `from` (the end of the
 * elevator table). We scan rather than sum block sizes because the finance and
 * parking/lobby blocks between the elevator table and the stairs table are not
 * yet pinned down across saves; a real save put the stairs 436 bytes before our
 * summed offset, so the old arithmetic read zeros and lost every flight.
 *
 * A record is *empty* (built byte 0), *built* (built byte 1 with an in-range
 * type/tile/floor/crowd), or *bad* (anything else). We take the 64-record
 * window that is entirely empty-or-built and holds the MOST flights: the
 * surrounding finance/parking bytes contain out-of-range "built" bytes, so a
 * window overlapping them fails; and because the real table packs its flights
 * into the high slots, an earlier same-alignment window would clip the trailing
 * ones, so "first window with a flight" isn't enough. The earliest window that
 * ties for the maximum count is the true table origin. Returns the built
 * flights, or an empty array when the tower has no stairs (there is nothing to
 * anchor on, which is indistinguishable from an all-empty table and is the
 * common case, not an error).
 */
export function locateStairs(bytes: Uint8Array, from: number): TdtStair[] {
  const REC = TDT_STAIR_RECORD_SIZE;
  const rd16 = (o: number): number => bytes[o] | (bytes[o + 1] << 8);
  // 0 = empty, 1 = built, -1 = not a stair record.
  const classify = (o: number): number => {
    if (o + REC > bytes.length) return -1;
    const built = bytes[o];
    if (built === 0) return 0;
    if (built !== 1) return -1;
    const type = bytes[o + 1];
    const x = rd16(o + 2);
    const floor = rd16(o + 4);
    if (type > 5) return -1;
    // x >= 1: tile 0 is the lot's extreme left edge, never a real flight column, and
    // rejecting it stops a lone "01 00 .." byte from posing as a stair at 0,0 (which
    // would out-count a small real table). floor 0 (= B10) IS a valid TDT floor.
    if (x < 1 || x > TDT_MAX_TILE) return -1;
    if (floor >= TDT_FLOOR_COUNT) return -1; // floor is a TDT index 0..119; 0 = B10 is valid
    if (rd16(o + 6) > TDT_MAX_STAIR_CROWD || rd16(o + 8) > TDT_MAX_STAIR_CROWD) return -1;
    return 1;
  };
  // Bound the scan: the table sits just past the finance + parking/lobby blocks,
  // well within a few KB of the elevator table even in tall towers. A window may
  // run up against EOF (when the stairs table is the file's last structure, as in
  // synthetic fixtures): the remaining slots are simply absent, not a mismatch.
  const last = Math.min(bytes.length - REC, from + TDT_STAIR_SCAN_WINDOW);
  let bestBase = -1;
  let bestBuilt = 0;
  for (let base = Math.max(0, from); base <= last; base++) {
    let built = 0;
    let ok = true;
    for (let s = 0; s < TDT_STAIR_SLOTS; s++) {
      const o = base + s * REC;
      if (o + REC > bytes.length) break; // table ends at EOF; later slots absent
      const c = classify(o);
      if (c < 0) {
        ok = false;
        break;
      }
      built += c;
    }
    if (ok && built > bestBuilt) {
      bestBuilt = built; // strictly-greater keeps the earliest window at the max
      bestBase = base;
    }
  }
  if (bestBase < 0) return []; // no built flights found: the tower has no stairs
  const stairs: TdtStair[] = [];
  for (let s = 0; s < TDT_STAIR_SLOTS; s++) {
    const o = bestBase + s * REC;
    if (o + REC > bytes.length) break;
    if (bytes[o] === 1) stairs.push({ type: bytes[o + 1], x: rd16(o + 2), floor: rd16(o + 4) });
  }
  return stairs;
}

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
    retailVariants: null,
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
  // Per doc §7: byte 0 is the row's floor (0xFF marks empty), byte 1 is the
  // status (0-3), byte 2 is the canon variant. Preserve the variant byte per
  // slot so a round-trip export can rewrite the same table; the importer
  // still keys individual units off the unit-record byte 17 (§4, stronger
  // evidence).
  const variants = new Uint8Array(TDT_RETAIL_SLOTS);
  for (let slot = 0; slot < TDT_RETAIL_SLOTS; slot++) {
    const floor = r.u8();
    r.skip(1); // status
    const variant = r.u8();
    r.skip(TDT_RETAIL_RECORD_SIZE - 3);
    variants[slot] = variant;
    if (floor !== 0xff) occupied++;
  }
  tail.retailRows = occupied;
  tail.retailVariants = variants;

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
    const capacity = r.u8(); // byte 2; NOT a reliable kind signal (a real service shaft read 21). Kind comes from `type`; see TdtElevator.capacity.
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
    elevators.push({ type, capacity, cars, x, topFloor, bottomFloor, serviced, carHomes });
  }
  tail.elevators = elevators;
  // The stairs table lives after the finance and parking/lobby blocks, whose
  // sizes we can't yet pin down across saves, so we locate it by signature from
  // here (the end of the elevator table) rather than by summing those blocks.
  const afterElevators = r.offset();

  // ---- Finance block (doc §9): best-effort; only used for parkingConnected.
  // Stairs no longer depend on landing exactly after it. ----
  r.enterBlock("finance block");
  if (r.remaining() >= TDT_FINANCE_SIZE) {
    r.skip(TDT_FINANCE_SIZE);
    // ---- Parking block (doc §10): connected-stall count + stall table ----
    r.enterBlock("parking block");
    if (r.remaining() >= TDT_PARKING_SIZE) {
      tail.parkingConnected = r.u16();
      r.skip(TDT_PARKING_SIZE - 2); // advance past the stall table so the reader position stays honest
    }
  } else {
    // The file ends right after the elevator table, before even the finance
    // block: the stairs table can't be present, so an empty result here is a
    // truncation, not a stairless tower. Say so (locateStairs itself can't tell
    // the two apart; see the backlog's tdt-import stairs-scan defer).
    warnings.push(
      "The save ends right after its elevators, so its finance, parking, and stairway data could not be read.",
    );
  }

  // ---- Stairs/escalators (doc §8): 64 × 10-byte records, found by signature
  // (empty array when the tower has no stairs; see locateStairs).
  r.enterBlock("stairs table");
  tail.stairs = locateStairs(r.raw(), afterElevators);
  // Named-tenant and other ancillary blocks follow; not yet imported.
  return tail;
}
