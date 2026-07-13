import {
  TDT_ELEVATOR_BUILT_FIXED,
  TDT_ELEVATOR_HEADER_SIZE,
  TDT_ELEVATOR_CAR_BLOCK_SIZE,
  TDT_ELEVATOR_PER_FLOOR_SIZE,
  TDT_ELEVATOR_SLOTS,
  TDT_FINANCE_SIZE,
  TDT_FLOOR_COUNT,
  TDT_FLOOR_INDEX_ENTRIES,
  TDT_HEADER_SIZE,
  TDT_MAGIC,
  TDT_PARKING_SIZE,
  TDT_PERSON_RECORD_SIZE,
  TDT_RETAIL_RECORD_SIZE,
  TDT_RETAIL_SLOTS,
  TDT_STAIR_RECORD_SIZE,
  TDT_STAIR_SLOTS,
} from "../../storage/tdtFormat";

/**
 * Declarative synthetic `.TDT` byte-buffer builder for the importer tests.
 *
 * Layout facts come from `docs/canon/tdt-format.md`; the same single source
 * of truth the parser reads; so the fixture and the parser can only drift if
 * the doc does. Every buffer is synthesized from scratch: NEVER commit bytes
 * from a real (copyrighted) SimTower save.
 */

export interface TenantSpec {
  /** Extents in tiles (half-open), exactly as stored. */
  left: number;
  right: number;
  /** Tenant type ID (doc §5); negative ⇒ under construction. */
  type: number;
  /** Status/flags byte (bit-mapped for hotels; nonzero ⇒ tenanted). */
  status?: number;
  /** Rent/lease byte at offset 16 (0 Very Low … 3 High, 4 No Rate). */
  rentRate?: number;
  /** Retail variant ordinal, written at byte 6 (where the real game stores it). */
  subtype?: number;
  /** Decoy value for the old (wrong) variant offset, byte 17. Lets a test prove
   *  the importer reads byte 6 and ignores byte 17. Defaults to 0 (like a real save). */
  byte17?: number;
}

export interface FloorSpec {
  /** TDT floor index 0–119. */
  index: number;
  /** Built extent (defaults to hugging the tenants, or 0/0 when none). */
  leftEdge?: number;
  rightEdge?: number;
  tenants?: TenantSpec[];
  /** Override the record's tenant-count word (for forging absurd counts). */
  forgeTenantCount?: number;
}

export interface ElevatorSpec {
  /** 0 = express, 1 = standard, 2 = service. */
  type: 0 | 1 | 2;
  /** Cars in the shaft, 1–8. */
  cars: number;
  /** Horizontal position in tiles. */
  x: number;
  /** TDT floor indexes (0–119). */
  bottomFloor: number;
  topFloor: number;
  /** TDT floor indexes the shaft stops at. Defaults to every floor in
   *  [bottomFloor, topFloor]. */
  serviced?: number[];
  /** Home floor (TDT index) per car; defaults to bottomFloor. */
  carHomes?: number[];
}

export interface StairSpec {
  /** 0 = escalator, 1 = stairs; 2/3 = two-story, 4/5 = three-story. */
  type: number;
  /** Left tile. */
  x: number;
  /** Base floor (TDT index). */
  floor: number;
}

export interface TdtSpec {
  level?: number;
  /** Stored funds (display dollars ÷ 100). Signed. */
  balance?: number;
  frameTime?: number;
  currentDay?: number;
  /** Saved view-scroll words at 0x26/0x28 (doc §1); default 0/0 = no view. */
  viewX?: number;
  viewY?: number;
  floors?: FloorSpec[];
  /** People records appended to the tail (default 0). */
  peopleCount?: number;
  /** Write the 512-slot retail table into the tail (default true). */
  includeRetail?: boolean;
  /** Occupied retail rows to mark (floor ≥ 0), capped at the slot count. */
  retailRows?: number;
  /** Write the elevator/finance/parking/stairs blocks (default true).
   *  false truncates the tail after the retail table; the importer then
   *  falls back to synthesizing a transport layout. */
  includeTransports?: boolean;
  elevators?: ElevatorSpec[];
  stairs?: StairSpec[];
  /** The parking block's connected-stall count (default 0). */
  parkingConnected?: number;
  /** Wrong magic / truncation knobs for the hostile-file tests. */
  magic?: number;
  truncateAt?: number;
}

