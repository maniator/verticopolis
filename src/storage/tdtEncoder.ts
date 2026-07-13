import { FACILITIES, GRID, maxCarsFor, maxSpanFor, transportCarCapacity } from "../engine/facilities";
import { frameForMinuteOfDay } from "../engine/timePacing";
import type { FacilityKind, SerializedGame } from "../engine/types";
import { ByteWriter } from "./tdtByteWriter";
import {
  TDT_DEFAULT_VIEW_X,
  TDT_DEFAULT_VIEW_Y,
  TDT_ELEVATOR_BUILT_FIXED,
  TDT_ELEVATOR_HEADER_SIZE,
  TDT_ELEVATOR_CAR_BLOCK_SIZE,
  TDT_ELEVATOR_PER_FLOOR_SIZE,
  TDT_ELEVATOR_SCHEDULE_DEFAULT,
  TDT_ELEVATOR_SLOTS,
  TDT_FINANCE_SIZE,
  TDT_FLOOR_COUNT,
  TDT_FLOOR_INDEX_ENTRIES,
  TDT_FLOOR_OFFSET,
  TDT_HEADER_SIZE,
  TDT_MAGIC,
  TDT_MAX_CENSUS,
  TDT_MAX_TENANTS_PER_FLOOR,
  TDT_PARKING_SIZE,
  TDT_PERSON_RECORD_SIZE,
  TDT_RETAIL_RECORD_SIZE,
  TDT_RETAIL_SLOTS,
  TDT_ROUTING_TAIL_SIZE,
  TDT_STAIR_RECORD_SIZE,
  TDT_STAIR_SLOTS,
} from "./tdtConstants";
import { viewWordsFromView } from "./tdtViewMapping";
import { ELEVATOR_KINDS } from "./tdtTables";
import { LegacyExportError } from "./tdtExportTables";
import type { GatheredTower } from "./tdtExportGather";

/**
 * The encode pass of the `.TDT` export: turn the {@link GatheredTower} into the
 * binary layout (doc §1-§11) via a {@link ByteWriter}, and return the transport
 * loss/collision stats the report needs. Extracted from `tdtExport.ts`.
 */

/** Numbers the report reads from the encode pass (header money/star + the
 *  transport drops the encoder computed while writing the tables). */
export interface EncodeStats {
  balance: number;
  money: number;
  star: number;
  shaftsDropped: number;
  shaftsColliding: number;
  flightsDropped: number;
  transportsDropped: number;
  /** Elevator/walkway counts BEFORE the table caps, for the report's tallies. */
  elevatorsLen: number;
  walkwaysLen: number;
}

export interface EncodeResult {
  bytes: Uint8Array;
  stats: EncodeStats;
}

