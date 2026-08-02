/**
 * Tolerant walk of the blocks after the `.TDT` floor map (people, retail,
 * elevators, finance, parking, stairs) plus the signature-scan that locates the
 * stairs table. Extracted from `tdtFormat.ts`. A misfit here never fails the
 * import: each unreadable stage is nulled and recorded as a warning.
 */
import { ByteReader } from "./tdtByteReader";
import {
  TDT_ELEVATOR_HEADER_SIZE,
  TDT_ELEVATOR_SLOTS,
  builtShaftPayloadSize,
  TDT_FINANCE_SIZE,
  TDT_FLOOR_COUNT,
  TDT_MAX_PEOPLE,
  TDT_MAX_STAIR_CROWD,
  TDT_MAX_TILE,
  TDT_PARKING_SIZE,
  TDT_PERSON_RECORD_SIZE,
  TDT_RETAIL_RECORD_SIZE,
  TDT_RETAIL_SLOTS,
  TDT_STAIR_RECORD_SIZE,
  TDT_STAIR_SCAN_WINDOW,
  TDT_STAIR_SLOTS,
} from "./tdtConstants";
import type { TdtElevator, TdtStair, TdtTail } from "./tdtTypes";

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
 * How much does skipping `payload` bytes look like it lands on the START of the
 * next elevator slot? 2 = a plausible BUILT header, 1 = zeros (an empty slot, or
 * the fill past the last built shaft), 0 = it cannot be a slot boundary.
 *
 * Used only to tell the current spanned-floor payload layout from the
 * serviced-floor one Verticopolis 2.9.0 and earlier wrote. The three levels are
 * the point: a wrong size usually lands in the zero-filled MIDDLE of a payload,
 * which on its own is indistinguishable from an empty slot, so "landed on a real
 * header" has to outrank "landed on zeros" rather than merely tie with it.
 */
function slotStartScore(r: ByteReader, payload: number): 0 | 1 | 2 {
  const at = r.offset() + payload;
  const bytes = r.raw();
  if (at > bytes.length) return 0;
  if (bytes.length - at < TDT_ELEVATOR_HEADER_SIZE) return at === bytes.length ? 1 : 0;
  const used = bytes[at];
  if (used === 0) return 1; // an empty slot, the fill past the table, or a miss
  if (used !== 1) return 0;
  const type = bytes[at + 1];
  const cars = bytes[at + 3];
  const topFloor = bytes[at + 64];
  const bottomFloor = bytes[at + 65];
  const sane = type <= 2 && cars >= 1 && cars <= 8 && topFloor >= bottomFloor && topFloor < TDT_FLOOR_COUNT;
  return sane ? 2 : 0;
}

/**
 * Walk the blocks after the floor map; people, retail, elevators, finance,
 * parking, stairs (file order per doc §6–§10). A misfit here must never fail
 * the import: each stage that can't be read is recorded as a warning and
 * nulled out, and the importer degrades gracefully (a null elevator/stairs
 * decode makes it synthesize a transport layout instead).
 */
export function walkTolerantTail(r: ByteReader): TdtTail {
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
    // Byte 0 is the row's floor, 0xFF marks empty (doc §7); the rest of the
    // 18-byte row is not consumed here (its status/variant columns don't line up
    // with the real variant anyway). The importer keys retail variants off the
    // unit-record byte 6 (§4, `TdtTenant.variant`), which the tenant parser
    // already captures.
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
    // `topFloor`/`bottomFloor` join the checked fields now that the payload size
    // is derived from the span: an INVERTED or out-of-range pair would size the
    // skip below from garbage. A zero-height shaft is NOT rejected here (its
    // one-floor payload is well defined); it decodes and is dropped later as
    // degenerate geometry, exactly as before this change.
    if (used !== 1 || type > 2 || cars < 1 || cars > 8 || topFloor < bottomFloor || topFloor >= TDT_FLOOR_COUNT) {
      // The entry doesn't parse as documented; the payload size below would
      // be a guess, and every later slot would misalign. Bail to synthesis:
      // the same posture this reader already took for a bad type or car count,
      // and safer than skipping a guessed distance into the middle of a record.
      warnings.push("The elevator table doesn't match the documented layout, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.");
      return tail;
    }
    // Built shafts append live passenger/queue state we deliberately skip: our
    // crowd re-simulates. The size comes from the shared helper, which the
    // writer and the test fixture use too, so the three cannot drift apart (see
    // builtShaftPayloadSize). The guard above already rejected the only input it
    // refuses, so it cannot throw here.
    const payload = builtShaftPayloadSize(bottomFloor, topFloor);
    // LEGACY FALLBACK. Verticopolis 2.9.0 and earlier wrote one per-floor entry
    // per SERVICED floor rather than per spanned floor (that was the bug this
    // reader's rule fixed). The retail game always writes the spanned layout, so
    // spanned stays the default, but a `.TDT` OUR older builds exported with a
    // skip-floor shaft is shorter, and skipping the spanned distance walks past
    // the next slot into zeros, where `used === 0` reads as an empty slot and
    // every later shaft disappears with nothing to warn about. The two sizes are
    // identical unless the shaft skips a floor, so this only ever engages on the
    // files that need it: when they differ, take whichever landing actually
    // looks like the next slot.
    let servicedCount = 0;
    for (let i = 0; i < serviced.length; i++) if (serviced[i] !== 0) servicedCount++;
    let chosen = payload;
    if (servicedCount !== topFloor - bottomFloor + 1 && servicedCount >= 1) {
      const legacy = builtShaftPayloadSize(1, servicedCount); // same shape, serviced-floor count
      // Spanned stays the default and only loses to a STRICTLY better landing,
      // so a file written the documented way is never re-read as a legacy one.
      if (slotStartScore(r, legacy) > slotStartScore(r, payload)) chosen = legacy;
    }
    if (r.remaining() < chosen) {
      warnings.push("The elevator table is cut short, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.");
      return tail;
    }
    r.skip(chosen);
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
