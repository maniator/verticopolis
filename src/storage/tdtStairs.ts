/**
 * The stairs table of a `.TDT` file, found by its record signature, and the two
 * alignment markers the elevator payload-layout choice uses (extracted from
 * `tdtTail.ts`).
 */
import {
  TDT_FLOOR_COUNT,
  TDT_MAX_STAIR_CROWD,
  TDT_MAX_TILE,
  TDT_STAIR_RECORD_SIZE,
  TDT_STAIR_SCAN_WINDOW,
  TDT_STAIR_SLOTS,
} from "./tdtConstants";
import type { TdtStair } from "./tdtTypes";

/** Read one stairs record: 0 = empty slot, 1 = built flight, -1 = not a stair
 *  record at all. Shared by the scan and by {@link stairsTableStartsAt}. */
function classifyStairRecord(bytes: Uint8Array, o: number): number {
  const REC = TDT_STAIR_RECORD_SIZE;
  const rd16 = (at: number): number => bytes[at] | (bytes[at + 1] << 8);
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
}

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
  const classify = (o: number): number => classifyStairRecord(bytes, o);
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
 * Does the trailing routing region BEGIN exactly at `at`? Our writer emits that
 * region `0xFF`-filled (doc §11), so its first byte is `0xFF` and the byte
 * before it, the last of the stairs table, is not.
 *
 * That boundary is what makes this usable as an alignment marker. The region is
 * 25,600 bytes long, so "a run of 0xFF starts here" is true at 25,600 offsets;
 * only "the run STARTS here" is true at one. It is the marker of last resort for
 * the payload-layout choice, and the only one left for a tower with no
 * stairways, where the stairs table is 64 empty records and says nothing.
 */
export function routingTailStartsAt(bytes: Uint8Array, at: number): boolean {
  const RUN = 64; // enough 0xFF to not be a coincidence, short enough to survive truncation
  if (at <= 0 || at + RUN > bytes.length) return false;
  if (bytes[at - 1] === 0xff) return false; // already inside the region, not at its start
  for (let i = 0; i < RUN; i++) if (bytes[at + i] !== 0xff) return false;
  return true;
}

/**
 * Could a COMPLETE stairs table start exactly at `at`? All 64 records must be
 * present and read as stair records, and at least one must be built.
 *
 * Completeness is the load-bearing part. This is only ever used as an alignment
 * marker, and accepting a table that runs into EOF lets a single residual
 * 10-byte stair-shaped record at the end of a TRUNCATED file corroborate a
 * layout that file does not have. `locateStairs` is the tolerant one, because
 * reading whatever flights survive is a different job from proving an offset.
 *
 * Note this is deliberately not "where did locateStairs find the table": that
 * scan takes the EARLIEST window holding the most built flights, and since an
 * all-zero record is a valid empty slot, a sparse table's window can begin up to
 * 63 records before its true start. Fine for reading the flights, useless as an
 * alignment marker, which is what the payload-layout choice needs.
 */
export function stairsTableStartsAt(bytes: Uint8Array, at: number): boolean {
  const REC = TDT_STAIR_RECORD_SIZE;
  if (at < 0 || at + TDT_STAIR_SLOTS * REC > bytes.length) return false; // must be whole
  let built = 0;
  for (let s = 0; s < TDT_STAIR_SLOTS; s++) {
    const c = classifyStairRecord(bytes, at + s * REC);
    if (c < 0) return false;
    built += c;
  }
  return built > 0;
}
