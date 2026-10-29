/**
 * Finding elevator slot headers by their shape, for a save whose shaft payloads
 * are sized by a rule none of the documented layouts has (see `tdtTail.ts`).
 */
import {
  TDT_ELEVATOR_BUILT_FIXED,
  TDT_ELEVATOR_CAR_BLOCK_SIZE,
  TDT_ELEVATOR_HEADER_SIZE,
  TDT_ELEVATOR_PER_FLOOR_SIZE,
  TDT_ELEVATOR_SLOTS,
  TDT_FLOOR_COUNT,
  TDT_MAX_TILE,
} from "./tdtConstants";

/** The least a built shaft can append after its header: the fixed block, one
 *  per-floor entry and the car block. */
export const MIN_BUILT_PAYLOAD = TDT_ELEVATOR_BUILT_FIXED + TDT_ELEVATOR_PER_FLOOR_SIZE + TDT_ELEVATOR_CAR_BLOCK_SIZE;
/** The most a built shaft can append: the fixed block, an entry for every floor
 *  of the tower and the car block. */
export const MAX_BUILT_PAYLOAD =
  TDT_ELEVATOR_BUILT_FIXED + TDT_FLOOR_COUNT * TDT_ELEVATOR_PER_FLOOR_SIZE + TDT_ELEVATOR_CAR_BLOCK_SIZE;

/** What a built shaft appends besides its per-floor entries. */
const FIXED_PAYLOAD = TDT_ELEVATOR_BUILT_FIXED + TDT_ELEVATOR_CAR_BLOCK_SIZE;

/**
 * Empty slots that fit between a built shaft's header and the next built header,
 * `distance` bytes on, given that the shaft's payload is the fixed block, the
 * car block and a whole number of 324-byte floor entries (at least one) and each
 * empty slot is a 194-byte header. The two sizes share no factor the slot count
 * could hide in (194 x k is a multiple of 324 only when k is a multiple of 162),
 * so there is at most one answer. `-1` means the distance fits no shaft followed
 * by empty slots that still fit in the table (`slot` is the index of the slot
 * after the shaft).
 */
export function emptySlotsInGap(distance: number, slot: number): number {
  const afterFixed = distance - TDT_ELEVATOR_HEADER_SIZE - FIXED_PAYLOAD;
  for (let empty = 0; empty < TDT_ELEVATOR_SLOTS - slot; empty++) {
    const floors = afterFixed - empty * TDT_ELEVATOR_HEADER_SIZE;
    if (floors >= TDT_ELEVATOR_PER_FLOOR_SIZE && floors % TDT_ELEVATOR_PER_FLOOR_SIZE === 0) return empty;
  }
  return -1;
}

/**
 * Does a built elevator slot header start at `o`? Every field the walk checks,
 * plus what a real shaft always has: a position on the lot and a stop somewhere
 * in its span (an express shaft may skip its own bottom floor, as one measured
 * 1997 save does). Strict on purpose: {@link findNextHeader} uses it to find a
 * header inside payload bytes of unknown length.
 */
function plausibleHeader(bytes: Uint8Array, o: number): boolean {
  if (o + TDT_ELEVATOR_HEADER_SIZE > bytes.length) return false;
  const used = bytes[o];
  const type = bytes[o + 1];
  const cars = bytes[o + 3];
  const x = bytes[o + 62] | (bytes[o + 63] << 8);
  const topFloor = bytes[o + 64];
  const bottomFloor = bytes[o + 65];
  return (
    used === 1 &&
    type <= 2 &&
    cars >= 1 &&
    cars <= 8 &&
    x >= 1 &&
    x <= TDT_MAX_TILE &&
    bottomFloor <= topFloor &&
    topFloor < TDT_FLOOR_COUNT &&
    bytes.subarray(o + 66 + bottomFloor, o + 66 + topFloor + 1).some((stop) => stop !== 0)
  );
}

/** The first plausible built-slot header from `from` up to `to` that `accepts`
 *  (the walk's own check on the distance to it), or -1. */
export function findNextHeader(bytes: Uint8Array, from: number, to: number, accepts: (o: number) => boolean): number {
  for (let o = from; o < bytes.length && o <= to; o++) if (plausibleHeader(bytes, o) && accepts(o)) return o;
  return -1;
}