/** Build a complete synthetic `.TDT` byte buffer from the spec. */
export function buildTdt(spec: TdtSpec = {}): Uint8Array {
  const floorsByIndex = new Map<number, FloorSpec>();
  for (const f of spec.floors ?? []) floorsByIndex.set(f.index, f);

  const chunks: number[] = [];
  const u8 = (v: number) => chunks.push(v & 0xff);
  const u16 = (v: number) => {
    chunks.push(v & 0xff, (v >> 8) & 0xff);
  };
  const i32 = (v: number) => {
    chunks.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  };
  const pad = (n: number) => {
    for (let i = 0; i < n; i++) chunks.push(0);
  };

  // ---- Header (fixed offsets, doc §1) -------------------------------------
  u16(spec.magic ?? TDT_MAGIC); // 0x00 magic
  u16(spec.level ?? 1); // 0x02 level
  i32(spec.balance ?? 20000); // 0x04 balance (stored ×1/100)
  i32(0); // 0x08 otherIncome
  i32(0); // 0x0C constructionCosts
  i32(0); // 0x10 lastQuarterMoney
  u16(spec.frameTime ?? 0); // 0x14 tick
  i32(spec.currentDay ?? 0); // 0x16 currentDay
  pad(0x26 - chunks.length); // lobbyHeight + undocumented words up to the view
  u16(spec.viewX ?? 0); // 0x26 saved view-scroll X
  u16(spec.viewY ?? 0); // 0x28 saved view-scroll Y
  pad(TDT_HEADER_SIZE - chunks.length); // remaining documented counts + undocumented block

  // ---- Floor map: 120 records ---------------------------------------------
  for (let index = 0; index < TDT_FLOOR_COUNT; index++) {
    const f = floorsByIndex.get(index);
    const tenants = f?.tenants ?? [];
    const left = f?.leftEdge ?? (tenants.length ? Math.min(...tenants.map((t) => t.left)) : 0);
    const right = f?.rightEdge ?? (tenants.length ? Math.max(...tenants.map((t) => t.right)) : 0);
    u16(f?.forgeTenantCount ?? tenants.length);
    u16(left);
    u16(right);
    for (const t of tenants) {
      u16(t.left);
      u16(t.right);
      u8(t.type); // i8 written via two's complement
      u8(t.status ?? 0);
      u8(t.subtype ?? 0); // byte 6: retail variant (where the real game stores it)
      pad(9); // reserved bytes 7–15
      u8(t.rentRate ?? 2); // byte 16: Average; imports as the default price
      u8(t.byte17 ?? 0); // byte 17 (unused; the variant lives at byte 6)
    }
    pad(TDT_FLOOR_INDEX_ENTRIES * 2); // per-floor remap table
  }

  // ---- Tail: people + retail ------------------------------------------------
  const peopleCount = spec.peopleCount ?? 0;
  i32(peopleCount);
  pad(peopleCount * TDT_PERSON_RECORD_SIZE);
  if (spec.includeRetail === false) return finish(chunks, spec);
  const occupied = Math.min(spec.retailRows ?? 0, TDT_RETAIL_SLOTS);
  for (let slot = 0; slot < TDT_RETAIL_SLOTS; slot++) {
    // Byte 0: the row's floor; 0xFF marks an empty slot.
    u8(slot < occupied ? 10 : 0xff);
    pad(TDT_RETAIL_RECORD_SIZE - 1);
  }
  if (spec.includeTransports === false) return finish(chunks, spec);

  // ---- Elevator table: 24 entries -------------------------------------------
  const elevators = (spec.elevators ?? []).slice(0, TDT_ELEVATOR_SLOTS);
  for (let slot = 0; slot < TDT_ELEVATOR_SLOTS; slot++) {
    const e = elevators[slot];
    if (!e) {
      pad(TDT_ELEVATOR_HEADER_SIZE); // empty slot: header only, all zeroes (used = 0)
      continue;
    }
    u8(1); // used
    u8(e.type);
    u8([42, 21, 10][e.type]); // car capacity (informational; not imported)
    u8(e.cars);
    pad(56); // schedule block
    u8(1); // visible
    u8(0); // reserved
    u16(e.x);
    u8(e.topFloor);
    u8(e.bottomFloor);
    const serviced = new Set(
      e.serviced ?? Array.from({ length: e.topFloor - e.bottomFloor + 1 }, (_, i) => e.bottomFloor + i),
    );
    let servicedCount = 0;
    for (let fl = 0; fl < TDT_FLOOR_COUNT; fl++) {
      const stops = serviced.has(fl);
      u8(stops ? 1 : 0);
      if (stops) servicedCount++;
    }
    for (let c = 0; c < 8; c++) u8(e.carHomes?.[c] ?? e.bottomFloor);
    // Built-shaft payload (live passenger state); zero-filled, sized exactly as
    // the parser skips it: a fixed block, one per-floor entry per SERVICED
    // floor, then a SINGLE car block (cars-INDEPENDENT, harness-confirmed on the
    // real 1994 game). NOT `cars *`: that overran multi-car shafts and desynced
    // the retail game's elevator table. See tdtFormat.ts / tdtExport.ts.
    pad(TDT_ELEVATOR_BUILT_FIXED + servicedCount * TDT_ELEVATOR_PER_FLOOR_SIZE + TDT_ELEVATOR_CAR_BLOCK_SIZE);
  }

  // ---- Finance + parking + stairs -------------------------------------------
  pad(TDT_FINANCE_SIZE);
  u16(spec.parkingConnected ?? 0);
  pad(TDT_PARKING_SIZE - 2);
  const stairs = (spec.stairs ?? []).slice(0, TDT_STAIR_SLOTS);
  for (let slot = 0; slot < TDT_STAIR_SLOTS; slot++) {
    const s = stairs[slot];
    if (!s) {
      pad(TDT_STAIR_RECORD_SIZE);
      continue;
    }
    u8(1); // built
    u8(s.type);
    u16(s.x);
    u16(s.floor);
    u16(0); // people up (live state)
    u16(0); // people down
  }

  return finish(chunks, spec);
}

