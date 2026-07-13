/**
 * Constants, size/offset tables, and the typed error for the 1994 `.TDT` save
 * format. Extracted from `tdtFormat.ts` (the pure binary walker); layout facts
 * come from `docs/canon/tdt-format.md`. No game semantics live here.
 */

/** A `.TDT` file that can't be read. `message` is always player-readable. */
export class LegacyImportError extends Error {}

/** Header magic: the u16 at offset 0 is `0x2400` in every known save. */
export const TDT_MAGIC = 0x2400;

/** Fixed header block size; the floor map starts at offset 560 (doc §1;
 *  confirmed by tower-docs, and by the arithmetic 560 + 10 × 194 empty
 *  basement records = 0x9C4, the ground-floor offset seen in real saves). */
export const TDT_HEADER_SIZE = 0x230;

/** Floor slots in the file: indexes 0–119 (doc §4). */
export const TDT_FLOOR_COUNT = 120;

/** One tenant record is 18 bytes (doc §4). */
export const TDT_TENANT_RECORD_SIZE = 18;

/** Each floor record ends with a 94-entry u16 index map (doc §4). */
export const TDT_FLOOR_INDEX_ENTRIES = 94;

/**
 * Hostile-input ceilings. Each floor record carries a 94-entry index map into
 * its tenant array (doc §4), so ~94 is the format's own structural bound on
 * tenants per floor; 256 is a generous ceiling above that (in case the map's
 * role is misunderstood upstream) that still refuses absurd counts before any
 * loop runs. The size ceiling comfortably holds a maxed tower (~120 floors ×
 * a few KB) while refusing a multi-gigabyte allocation.
 */
export const TDT_MAX_TENANTS_PER_FLOOR = 256;
export const TDT_MAX_FILE_BYTES = 4 * 1024 * 1024;
/** People cap for the tolerant tail walk (canon max census is 15,000; fast
 *  food counts workers+customers, so real files run higher; 100k is far past
 *  any legitimate save while still refusing absurd skip lengths). */
export const TDT_MAX_PEOPLE = 100_000;

/**
 * Byte sizes for the tail blocks (doc §6–§10): 16-byte person records after a
 * u32 count; 512 × 18-byte retail rows; 24 elevator entries (194-byte header
 * each, built shafts appending a 3,140-byte fixed block, then one 324-byte entry
 * per serviced floor and one 348-byte entry per car; the 3,140 was measured, see
 * TDT_ELEVATOR_BUILT_FIXED); a 132-byte finance block; a 1,026-byte parking
 * block; and 64 × 10-byte stair/escalator records.
 */
export const TDT_PERSON_RECORD_SIZE = 16;
/** Upper bound the exporter clamps its people count to: the canon TOWER census
 *  (15,000). Bounds the people block a forged save can inflate (each unit adds
 *  16 bytes) while still covering any legitimate tower. */
export const TDT_MAX_CENSUS = 15_000;
/** Default saved view-scroll the exporter writes into the header (0x26 = x,
 *  0x28 = y, in world pixels): the value the 1994 game itself stores for a fresh
 *  New Tower, which opens the view on the ground lobby. Left at 0 a loaded tower
 *  opens at the top-left sky instead of on its entrance. Used only when the
 *  save carries no view of its own (see `viewWordsFromView`). */
export const TDT_DEFAULT_VIEW_X = 1105;
export const TDT_DEFAULT_VIEW_Y = 3491;

/** TDT floor index → our floor: uniform `ours = tdt − 9` (doc §4, proven by
 *  the lobby table; TDT 10/24/39/… = floors 1/15/30/…). Lives here (not in
 *  tdtImport) because the pure view-word mapping needs it too. */
export const TDT_FLOOR_OFFSET = 9;

/**
 * 1994 world metrics for the header's view-scroll words. Horizontal: tenant
 * extents are 8-pixel segments == our tiles (doc §4), on a 375-segment lot
 * (3,000 px). Vertical: 36 px per floor across the 120 floor slots (4,320 px).
 * The window size is DERIVED, not documented: anchoring on the known New
 * Tower default (1105, 3491) which "opens on the ground lobby", a 469-px
 * client height puts 3491 + 469 = 3960 exactly at the bottom edge of TDT
 * floor 10 (the ground floor pinned to the bottom of the screen), and 640 is
 * the 1994 display width. The round-trip tests pin this anchor.
 */
export const TDT_TILE_PX = 8;
export const TDT_FLOOR_PX = 36;
export const TDT_WORLD_W = 375 * TDT_TILE_PX;
export const TDT_WORLD_H = TDT_FLOOR_COUNT * TDT_FLOOR_PX;
export const TDT_VIEW_W = 640;
export const TDT_VIEW_H = 469;