export function encodeTower(save: SerializedGame, gathered: GatheredTower): EncodeResult {
  const { tenantsByTdt, extents, header, hasGroundLobby, peoplePop, counts, retailRows, rooms } = gathered;

  // A floor whose tenant count exceeds what the format (and our own parser's
  // hostile-file cap) allows cannot be represented; refuse rather than emit a
  // file that every reader rejects. Unreachable from live play (rooms are at
  // least 4 tiles wide on a 375-tile lot); only forged saves get here.
  for (const [, tenants] of tenantsByTdt) {
    // Same boundary as the reader (which rejects strictly greater): a floor
    // AT the ceiling is still parseable and must export.
    if (tenants.length > TDT_MAX_TENANTS_PER_FLOOR) {
      throw new LegacyExportError(
        "One floor holds more rooms than a SimTower (1994) save can carry.",
      );
    }
  }

  // ---- Encode ---------------------------------------------------------------
  const w = new ByteWriter();

  // Header (doc §1). The undocumented region is zero-filled; whether the real
  // game needs anything there is the recorded real-game validation risk.
  // Guard non-finite money and star (deserialize doesn't harden them yet;
  // see the backlog's deserialize-coercion row): NaN through a clamp would
  // write 0 to the file while the modal showed the raw garbage. One
  // sanitized value feeds BOTH the header and the report, so the modal can
  // never claim a rating the bytes don't carry.
  const money = Number.isFinite(save.money) ? save.money : 0;
  const balance = Math.max(-0x80000000, Math.min(0x7fffffff, Math.round(money / 100)));
  // Balance entering the current quarter (finance-window "Last Quarter's
  // Balance"). Absent on legacy saves and fresh towers, which write 0. Same
  // /100 scale + i32 clamp as `balance`.
  const lastQuarterRaw = Number.isFinite(save.lastQuarterMoney) ? (save.lastQuarterMoney as number) : 0;
  const lastQuarterMoney = Math.max(-0x80000000, Math.min(0x7fffffff, Math.round(lastQuarterRaw / 100)));
  const star = Number.isFinite(save.star) ? Math.max(1, Math.min(6, Math.round(save.star))) : 1;
  const minuteOfDay = ((save.minutes % 1440) + 1440) % 1440;
  w.u16(TDT_MAGIC);
  w.u16(star);
  w.i32(balance);
  w.i32(0); // otherIncome
  w.i32(0); // constructionCosts
  w.i32(lastQuarterMoney); // 0x10
  w.u16(frameForMinuteOfDay(minuteOfDay));
  w.i32(Math.max(0, Math.floor(save.minutes / 1440)));
  w.pad(TDT_HEADER_SIZE - w.length);

  // Backfill the header aggregate counts (doc §1) at their fixed offsets in the
  // now-zero-padded header. The 1994 game reads these directly for advisories
  // (e.g. the recycling nag) rather than recomputing from the floor map, so a
  // zero here misreports the tower. Clamp to the canon caps.
  w.setU16(0x1c, hasGroundLobby ? 1 : 0); // lobbyHeight: 0 with no ground lobby, else 1 (canon is 1–3; we model single-story lobbies)
  // recycling + hallCinema have no canon count cap (unlike security/parking), but
  // still clamp to the u16 ceiling so a forged/huge tower can't wrap the field to
  // a small value (setU16 masks, it doesn't clamp), consistent with the
  // sibling counts and the people census.
  w.setU16(0x2a, Math.min(header.recycling, 0xffff)); // recyclingCount
  w.setU16(0x2e, Math.min(header.commercial, 512)); // commercialCount (one retail unit per slot, so <=512)
  w.setU16(0x30, Math.min(header.security, 10)); // securityCount (canon max 10)
  w.setU16(0x32, Math.min(counts.parkingStalls, 512)); // parkingStallCount (max 512 stalls)
  w.setU16(0x36, Math.min(header.hallCinema, 0xffff)); // hallCinemaCount (party halls + cinemas)
  // Saved view-scroll position (0x26 = x, 0x28 = y, world pixels). Left at 0 the
  // game opens a loaded tower at the top-left sky. When the save carries the
  // player's view, write THAT (mapped to 1994 world px), so the exported tower
  // opens where they were standing; otherwise fall back to the game's own New
  // Tower default, which opens on the ground lobby, the tower's entrance.
  const viewWords = save.view
    ? viewWordsFromView(save.view)
    : { x: TDT_DEFAULT_VIEW_X, y: TDT_DEFAULT_VIEW_Y };
  w.setU16(0x26, viewWords.x);
  w.setU16(0x28, viewWords.y);

  // Floor map: 120 records (doc §4). Reserved rows 110–119 stay empty, even
  // when an out-of-range (skipped) room widened an extent up there.
  for (let index = 0; index < TDT_FLOOR_COUNT; index++) {
    const ours = index - TDT_FLOOR_OFFSET;
    const tenants = tenantsByTdt.get(index) ?? [];
    const ext = ours <= GRID.maxFloor ? extents.get(ours) : undefined;
    w.u16(tenants.length);
    w.u16(ext?.left ?? 0);
    w.u16(ext?.right ?? 0);
    for (const t of tenants) {
      w.u16(t.left);
      w.u16(t.right);
      w.u8(t.type); // i8 via two's complement
      w.u8(t.status);
      w.pad(10); // reserved bytes 6–15
      w.u8(t.rentClass);
      // Byte 17: canon retail variant (§4 mirror of §7 for shop/fastFood/
      // restaurant), or 0 for non-retail and for a retail unit whose subtype
      // was never rolled (legacy save loaded pre-feature).
      w.u8(t.subtypeIdx ?? 0);
    }
    w.pad(TDT_FLOOR_INDEX_ENTRIES * 2); // per-floor remap table
  }

  // People block: a u32 count followed by that many 16-byte records. The crowd
  // re-simulates on load, so the records are zero-filled (no live positions to
  // invent), but the COUNT must be nonzero for a populated tower or the 1994
  // game faults reading this block (an empty tower loads fine at 0; both
  // confirmed against the game via the SimTower harness). We write the tower's
  // resident/worker/customer census (offices, condos, hotels, and commercial
  // venues when present), clamped to the canon maximum so a forged save can't
  // bloat the file. See TDT_ROUTING_TAIL_SIZE for the companion trailing-region
  // fix that lets the whole file reach the length the game reads.
  // The floor at counts.rooms prevents a zero census for a tower that has rooms
  // but all commercial venues are vacant/construction (finitePop = 0 then), which
  // would fault like an empty people block. An empty tower stays at 0.
  const finitePop = Number.isFinite(peoplePop) ? Math.round(peoplePop) : 0;
  const peopleCount = Math.max(0, Math.min(Math.max(finitePop, counts.rooms), TDT_MAX_CENSUS));
  w.i32(peopleCount);
  w.pad(peopleCount * TDT_PERSON_RECORD_SIZE);

  // Retail table (§7): one row per emitted shop / fastFood / restaurant,
  // remaining slots empty (0xFF floor marker). Byte 0 = floor (TDT-space),
  // byte 1 = status (0 = open), byte 2 = canon variant ordinal. Bytes 3..17
  // stay zero (their canon meaning isn't modeled here).
  for (let slot = 0; slot < TDT_RETAIL_SLOTS; slot++) {
    const row = retailRows[slot];
    if (row === undefined) {
      w.u8(0xff);
      w.pad(TDT_RETAIL_RECORD_SIZE - 1);
    } else {
      w.u8(row.floor & 0xff);
      w.u8(0); // status (0 = open / operating)
      w.u8(row.variant & 0xff);
      w.pad(TDT_RETAIL_RECORD_SIZE - 3);
    }
  }

  // Elevator table: 24 slots (doc §6). Live passenger payloads zero-filled at
  // their documented sizes; kind → type via the importer's ELEVATOR_KINDS
  // order (0 express, 1 standard, 2 service).
  //
  // Transports are sanitized into three buckets first, mirroring the
  // importer's own trimming rules (transportsFromDecoded): the live game
  // never produces bad values, but buildTDT takes any serialized input, and
  // an unclamped coordinate would wrap through the u8/u16 masks into a
  // structurally-valid-but-nonsensical file the report knows nothing about.
  const elevators: { kind: FacilityKind; x: number; bottom: number; top: number; cars: number; carPositions: number[]; skipFloors?: number[] }[] = [];
  const walkways: { kind: FacilityKind; x: number; bottom: number }[] = [];
  let transportsDropped = 0;
  for (const t of save.transports) {
    const width = FACILITIES[t.kind]?.width ?? 0;
    if (t.kind === "stairs" || t.kind === "escalator") {
      // A flight must sit fully inside the buildable range (same guard the
      // importer applies to decoded stair records). Round first, like the
      // elevator path: a fractional floor would silently truncate in u16.
      const bottom = Number.isFinite(t.bottom) ? Math.round(t.bottom) : NaN;
      if (!Number.isFinite(bottom) || bottom < GRID.minFloor || bottom + 1 > GRID.maxFloor) {
        transportsDropped++;
        continue;
      }
      const x = Math.max(0, Math.min(GRID.width - width, Math.round(Number.isFinite(t.x) ? t.x : 0)));
      walkways.push({ kind: t.kind, x, bottom });
      continue;
    }
    if (!ELEVATOR_KINDS.includes(t.kind)) {
      transportsDropped++; // no 1994 equivalent (forged kind)
      continue;
    }
    if (!Number.isFinite(t.bottom) || !Number.isFinite(t.top)) {
      transportsDropped++;
      continue;
    }
    const bottom = Math.max(GRID.minFloor, Math.round(t.bottom));
    let top = Math.min(GRID.maxFloor, Math.round(t.top));
    if (top <= bottom) {
      transportsDropped++; // degenerate or wholly out of range
      continue;
    }
    if (top - bottom > maxSpanFor(t.kind)) top = bottom + maxSpanFor(t.kind);
    const x = Math.max(0, Math.min(GRID.width - width, Math.round(Number.isFinite(t.x) ? t.x : 0)));
    elevators.push({
      kind: t.kind,
      x,
      bottom,
      top,
      cars: t.cars,
      carPositions: t.carPositions ?? [],
      skipFloors: t.skipFloors,
    });
  }
  // The 24-slot table can't hold more (only forged saves exceed the pooled
  // cap); the drop is counted for the report, never silent.
  const shaftsDropped = Math.max(0, elevators.length - TDT_ELEVATOR_SLOTS);
  for (let slot = 0; slot < TDT_ELEVATOR_SLOTS; slot++) {
    const e = elevators[slot];
    // Inverse of the importer's shared ELEVATOR_KINDS order.
    const type = e ? ELEVATOR_KINDS.indexOf(e.kind) : -1;
    if (!e || type < 0) {
      w.pad(TDT_ELEVATOR_HEADER_SIZE); // empty slot: used = 0
      continue;
    }
    // Same clamp the importer applies on read (1..maxCarsFor); an unclamped
    // (or non-finite) count would desync the header byte from the payload
    // size computed below.
    const rawCars = Number.isFinite(e.cars) ? Math.round(e.cars) : 1;
    const cars = Math.max(1, Math.min(maxCarsFor(e.kind), rawCars));
    w.u8(1); // used
    w.u8(type);
    w.u8(transportCarCapacity(e.kind)); // informational; canon 42/21/10
    w.u8(cars);
    // Per-shaft schedule/config block: the game dispatches cars from this; a
    // zero-fill reads as "run no cars" and traps everyone in a shaft with no
    // cars. Emit the game's own built-shaft default so exported shafts run.
    for (const v of TDT_ELEVATOR_SCHEDULE_DEFAULT) w.u8(v);
    w.u8(1); // visible
    w.u8(0); // reserved
    w.u16(e.x);
    w.u8(e.top + TDT_FLOOR_OFFSET);
    w.u8(e.bottom + TDT_FLOOR_OFFSET);
    const skip = new Set(e.skipFloors ?? []);
    let servicedCount = 0;
    for (let fl = 0; fl < TDT_FLOOR_COUNT; fl++) {
      const ours = fl - TDT_FLOOR_OFFSET;
      // Endpoints always stop (the importer reads skip flags for interior
      // floors only), so a degenerate endpoint skip can't poison the map.
      const stops =
        ours >= e.bottom &&
        ours <= e.top &&
        (!skip.has(ours) || ours === e.bottom || ours === e.top);
      w.u8(stops ? 1 : 0);
      if (stops) servicedCount++;
    }
    for (let c = 0; c < 8; c++) {
      const raw = e.carPositions[c];
      const home = Number.isFinite(raw) ? Math.round(raw) : e.bottom;
      w.u8(Math.max(e.bottom, Math.min(e.top, home)) + TDT_FLOOR_OFFSET);
    }
    // The appended built-shaft block is cars-INDEPENDENT: a fixed block, one
    // 324-byte entry per SERVICED floor, then a SINGLE 348-byte car block (NOT
    // one per car). Harness-confirmed against the real 1994 game: writing
    // `cars * 348` overran every multi-car shaft and desynced the retail game's
    // elevator table (only one shaft rendered, and the parking/basement block
    // after it mis-read). Must match walkTolerantTail's skip. See tdtConstants.ts.
    w.pad(TDT_ELEVATOR_BUILT_FIXED + servicedCount * TDT_ELEVATOR_PER_FLOOR_SIZE + TDT_ELEVATOR_CAR_BLOCK_SIZE);
  }

  // Finance history: not modeled; zero-filled at the documented size.
  w.pad(TDT_FINANCE_SIZE);

  // Parking: the connected count is CHAINED stalls only (canon: a space works
  // only when contiguous spaces link it back to a ramp on its floor); a lot
  // full of orphan stalls exports 0, exactly what 1994 could produce itself.
  const connectedStalls = (() => {
    const byFloor = new Map<number, { x: number; w: number; ramp: boolean }[]>();
    for (const u of rooms) {
      if (u.kind !== "parking" && u.kind !== "parkingRamp") continue;
      const arr = byFloor.get(u.floor) ?? [];
      arr.push({ x: u.x, w: u.width, ramp: u.kind === "parkingRamp" });
      byFloor.set(u.floor, arr);
    }
    let connected = 0;
    for (const arr of byFloor.values()) {
      arr.sort((a, b) => a.x - b.x);
      const linked = arr.map((it) => it.ramp);
      // Chains are one-dimensional: two sweeps settle flush adjacency.
      for (let i = 1; i < arr.length; i++) {
        if (!linked[i] && linked[i - 1] && arr[i - 1].x + arr[i - 1].w >= arr[i].x) linked[i] = true;
      }
      for (let i = arr.length - 2; i >= 0; i--) {
        if (!linked[i] && linked[i + 1] && arr[i].x + arr[i].w >= arr[i + 1].x) linked[i] = true;
      }
      for (let i = 0; i < arr.length; i++) if (linked[i] && !arr[i].ramp) connected++;
    }
    return connected;
  })();
  w.u16(Math.min((TDT_PARKING_SIZE - 2) / 2, connectedStalls)); // 512-slot stall table
  w.pad(TDT_PARKING_SIZE - 2);

  // Stairs table: 64 slots (doc §8). Our walkways are one-story flights;
  // exact-footprint stacks collapse into the original's 2- and 3-story
  // variants (types 2/3 and 4/5), remainder as 1-story records.
  const stairRecords: { type: number; x: number; floor: number }[] = [];
  const sorted = [...walkways].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.x - b.x || a.bottom - b.bottom,
  );
  for (let i = 0; i < sorted.length; ) {
    const first = sorted[i];
    let run = 1;
    while (
      i + run < sorted.length &&
      sorted[i + run].kind === first.kind &&
      sorted[i + run].x === first.x &&
      sorted[i + run].bottom === first.bottom + run
    ) {
      run++;
    }
    const isStairs = first.kind === "stairs";
    let base = first.bottom;
    let left = run;
    while (left > 0) {
      const stories = Math.min(3, left);
      // type: 0/1 one-story, 2/3 two-story, 4/5 three-story; odd = stairs.
      const type = (stories - 1) * 2 + (isStairs ? 1 : 0);
      stairRecords.push({ type, x: first.x, floor: base + TDT_FLOOR_OFFSET });
      base += stories;
      left -= stories;
    }
    i += run;
  }
  // Records past the 64-slot table are dropped and COUNTED (a dropped 3-story
  // record is 3 flights); the report never overstates what made the trip.
  let flightsDropped = 0;
  for (let slot = TDT_STAIR_SLOTS; slot < stairRecords.length; slot++) {
    const type = stairRecords[slot].type;
    flightsDropped += type <= 1 ? 1 : type <= 3 ? 2 : 3;
  }
  // The 1994 format has no transport-width field: every exported elevator and
  // walkway reconstructs at the fixed catalog footprint on load. A kept-legacy
  // NARROWER transport (a boxed-in 3-wide standard the v5 migration preserved,
  // or a pre-E1b 4-wide flight) abutting a neighbor therefore round-trips as
  // overlapping rects, and the importer's no-overlap rule drops one. Emulate
  // that rule here (greedy first-kept-wins with the importer's exact-footprint
  // stacked-walkway exemption) so the count matches what a re-import would
  // actually lose. The rects come from the EMITTED tables: the first 24
  // elevator slots and the first 64 COLLAPSED stair records expanded to their
  // story spans. Scanning the raw pre-collapse flight list instead would
  // inspect the wrong set whenever more than 64 flights collapse into fewer
  // records, and the report must describe the bytes actually written.
  interface OutRect {
    x: number;
    w: number;
    bottom: number;
    top: number;
    walkway: boolean;
  }
  const outRects: OutRect[] = [
    ...elevators.slice(0, TDT_ELEVATOR_SLOTS).map((e) => ({
      x: e.x,
      w: FACILITIES[e.kind].width,
      bottom: e.bottom,
      top: e.top,
      walkway: false,
    })),
    ...stairRecords.slice(0, TDT_STAIR_SLOTS).map((s) => {
      const stories = s.type <= 1 ? 1 : s.type <= 3 ? 2 : 3;
      const kind = s.type % 2 === 1 ? "stairs" : "escalator";
      const bottom = s.floor - TDT_FLOOR_OFFSET;
      return { x: s.x, w: FACILITIES[kind].width, bottom, top: bottom + stories, walkway: true };
    }),
  ];
  let shaftsColliding = 0;
  const surviving: OutRect[] = [];
  for (const r of outRects) {
    const clash = surviving.some(
      (p) =>
        r.x < p.x + p.w &&
        p.x < r.x + r.w &&
        r.bottom <= p.top &&
        p.bottom <= r.top &&
        !(r.walkway && p.walkway && r.x === p.x && r.w === p.w && (r.bottom === p.top || r.top === p.bottom)),
    );
    if (clash) shaftsColliding++;
    else surviving.push(r);
  }
  for (let slot = 0; slot < TDT_STAIR_SLOTS; slot++) {
    const s = stairRecords[slot];
    if (!s) {
      w.pad(TDT_STAIR_RECORD_SIZE);
      continue;
    }
    w.u8(1); // built
    w.u8(s.type);
    w.u16(s.x);
    w.u16(s.floor);
    w.u16(0); // people up (live state)
    w.u16(0); // people down
  }

  // Trailing routing/reachability region (doc §11+). The 1994 game reads this
  // fixed-size block after the stairs table; without it the file ends ~25 KB
  // short and the game overruns it on load (page fault 0x0799). Filled with the
  // format's 0xFF empty-slot sentinel so the game rebuilds reachability and the
  // crowd from the floor map rather than reading the fill as live population.
  // See TDT_ROUTING_TAIL_SIZE for the harness evidence and the size caveat.
  w.padFF(TDT_ROUTING_TAIL_SIZE);

  return {
    bytes: w.toBytes(),
    stats: {
      balance,
      money,
      star,
      shaftsDropped,
      shaftsColliding,
      flightsDropped,
      transportsDropped,
      elevatorsLen: elevators.length,
      walkwaysLen: walkways.length,
    },
  };
}