function finish(chunks: number[], spec: TdtSpec): Uint8Array {
  const bytes = new Uint8Array(chunks);
  return spec.truncateAt !== undefined ? bytes.slice(0, spec.truncateAt) : bytes;
}

/** A playable mid-size tower exercising the DECODE path end to end: ground
 *  lobby, offices, condos, a hotel floor with housekeeping (one guest asleep,
 *  one room dirty), food, a basement with parking, a real elevator and a
 *  stairway. */
export function sampleTowerSpec(): TdtSpec {
  return {
    level: 2,
    balance: 15000, // $1,500,000 display
    frameTime: 0, // 7:00 AM, before checkout, so the asleep guest stays asleep
    currentDay: 3,
    floors: [
      // TDT 9 = B1 (ours 0): parking ramp (ID 44) + a stall.
      { index: 9, tenants: [{ left: 100, right: 116, type: 44 }, { left: 116, right: 120, type: 11 }] },
      // TDT 10 = ground (ours 1): the lobby concourse.
      { index: 10, leftEdge: 80, rightEdge: 220, tenants: [{ left: 80, right: 220, type: 24 }] },
      // TDT 11 = 2F: offices, one tenanted, one priced High.
      {
        index: 11,
        tenants: [
          { left: 100, right: 109, type: 7, status: 1 },
          { left: 109, right: 118, type: 7, rentRate: 3 },
        ],
      },
      // TDT 12 = 3F: condos, one sold; a fast food.
      {
        index: 12,
        tenants: [
          { left: 90, right: 106, type: 9, status: 2 },
          { left: 106, right: 122, type: 9 },
          { left: 122, right: 138, type: 12 },
        ],
      },
      // TDT 13 = 4F: hotel singles (one asleep with 1 guest, one dirty) + a
      // twin + housekeeping.
      {
        index: 13,
        tenants: [
          { left: 90, right: 94, type: 3, status: 16 | 1 },
          { left: 94, right: 98, type: 3, status: 32 },
          { left: 98, right: 104, type: 4 },
          { left: 104, right: 112, type: 15 },
        ],
      },
      // TDT 14 = 5F: one under construction (negative type).
      { index: 14, tenants: [{ left: 100, right: 109, type: -7 }] },
    ],
    peopleCount: 12,
    retailRows: 1,
    elevators: [{ type: 1, cars: 2, x: 150, bottomFloor: 9, topFloor: 14 }],
    stairs: [{ type: 1, x: 130, floor: 10 }],
    parkingConnected: 1,
  };
}
