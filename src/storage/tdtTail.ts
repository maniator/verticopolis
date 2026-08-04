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
 * Could a stairs table start EXACTLY at `at`? Every one of its 64 records must
 * read as a stair record, and at least one must be built.
 *
 * Note this is deliberately not "where did locateStairs find the table": that
 * scan takes the EARLIEST window holding the most built flights, and since an
 * all-zero record is a valid empty slot, a sparse table's window can begin up to
 * 63 records before its true start. Fine for reading the flights, useless as an
 * alignment marker, which is what the payload-layout choice needs.
 */
export function stairsTableStartsAt(bytes: Uint8Array, at: number): boolean {
  const REC = TDT_STAIR_RECORD_SIZE;
  if (at < 0 || at + REC > bytes.length) return false;
  let built = 0;
  for (let s = 0; s < TDT_STAIR_SLOTS; s++) {
    const o = at + s * REC;
    if (o + REC > bytes.length) break; // table runs to EOF; later slots absent
    const c = classifyStairRecord(bytes, o);
    if (c < 0) return false;
    built += c;
  }
  return built > 0;
}

/**
 * How a built elevator slot's payload is sized.
 *
 * `spanned` is the documented layout and what the retail game writes: one
 * per-floor entry for every floor the shaft passes. `serviced` is what
 * Verticopolis 2.9.0 and earlier wrote, one entry per floor it STOPS at. The two
 * are identical unless a shaft skips a floor, so only files with a skip-floor
 * shaft can be ambiguous at all.
 */
type PayloadLayout = "spanned" | "serviced";

/** One built slot's payload size under `layout`. */
function payloadSize(layout: PayloadLayout, bottomFloor: number, topFloor: number, serviced: Uint8Array): number {
  if (layout === "spanned") return builtShaftPayloadSize(bottomFloor, topFloor);
  let stops = 0;
  for (let i = 0; i < serviced.length; i++) if (serviced[i] !== 0) stops++;
  return builtShaftPayloadSize(1, Math.max(1, stops)); // same shape, stop count
}

/** Result of walking the 24-slot elevator table with one layout. `elevators` is
 *  null when the walk could not complete, with `warning` saying why. */
interface TableWalk {
  elevators: TdtElevator[] | null;
  warning?: string;
  /** Offset just past the table, for the tail that follows it. */
  end: number;
}

const CUT_SHORT =
  "The elevator table is cut short, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.";
const NOT_DOCUMENTED =
  "The elevator table doesn't match the documented layout, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.";

/** Walk the 24-slot elevator table, sizing built payloads per `layout`. */
function readElevatorTable(r: ByteReader, layout: PayloadLayout): TableWalk {
  r.enterBlock("elevator table");
  const elevators: TdtElevator[] = [];
  for (let slot = 0; slot < TDT_ELEVATOR_SLOTS; slot++) {
    if (r.remaining() < TDT_ELEVATOR_HEADER_SIZE) return { elevators: null, warning: CUT_SHORT, end: r.offset() };
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
    // `topFloor`/`bottomFloor` join the checked fields because the payload size
    // is derived from the span: an INVERTED or out-of-range pair would size the
    // skip below from garbage. A zero-height shaft is NOT rejected here (its
    // one-floor payload is well defined); it decodes and is dropped later as
    // degenerate geometry.
    if (used !== 1 || type > 2 || cars < 1 || cars > 8 || topFloor < bottomFloor || topFloor >= TDT_FLOOR_COUNT) {
      // The entry doesn't parse as documented; the payload size would be a
      // guess, and every later slot would misalign. Bail to synthesis: the same
      // posture this reader takes for a bad type or car count, and safer than
      // skipping a guessed distance into the middle of a record.
      return { elevators: null, warning: NOT_DOCUMENTED, end: r.offset() };
    }
    // Built shafts append live passenger/queue state we deliberately skip: our
    // crowd re-simulates.
    const payload = payloadSize(layout, bottomFloor, topFloor, serviced);
    if (r.remaining() < payload) return { elevators: null, warning: CUT_SHORT, end: r.offset() };
    r.skip(payload);
    elevators.push({ type, capacity, cars, x, topFloor, bottomFloor, serviced, carHomes });
  }
  return { elevators, end: r.offset() };
}

