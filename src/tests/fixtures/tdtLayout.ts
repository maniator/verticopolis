/**
 * The byte layout of a `.TDT` file as the test builder writes it
 * (`docs/canon/tdt-format.md`; the codec itself is Rust, `engine-rs/src/tdt/format.rs`).
 * The builder and the tests that cut or pad a buffer share these sizes.
 */

export const TDT_MAGIC = 0x2400;
export const TDT_HEADER_SIZE = 0x230;
export const TDT_FLOOR_COUNT = 120;
export const TDT_TENANT_RECORD_SIZE = 18;
/** TDT floor index to our floor: `ours = tdt - 9`. */
export const TDT_FLOOR_OFFSET = 9;
/** The New Tower default view-scroll words (header 0x26 and 0x28). */
export const TDT_DEFAULT_VIEW_X = 1105;
export const TDT_DEFAULT_VIEW_Y = 3491;
/** Bytes the writer appends after the stairs table for the game's routing region. */
export const TDT_ROUTING_TAIL_SIZE = 0x6400;
export const TDT_ELEVATOR_PER_FLOOR_SIZE = 324;
export const TDT_FLOOR_INDEX_ENTRIES = 94;
export const TDT_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const TDT_PERSON_RECORD_SIZE = 16;
export const TDT_RETAIL_SLOTS = 512;
export const TDT_RETAIL_RECORD_SIZE = 18;
export const TDT_ELEVATOR_SLOTS = 24;
export const TDT_ELEVATOR_HEADER_SIZE = 194;
export const TDT_FINANCE_SIZE = 132;
export const TDT_PARKING_SIZE = 2 + 512 * 2;
export const TDT_STAIR_SLOTS = 64;
export const TDT_STAIR_RECORD_SIZE = 10;
/** The trailer our writer stamps: magic plus a u16 generation. */
export const TDT_STAMP_MAGIC = "VCTDT";
export const TDT_STAMP_GENERATION = 1;
export const TDT_STAMP_SIZE = TDT_STAMP_MAGIC.length + 2;

const BUILT_FIXED = 3140;
const PER_FLOOR = TDT_ELEVATOR_PER_FLOOR_SIZE;
const CAR_BLOCK = 348;
const EXPRESS = 0;

/** What a built shaft appends after its header: the fixed block, an entry per
 *  floor of the span and the car block. */
export function builtShaftPayloadSize(bottomFloor: number, topFloor: number): number {
  if (!Number.isInteger(bottomFloor) || !Number.isInteger(topFloor) || topFloor < bottomFloor) {
    throw new RangeError(`inverted or fractional shaft span ${bottomFloor}..${topFloor}`);
  }
  return BUILT_FIXED + PER_FLOOR * (topFloor - bottomFloor + 1) + CAR_BLOCK;
}

/** The same, sized the way the 1994 game sizes an express shaft: by the floors
 *  it stops at (at least one) rather than the floors it spans. */
export function builtShaftPayloadSizeFor(type: number, bottomFloor: number, topFloor: number, servicedCount: number): number {
  const spanned = builtShaftPayloadSize(bottomFloor, topFloor);
  return type === EXPRESS ? builtShaftPayloadSize(1, Math.max(1, servicedCount)) : spanned;
}

/** The 56-byte per-shaft schedule block every built shaft carries: 14 bytes
 *  0x01, 14 bytes 0x05, 28 bytes 0x00. */
export const TDT_ELEVATOR_SCHEDULE_DEFAULT: readonly number[] = [
  ...(Array(14).fill(0x01) as number[]),
  ...(Array(14).fill(0x05) as number[]),
  ...(Array(28).fill(0x00) as number[]),
];

/** One tenant record as it sits in the file (doc section 5). */
export interface WireTenant {
  left: number;
  right: number;
  type: number;
  status: number;
  variant: number;
  rentRate: number;
  subtype: number;
}

/** One built elevator slot's header fields. */
export interface WireElevator {
  type: number;
  cars: number;
  x: number;
  topFloor: number;
  bottomFloor: number;
}

const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/**
 * A file the exporter wrote, read straight off the wire by fixed offsets: every
 * floor's tenant records, and the built elevator slots (the writer sizes every
 * shaft by its spanned floors). It is a ground truth that does not go through
 * the importer.
 */
export function wireModel(bytes: Uint8Array): { floors: { tenants: WireTenant[] }[]; elevators: WireElevator[] } {
  let o = TDT_HEADER_SIZE;
  const floors: { tenants: WireTenant[] }[] = [];
  for (let index = 0; index < TDT_FLOOR_COUNT; index++) {
    const count = u16(bytes, o);
    const tenants: WireTenant[] = [];
    for (let k = 0; k < count; k++) {
      const r = o + 6 + k * TDT_TENANT_RECORD_SIZE;
      tenants.push({
        left: u16(bytes, r),
        right: u16(bytes, r + 2),
        type: (bytes[r + 4] << 24) >> 24,
        status: bytes[r + 5],
        variant: bytes[r + 6],
        rentRate: bytes[r + 16],
        subtype: bytes[r + 17],
      });
    }
    floors.push({ tenants });
    o += 6 + count * TDT_TENANT_RECORD_SIZE + TDT_FLOOR_INDEX_ENTRIES * 2;
  }
  o += 4 + u32(bytes, o) * TDT_PERSON_RECORD_SIZE; // people
  o += TDT_RETAIL_SLOTS * TDT_RETAIL_RECORD_SIZE; // retail table
  const elevators: WireElevator[] = [];
  for (let slot = 0; slot < TDT_ELEVATOR_SLOTS; slot++) {
    const used = bytes[o];
    const top = bytes[o + 64];
    const bottom = bytes[o + 65];
    if (used !== 0) elevators.push({ type: bytes[o + 1], cars: bytes[o + 3], x: u16(bytes, o + 62), topFloor: top, bottomFloor: bottom });
    o += TDT_ELEVATOR_HEADER_SIZE + (used !== 0 ? builtShaftPayloadSize(bottom, top) : 0);
  }
  return { floors, elevators };
}
