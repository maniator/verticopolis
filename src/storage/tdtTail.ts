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
  builtShaftPayloadSizeFor,
  TDT_FINANCE_SIZE,
  TDT_FLOOR_COUNT,
  TDT_MAX_PEOPLE,
  TDT_PARKING_SIZE,
  TDT_PERSON_RECORD_SIZE,
  TDT_RETAIL_RECORD_SIZE,
  TDT_RETAIL_SLOTS,
  TDT_STAIR_RECORD_SIZE,
  TDT_STAMP_GENERATION,
  TDT_STAIR_SLOTS,
} from "./tdtConstants";
import type { TdtElevator, TdtTail } from "./tdtTypes";
import { emptySlotsInGap, findNextHeader, MAX_BUILT_PAYLOAD, MIN_BUILT_PAYLOAD } from "./tdtElevatorResync";
import { locateStairs, routingTailStartsAt, stairsTableStartsAt } from "./tdtStairs";
import { stampedGeneration } from "./tdtStamp";

export { locateStairs };

/**
 * How a built elevator slot's payload is sized. Three writers have to be read:
 *
 * - `expressServiced`: an express shaft sized by the floors it STOPS at, every
 *   other kind by the floors it spans. What the retail game writes (measured;
 *   see {@link builtShaftPayloadSizeFor}), so it leads for an UNSTAMPED file.
 * - `spanned`: every kind sized by spanned floors. What OUR writer emits and
 *   what a stamped file is read with. Also the longest walk, which is why it is
 *   preferred when nothing is corroborated: overshooting bails loudly.
 * - `serviced`: every kind sized by stops. Verticopolis 2.9.0 and earlier.
 *
 * All three agree on a shaft that stops at every floor it passes, which is every
 * standard and service shaft in practice, so only a file with a skip-stopping
 * shaft can be ambiguous at all, and an express is the kind that always skips.
 */
type PayloadLayout = "expressServiced" | "spanned" | "serviced";

/**
 * Stops recorded in a slot's 120-byte serviced bitmap, counting only floors the
 * shaft actually spans.
 *
 * The clamp guards a measured hazard whose sizing side is still unmeasured:
 * game re-saves DO carry stray set bits outside a shaft's span (a standard
 * shaft at floors 54..69 carried 2, harness 2026-08-04), while the one express
 * measured so far has none, so whether the game's own sizing counts strays is
 * unknown. Counting one would size the payload a full entry long and land the
 * walk mid-record; counting only what the shaft spans cannot err that way.
 */
function stopCount(serviced: Uint8Array, bottomFloor: number, topFloor: number): number {
  let stops = 0;
  const from = Math.max(0, bottomFloor);
  const to = Math.min(serviced.length - 1, topFloor);
  for (let i = from; i <= to; i++) if (serviced[i] !== 0) stops++;
  return stops;
}

