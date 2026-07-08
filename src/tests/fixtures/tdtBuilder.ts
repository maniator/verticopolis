import {
  TDT_FLOOR_COUNT,
  TDT_FLOOR_INDEX_ENTRIES,
  TDT_HEADER_SIZE,
  TDT_MAGIC,
  TDT_PERSON_RECORD_SIZE,
  TDT_RETAIL_RECORD_SIZE,
  TDT_RETAIL_SLOTS,
  TDT_TENANT_RECORD_SIZE,
} from "../../storage/tdtFormat";

/**
 * Declarative synthetic `.TDT` byte-buffer builder for the importer tests.
 *
 * Layout facts come from `docs/canon/tdt-format.md` — the same single source
 * of truth the parser reads — so the fixture and the parser can only drift if
 * the doc does. Every buffer is synthesized from scratch: NEVER commit bytes
 * from a real (copyrighted) SimTower save.
 */

export interface TenantSpec {
  /** Extents in tiles (half-open), exactly as stored. */
  left: number;
  right: number;
  /** Tenant type ID (doc §5); negative ⇒ under construction. */
  type: number;
  /** Status / occupant-count byte (nonzero ⇒ tenanted). */
  status?: number;
  rentClass?: number;
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

export interface TdtSpec {
  level?: number;
  /** Stored funds (display dollars ÷ 100). Signed. */
  balance?: number;
  frameTime?: number;
  currentDay?: number;
  floors?: FloorSpec[];
  /** People records appended to the tail (default 0). */
  peopleCount?: number;
  /** Write the 512-slot retail table into the tail (default true). */
  includeRetail?: boolean;
  /** Occupied retail rows to mark (floor ≥ 0), capped at the slot count. */
  retailRows?: number;
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
  u16(spec.magic ?? TDT_MAGIC); // 0x00 version/magic
  u16(spec.level ?? 1); // 0x02 level
  i32(spec.balance ?? 20000); // 0x04 balance (stored ×1/100)
  i32(0); // 0x08 otherIncome
  i32(0); // 0x0C constructionCosts
  i32(0); // 0x10 lastQuarterMoney
  u16(spec.frameTime ?? 0); // 0x14 frameTime
  i32(spec.currentDay ?? 0); // 0x16 currentDay
  pad(TDT_HEADER_SIZE - chunks.length); // undocumented misc block

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
      u16(0); // dataIndex
      i32(0); // peopleOffset
      u16(0); // indexInFloor
      u8(t.rentClass ?? 0);
      pad(TDT_TENANT_RECORD_SIZE - 15); // undocumented padding
    }
    pad(TDT_FLOOR_INDEX_ENTRIES * 2); // per-floor index map
  }

  // ---- Tail: people + retail ------------------------------------------------
  const peopleCount = spec.peopleCount ?? 0;
  i32(peopleCount);
  pad(peopleCount * TDT_PERSON_RECORD_SIZE);
  if (spec.includeRetail !== false) {
    const occupied = Math.min(spec.retailRows ?? 0, TDT_RETAIL_SLOTS);
    for (let slot = 0; slot < TDT_RETAIL_SLOTS; slot++) {
      // First field: floor (i16); negative ⇒ empty slot.
      if (slot < occupied) u16(10);
      else u16(0xffff); // -1
      pad(TDT_RETAIL_RECORD_SIZE - 2);
    }
  }

  const bytes = new Uint8Array(chunks);
  return spec.truncateAt !== undefined ? bytes.slice(0, spec.truncateAt) : bytes;
}

/** A playable mid-size tower: ground lobby, offices, condos, a hotel floor
 *  with housekeeping, food, and a basement — the shared fixture for the
 *  golden and end-to-end tests. */
export function sampleTowerSpec(): TdtSpec {
  return {
    level: 2,
    balance: 15000, // $1,500,000 display
    frameTime: 100,
    currentDay: 3,
    floors: [
      // TDT 9 = B1 (ours 0): parking ramp + spaces.
      { index: 9, tenants: [{ left: 100, right: 116, type: 45 }, { left: 116, right: 120, type: 11 }] },
      // TDT 10 = ground (ours 1): the lobby concourse.
      { index: 10, leftEdge: 80, rightEdge: 220, tenants: [{ left: 80, right: 220, type: 24 }] },
      // TDT 11 = 2F: offices, one tenanted.
      {
        index: 11,
        tenants: [
          { left: 100, right: 109, type: 7, status: 1 },
          { left: 109, right: 118, type: 7 },
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
      // TDT 13 = 4F: hotel singles + a twin + housekeeping.
      {
        index: 13,
        tenants: [
          { left: 90, right: 94, type: 3 },
          { left: 94, right: 100, type: 4 },
          { left: 100, right: 108, type: 15 },
        ],
      },
      // TDT 14 = 5F: one under construction (negative type).
      { index: 14, tenants: [{ left: 100, right: 109, type: -7 }] },
    ],
    peopleCount: 12,
    retailRows: 1,
  };
}