export const TDT_RETAIL_SLOTS = 512;
export const TDT_RETAIL_RECORD_SIZE = 18;
export const TDT_ELEVATOR_SLOTS = 24;
export const TDT_ELEVATOR_HEADER_SIZE = 194;
// Built shafts append a fixed block whose true size (3140 B) was measured from
// real 1994 saves via the tools/simtower round-trip harness: walking the three
// shafts in my_tower.TDT, the record stride
//   194-byte header + 3140 + 324 * servicedFloors + 348
// reproduces every shaft's exact file offset. The earlier 480 + 2 * 120 = 720
// estimate undercounted this block by 2420 B, which desynced the whole table
// after the first shaft and forced the importer to synthesize fakes instead.
// The trailing 348-byte block is cars-INDEPENDENT (one per shaft, NOT `* cars`):
// harness-confirmed against the retail game in 2026-07-13. See TDT_ELEVATOR_CAR_BLOCK_SIZE.
export const TDT_ELEVATOR_BUILT_FIXED = 3140;
export const TDT_ELEVATOR_PER_FLOOR_SIZE = 324;
/** The single 348-byte car block appended per BUILT shaft. It appears exactly
 *  ONCE per shaft regardless of the car count (harness-confirmed on the real
 *  1994 game): never multiply by cars. The former name `TDT_ELEVATOR_PER_CAR_SIZE`
 *  wrongly implied a per-car block and invited a `* cars` regression, so it was
 *  renamed to `..._CAR_BLOCK_SIZE`. */
export const TDT_ELEVATOR_CAR_BLOCK_SIZE = 348;
/**
 * The 56-byte per-shaft schedule/config block (bytes 4–59 of an elevator
 * header) the 1994 game reads to dispatch cars. Every built shaft in a sampled
 * real save carried this exact default; a zero-filled block instead reads as
 * "run no cars", so the shaft loads with EMPTY cars and traps everyone
 * (confirmed via the SimTower harness). The exporter emits this so exported
 * shafts actually run. The precise per-hour scheduling model (the WD/WE strip
 * in the elevator editor) is a separate feature; see the backlog's
 * `elevator-scheduling`. Layout: 14 bytes 0x01, 14 bytes 0x05, 28 bytes 0x00.
 */
export const TDT_ELEVATOR_SCHEDULE_DEFAULT: readonly number[] = [
  ...(Array(14).fill(0x01) as number[]),
  ...(Array(14).fill(0x05) as number[]),
  ...(Array(28).fill(0x00) as number[]),
];
export const TDT_FINANCE_SIZE = 132;
export const TDT_PARKING_SIZE = 2 + 512 * 2;
export const TDT_STAIR_SLOTS = 64;
export const TDT_STAIR_RECORD_SIZE = 10;
/**
 * Size of the trailing routing/reachability region the 1994 game reads AFTER
 * the stairs table (doc §11+: lobby/reachability tables and related caches).
 *
 * The importer skips this region (its live crowd re-simulates), but the real
 * game reads it at a FIXED extent on load. Our exporter used to end right after
 * the stairs table, ~25 KB short of that extent, so the game read off the end of
 * the file and page-faulted (0x0799, surfaced as "This file is already open, or
 * damaged"). The exporter now emits this region so the file reaches the length
 * the game expects.
 *
 * It is filled with 0xFF, the format's empty-slot sentinel. That choice is
 * load-bearing and was confirmed with the SimTower harness (tools/simtower/):
 * ZERO-filling the same span loads but makes the game read the zeros as live
 * routing data and invent a phantom population (an empty tower reported Pop
 * 1,280 and a bogus star), whereas 0xFF reads as "every slot empty", so the game
 * rebuilds reachability and the crowd from the floor map and reports the right
 * population (an empty tower loads at Pop 0).
 *
 * This fixed size is validated against real saves for Classic towers up to two
 * stars. The exact per-tower size for larger towers (more elevators, sky
 * lobbies, big crowds) is not yet pinned down and is a follow-up; see the
 * backlog's `tdt-export-routing-tail` row. Over-emitting is safe (the game
 * ignores trailing slack); under-emitting is the crash, so this is generous.
 */
export const TDT_ROUTING_TAIL_SIZE = 0x6400;
/** Sanity bounds used to recognize a real stair record while scanning for the
 *  table: a built flight sits within the tower's tile span, on a valid floor,
 *  with a plausible waiting-crowd count. Generous on purpose (validation, not
 *  gameplay): the goal is to reject finance/parking bytes, not to clamp data. */
export const TDT_MAX_TILE = 800;
export const TDT_MAX_STAIR_CROWD = 4000;
/** How far past the elevator table to scan for the stairs table (bytes). The
 *  finance block (132) + parking/lobby region between the elevator table and the
 *  stairs table measured ~0.7 KB in a real save and is bounded by parking's
 *  512-stall table (~1 KB); 4 KB covers that with slack while keeping the scan
 *  away from the far §11 lobby/§12 named-tenant blocks (smaller window = less
 *  chance a coincidental later window out-counts the real table). */
export const TDT_STAIR_SCAN_WINDOW = 4096;