/** One built slot's payload size under `layout`. */
function payloadSize(
  layout: PayloadLayout,
  type: number,
  bottomFloor: number,
  topFloor: number,
  serviced: Uint8Array,
): number {
  if (layout === "expressServiced") {
    return builtShaftPayloadSizeFor(type, bottomFloor, topFloor, stopCount(serviced, bottomFloor, topFloor));
  }
  if (layout === "spanned") return builtShaftPayloadSize(bottomFloor, topFloor);
  return builtShaftPayloadSize(1, Math.max(1, stopCount(serviced, bottomFloor, topFloor))); // same shape, stop count
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
const RESYNCED =
  "Some of the save's elevators are stored in a layout we don't fully understand, so their shafts were found by searching the file. Check that your elevators look right.";
const NOT_DOCUMENTED =
  "The elevator table doesn't match the documented layout, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.";

/**
 * Walk the 24-slot elevator table, sizing built payloads per `layout`. With
 * `resync`, a header that does not parse after a built slot is not the end of
 * the walk: the previous shaft's payload was sized wrong, so the next plausible
 * header is searched for past that shaft's smallest possible payload and the
 * walk goes on from there.
 */
function readElevatorTable(r: ByteReader, layout: PayloadLayout, resync = false): TableWalk {
  r.enterBlock("elevator table");
  const elevators: TdtElevator[] = [];
  let prevHeader = -1;
  let slotAfterPrev = 0;
  for (let slot = 0; slot < TDT_ELEVATOR_SLOTS; ) {
    if (r.remaining() < TDT_ELEVATOR_HEADER_SIZE) return { elevators: null, warning: CUT_SHORT, end: r.offset() };
    const headerAt = r.offset();
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
    if (used === 0) {
      slot++; // empty slot: header only, no payload
      continue;
    }
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
      if (resync && prevHeader >= 0) {
        // The next shaft starts after this one's smallest possible payload and no
        // later than its largest (a whole-tower span).
        const afterHeader = prevHeader + TDT_ELEVATOR_HEADER_SIZE;
        // The stretch up to a header is the previous shaft's payload (whole floors)
        // and any empty slots between the two. Only one count of empty slots makes
        // that add up, so a header that leaves none is not the next slot.
        const found = findNextHeader(
          r.raw(),
          afterHeader + MIN_BUILT_PAYLOAD,
          afterHeader + MAX_BUILT_PAYLOAD,
          (o) => emptySlotsInGap(o - prevHeader, slotAfterPrev) >= 0,
        );
        if (found >= 0) {
          slot = slotAfterPrev + emptySlotsInGap(found - prevHeader, slotAfterPrev);
          r.seek(found); // read this slot again from the shaft's real header
          continue;
        }
      }
      return { elevators: null, warning: NOT_DOCUMENTED, end: r.offset() };
    }
    // Built shafts append live passenger/queue state we deliberately skip: our
    // crowd re-simulates.
    const payload = payloadSize(layout, type, bottomFloor, topFloor, serviced);
    if (r.remaining() < payload) return { elevators: null, warning: CUT_SHORT, end: r.offset() };
    r.skip(payload);
    prevHeader = headerAt;
    slot++;
    slotAfterPrev = slot;
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
 * Every file without a skip-stopping shaft reads the same under all three layouts,
 * so there is nothing to decide there. When a file does have one, each layout is
 * walked and the first whose table END is followed by a readable tail wins: the
 * stairs table has a strong 64-record signature, so finding flights from one end
 * offset and not another is real evidence. A file that corroborates none falls
 * back to `spanned`, the longest walk, whose wrong guess fails loudly.
 */
function chooseLayout(bytes: Uint8Array, tableStart: number): PayloadLayout {
  // A file stamped with a generation we KNOW states its writer, so there is
  // nothing to deduce. Only known ones count. A generation this reader has
  // never heard of comes from a build newer than itself, and the trailer exists
  // precisely BECAUSE a later writer may lay bytes out differently, so treating
  // an unknown one as "current" would assert the one thing it cannot know. A
  // garbled trailer lands in the same bucket. Both fall through to the
  // structural reasoning below, exactly as an unstamped file does, so a stamp
  // can only ever help. A future generation adds its case here.
  switch (stampedGeneration(bytes)) {
    case TDT_STAMP_GENERATION:
      return "spanned"; // our own writer, which spans every kind including express
    default:
      break; // unstamped, or a generation this reader does not know
  }
  const walk = (layout: PayloadLayout): TableWalk => {
    const r = new ByteReader(bytes);
    r.skip(tableStart);
    return readElevatorTable(r, layout);
  };
  const current = walk("expressServiced");
  // A shaft that stops at every floor it passes sizes the same under all three
  // layouts, so a file with only those has nothing to choose and pays nothing.
  //
  // ZERO stops is NOT such a shaft: the stop-based layouts floor it at a single
  // entry (see builtShaftPayloadSizeFor) while `spanned` sizes it by the whole
  // span, so they disagree most exactly there. It earns its answer below.
  const ambiguous = (current.elevators ?? []).some(
    (e) => stopCount(e.serviced, e.bottomFloor, e.topFloor) !== e.topFloor - e.bottomFloor + 1,
  );
  if (current.elevators !== null && !ambiguous) return "expressServiced";
  // ONE rule decides it: the legacy layout is taken only when the file itself
  // corroborates it, by placing a structure we know the old writer's position
  // for exactly where that walk's table would have ended. Two such markers,
  // both keyed off our own writer's fixed block sizes: the stairs table starts
  // finance + parking past the end, and the 0xFF routing region starts one
  // stairs table further on. The second carries what the first cannot, a tower
  // with NO stairways, whose 64 empty records say nothing.
  //
  // Requiring evidence rather than merely preferring one layout is what makes
  // this safe. Every weaker rule tried here let some file through wrongly: a
  // per-slot landing check cannot see past the last built shaft; "more shafts
  // decoded" reads a truncated file as legacy, because the short walk takes the
  // zero fill for empty headers and finishes where the honest walk correctly
  // gave up; and a stairs flight COUNT cannot separate ends that differ by less
  // than the scan window.
  //
  // A file that corroborates NOTHING falls back to `spanned`, and which layout
  // that is matters more than it looks. `spanned` is the LONGEST walk, so
  // guessing it wrongly runs off the end of the file and bails with a warning,
  // where guessing a shorter one wrongly under-skips, reads the zero fill as
  // empty slot headers, and returns a table that is not there with nothing said.
  // A loud wrong answer the player can see beats a silent one, so the fallback
  // is the layout that fails loudly, not the one this build writes.
  //
  // Both markers are the same question asked of a different structure: does
  // something whose position under the old writer we know exactly sit where
  // this walk's table would put it? Each is a STRUCTURE, deliberately. Using
  // the file's end as a third marker was tried, to reach exports older than
  // v1.14.0 (which stopped after the stairs table instead of writing the
  // routing region), and it had to be withdrawn: a CURRENT file truncated at
  // exactly the shorter walk's end plus finance, parking and stairs is
  // byte-identical to such an export when both regions are zeros, which they
  // are for a stairless tower with no connected stalls. Nothing can tell those
  // two apart, so an EOF anchor cannot help the old file without silently
  // mis-reading the damaged one, and a silent wrong answer is the worse of the
  // two. A pre-v1.14.0 stairless export therefore corroborates nothing, fails to
  // walk under whichever layout the fallback picks, and reaches the player as
  // synthesized transports WITH a warning. See the backlog's `tdt-legacy-pre-tail-import`.
  const anchored = (end: number) => {
    const afterParking = end + TDT_FINANCE_SIZE + TDT_PARKING_SIZE;
    return (
      stairsTableStartsAt(bytes, afterParking) ||
      routingTailStartsAt(bytes, afterParking + TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE)
    );
  };
  // Every layout is put to the same question, newest first: did this walk COMPLETE,
  // and does a structure we know the position of sit exactly where it ends? The
  // first to answer yes wins. Completion is checked for each candidate, not just
  // the alternates: a walk that gave up mid-table has an `end` that means nothing,
  // and letting it anchor by coincidence would return the layout that just failed.
  const walks = {
    expressServiced: current,
    spanned: walk("spanned"),
    serviced: walk("serviced"),
  } as const;
  for (const layout of ["expressServiced", "spanned", "serviced"] as const) {
    const w = walks[layout];
    if (w.elevators !== null && anchored(w.end)) return layout;
  }
  // Nothing corroborated: take the LONGEST walk that still COMPLETES. Both
  // halves carry weight. Longest, because overshooting runs off the end and
  // bails with a warning while undershooting reads zero fill as empty headers
  // and returns a table that is not there; with no evidence, the failure the
  // player can see beats the one they cannot. Only if it completes, because
  // `spanned` is OUR layout and the files with no anchor to offer are mostly the
  // 1994 game's, whose tail sits where our anchors are not keyed (a real save
  // put its stairs 436 bytes before our block sizes predict). Handing those the
  // one layout that cannot read them is the bug this started from, and
  // over-skipping is what makes such a file fail to walk, so "did the longer
  // walk survive" separates the two cases.
  return walks.spanned.elevators !== null ? "spanned" : "expressServiced";
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
  // per slot. See `readElevatorTable` for the three layouts and `chooseLayout` for
  // how they are told apart.
  // The layout is chosen for the whole file, and `chooseLayout` only answers
  // "serviced" when the file corroborates it, so there is no second-chance
  // retry of a SHORTER layout. A retry that accepted the shorter walk merely
  // because the documented one failed would take a TRUNCATED current-layout file
  // for a legacy one: the short walk reads the zero fill as the remaining empty
  // headers and finishes where the honest walk correctly gave up, turning a
  // clean bail into a silent, wrong table with no parking and no stairs.
  // The one retry below is a different kind: it keeps the chosen layout and
  // runs only when a header after a built shaft fails to parse, then accepts
  // a header only where its whole shape fits (see `tdtElevatorResync.ts`), so a
  // truncated file, which fails on size and not on a header, never reaches it.
  const tableStart = r.offset();
  const reader = r;
  const layout = chooseLayout(r.raw(), tableStart);
  let table = readElevatorTable(reader, layout);
  if (table.elevators === null && table.warning === NOT_DOCUMENTED) {
    // Some real saves size a shaft's payload by a rule none of the three layouts
    // has (a 100-floor tower's express shafts, measured on a 1997 save). Walk
    // again, finding each header by its shape.
    reader.seek(tableStart);
    const retry = readElevatorTable(reader, layout, true);
    if (retry.elevators !== null) {
      warnings.push(RESYNCED);
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
    } else {
      // The finance block fit but the parking block does not: the file stops in
      // between. Leaving `parkingConnected` null without saying so reports "no
      // parking data" in the same voice as a tower that genuinely has none.
      warnings.push("The save ends inside its parking data, so the connected-stall count could not be read.");
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