/**
 * Which payload layout does this file use?
 *
 * Decided ONCE for the whole file rather than per slot. A per-slot choice looks
 * appealing (each shaft carries its own stop bitmap) but cannot settle the case
 * that matters: when the skip-floor shaft is the last built one, both candidate
 * landings fall in zero fill and look identical, and picking wrong there shifts
 * everything AFTER the table, losing the parking count and, when the shift
 * exceeds the stairs scan window, the stairways too.
 *
 * `spanned` is the default and the answer for every file without a skip-floor
 * shaft, since the layouts coincide there. When a file does have one, both walks
 * run and the one whose table END is followed by a readable tail wins: the
 * stairs table has a strong 64-record signature, so finding flights from one end
 * offset and not the other is real evidence. Ties keep `spanned`, so a file
 * written the documented way is never re-read as a legacy one.
 */
function chooseLayout(bytes: Uint8Array, tableStart: number): PayloadLayout {
  const walk = (layout: PayloadLayout): TableWalk => {
    const r = new ByteReader(bytes);
    r.skip(tableStart);
    return readElevatorTable(r, layout);
  };
  const spanned = walk("spanned");
  // No skip-floor shaft means no ambiguity: the two layouts size every payload
  // identically, so there is nothing to choose and nothing to pay for.
  const ambiguous = (spanned.elevators ?? []).some((e) => {
    let stops = 0;
    for (let i = 0; i < e.serviced.length; i++) if (e.serviced[i] !== 0) stops++;
    return stops >= 1 && stops !== e.topFloor - e.bottomFloor + 1;
  });
  if (spanned.elevators !== null && !ambiguous) return "spanned";
  const serviced = walk("serviced");
  if (serviced.elevators === null) return "spanned";
  if (spanned.elevators === null) return "serviced";
  // More shafts decoded is the strongest signal, since a wrong size swallows the
  // ones that follow it.
  if (serviced.elevators.length !== spanned.elevators.length) {
    return serviced.elevators.length > spanned.elevators.length ? "serviced" : "spanned";
  }
  // Otherwise anchor on WHERE the stairs table starts, not merely on finding
  // one. A legacy file is by definition one WE wrote, and our writer puts the
  // finance and parking blocks between the elevator table and the stairs at
  // known sizes, so the correct end is exactly that far ahead of the stairs. A
  // flight COUNT cannot separate the candidates when they differ by less than
  // the scan window (a shaft skipping 1-3 floors moves the end by only 324-972
  // bytes, so both scans find the same table), and the loser then reads the
  // parking count out of zero fill.
  const anchored = (end: number) => stairsTableStartsAt(bytes, end + TDT_FINANCE_SIZE + TDT_PARKING_SIZE);
  const spannedAnchored = anchored(spanned.end);
  const servicedAnchored = anchored(serviced.end);
  if (spannedAnchored !== servicedAnchored) return servicedAnchored ? "serviced" : "spanned";
  // Neither anchors (a game-written save, whose block sizes between the table
  // and the stairs are not fixed): fall back to which end finds a table at all,
  // then to the documented layout.
  const flights = (end: number) => locateStairs(bytes, end).length;
  return flights(serviced.end) > flights(spanned.end) ? "serviced" : "spanned";
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
  // The elevator table is walked with a LAYOUT chosen for the whole file, not
  // per slot. See `readElevatorTable` for the two layouts and `chooseLayout` for
  // how they are told apart.
  const tableStart = r.offset();
  const chosen = chooseLayout(r.raw(), tableStart);
  let reader = r;
  let table = readElevatorTable(reader, chosen);
  if (table.elevators === null && chosen === "spanned") {
    // The documented layout could not be walked at all. Before falling back to
    // synthesized transports, try the legacy one: a file our own older builds
    // wrote can fail this way outright when its shorter payloads run the reader
    // off the end.
    const retryReader = new ByteReader(r.raw());
    retryReader.skip(tableStart);
    const retry = readElevatorTable(retryReader, "serviced");
    if (retry.elevators !== null) {
      reader = retryReader;
      table = retry;
    }
  }
  if (table.elevators === null) {
    warnings.push(table.warning!);
    return tail;
  }
  tail.elevators = table.elevators;
  // The stairs table lives after the finance and parking/lobby blocks, whose
  // sizes we can't yet pin down across saves, so we locate it by signature from
  // here (the end of the elevator table) rather than by summing those blocks.
  const afterElevators = reader.offset();
  r = reader;

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
