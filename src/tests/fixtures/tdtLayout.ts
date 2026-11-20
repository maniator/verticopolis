/**
 * The byte layout of a `.TDT` file as the test builder writes it
 * (`docs/tdt/tdt-format.md` in Verticopolis/engine, beside the codec, `src/tdt/format.rs`).
 * Only the game's test builder (`tdtBuilder.ts`) reads them.
 */

export const TDT_MAGIC = 0x2400;
export const TDT_HEADER_SIZE = 0x230;
export const TDT_FLOOR_COUNT = 120;
/** TDT floor index to our floor: `ours = tdt - 9`. */
const TDT_FLOOR_OFFSET = 9;
/** The New Tower default view-scroll words (header 0x26 and 0x28). */
export const TDT_DEFAULT_VIEW_X = 1105;
export const TDT_DEFAULT_VIEW_Y = 3491;
const TDT_ELEVATOR_PER_FLOOR_SIZE = 324;
export const TDT_FLOOR_INDEX_ENTRIES = 94;
export const TDT_PERSON_RECORD_SIZE = 16;
export const TDT_RETAIL_SLOTS = 512;
export const TDT_RETAIL_RECORD_SIZE = 18;
export const TDT_ELEVATOR_SLOTS = 24;
export const TDT_ELEVATOR_HEADER_SIZE = 194;
/** What follows the elevators in a game save: 22 statistic words, the finance
 *  block, two undecoded blocks, the parking block and the clinic list. */
export const TDT_STATS_SIZE = 22 * 4;
export const TDT_FINANCE_SIZE = 132;
export const TDT_UNKNOWN_FLAGS_SIZE = 12;
export const TDT_UNKNOWN_BYTES_SIZE = 42;
export const TDT_PARKING_SIZE = 2 + 512 * 2;
export const TDT_CLINIC_LIST_SIZE = 2 + 10 * 2;
export const TDT_STAIR_SLOTS = 64;
export const TDT_STAIR_RECORD_SIZE = 10;

const BUILT_FIXED = 3140;
const PER_FLOOR = TDT_ELEVATOR_PER_FLOOR_SIZE;
const CAR_BLOCK = 348;

/** What a built shaft appends after its header: the fixed block, an entry per
 *  floor of the span and the car block. */
export function builtShaftPayloadSize(bottomFloor: number, topFloor: number): number {
  if (!Number.isInteger(bottomFloor) || !Number.isInteger(topFloor) || topFloor < bottomFloor) {
    throw new RangeError(`inverted or fractional shaft span ${bottomFloor}..${topFloor}`);
  }
  return BUILT_FIXED + PER_FLOOR * (topFloor - bottomFloor + 1) + CAR_BLOCK;
}

/** The floors an express shaft has an entry for: from its bottom to its top,
 *  the ones at or below the first floor and every multiple of 15 (the sky
 *  lobbies). The 1994 game sizes an express record by this count. */
function expressEligibleFloors(bottomFloor: number, topFloor: number): number {
  let count = 0;
  for (let raw = bottomFloor; raw <= topFloor; raw++) {
    const floor = raw - TDT_FLOOR_OFFSET;
    if (floor <= 1 || floor % 15 === 0) count++;
  }
  return count;
}

/** An express shaft's payload as the game sizes it, an entry per eligible floor
 *  (at least one); the span is validated like any other shaft's. */
export function expressPayloadSize(bottomFloor: number, topFloor: number): number {
  builtShaftPayloadSize(bottomFloor, topFloor);
  return builtShaftPayloadSize(1, Math.max(1, expressEligibleFloors(bottomFloor, topFloor)));
}
