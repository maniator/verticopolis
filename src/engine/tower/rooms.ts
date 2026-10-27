import type { Tower } from "../Tower";
import { censusCount } from "../census";
import { isHotelKind } from "../facilityPredicates";
import type { Unit, UnitState } from "../types";
import { isPresent, isTenanted } from "../types";
import { isStructural } from "./towerTopology";

/**
 * The tower's units minus its bare structure tiles (floor and lobby), in the
 * same order as `tower.units`.
 *
 * Structure tiles are most of the unit list on a real tower (about 11,000 of
 * 12,000 on a 78-floor save). Every one is `empty` (placement creates them so,
 * and load restores any other saved state to `empty` and their occupants to 0),
 * so it is dormant, never present or tenanted, and holds nobody. A loop that
 * skips units by room kind, or skips dormant or non-present units, gets the same
 * results in the same order from this list. The per-step scans (trip-spawn
 * binning, elevator demand, the census) and the hourly passes (satisfaction,
 * demand, move-ins, traffic income, presence, congestion, parking, the star
 * census) use it. A loop that reads structure geometry (floor extents, the
 * structure index) must keep walking `tower.units`.
 *
 * Memoized per tower on the unit array, its length, and `tower.revision`
 * (every placement and removal bumps the revision; a unit's kind never changes
 * in place). The WASM hosts' merge rewrites the array in place and sets the
 * revision from the engine's own count, so it drops the memo
 * (`forgetUnitLists`) when the revision or the units moved, and an hourly
 * merge that moved neither keeps it. The returned array is frozen and shared.
 */
export function roomUnits(tower: Tower): readonly Unit[] {
  const hit = cache.get(tower);
  if (hit && hit.units === tower.units && hit.length === tower.units.length && hit.revision === tower.revision) {
    return hit.rooms;
  }
  const rooms: readonly Unit[] = Object.freeze(tower.units.filter((u) => !isStructural(u.kind)));
  cache.set(tower, { units: tower.units, length: tower.units.length, revision: tower.revision, rooms });
  return rooms;
}

/**
 * The tower's floor and lobby tiles as runs, ordered by floor and then x,
 * each tile in exactly one run and each run as long as it can be: a run ends
 * at a gap, a change of kind or a change of width, and nothing else. These
 * are the tiles `roomUnits` leaves out, so the two lists split `tower.units`
 * between them (#1253). The fields are those of a run in the Rust engine's
 * structural snapshot (6a, #1213), which carries no ids; 6a may also split a
 * run that this joins, so a Rust adapter joins them. The renderer can then
 * draw the structure, about 40,000 tiles on the large tower, from about a
 * hundred runs.
 *
 * Memoized and dropped as `roomUnits` is. A rebuild is one pass over
 * `tower.units` and one over the structure tiles, plus an order by x within
 * any floor whose tiles are not already in order (each floor holds at most
 * `LOT_WIDTH` tiles). The returned array and its runs are frozen and shared.
 */
export function structureRuns(tower: Tower): readonly StructureRun[] {
  const hit = runsCache.get(tower);
  if (hit && hit.units === tower.units && hit.length === tower.units.length && hit.revision === tower.revision) {
    return hit.runs;
  }
  const runs = buildRuns(tower.units);
  runsCache.set(tower, { units: tower.units, length: tower.units.length, revision: tower.revision, runs });
  return runs;
}

/** `count` floor or lobby tiles of one kind and width, side by side on one
 *  floor: tile i sits at `x + i * width`. The structure kinds are exactly
 *  the two `isStructural` accepts (a test pins that). */
export interface StructureRun {
  readonly kind: "floor" | "lobby";
  readonly floor: number;
  readonly x: number;
  readonly width: number;
  readonly count: number;
}

/** Drop `tower`'s memoized room list and structure runs, so the next read of
 *  either builds it afresh. For a writer that rewrites `tower.units` in place
 *  and sets the revision from outside, as the WASM hosts' merge does: the
 *  engine counts from its own load, so a revision it sets can repeat a
 *  memoized one with other units behind it (#1253). */
export function forgetUnitLists(tower: Tower): void {
  cache.delete(tower);
  runsCache.delete(tower);
}

/**
 * The counts the HUD strip shows from the rooms (`stats()`): each counted kind,
 * the offices, condos and hotel rooms in each counted condition, and the
 * population (`censusCount` over the present rooms, as `totalPopulation` sums
 * it).
 */
export interface RoomCounts {
  population: number;
  offices: number;
  occupiedOffices: number;
  vacant: number;
  vacantNoRate: number;
  condos: number;
  soldCondos: number;
  hotelRooms: number;
  occupiedHotel: number;
  dirty: number;
  shops: number;
  restaurants: number;
  parkingSpaces: number;
}

/** The unit fields {@link roomCounts} reads besides `kind`: every write of
 *  one marks its room. `roomCounts.test.ts` holds the counts to reading only
 *  these, and the writers guard (`src/tests/roomCountsWriters.guard.test.ts`)
 *  scans for writes of these. */
export const COUNTED_FIELDS = ["state", "noRate", "everOccupied", "residents", "customersIn"] as const;

/**
 * The tower's {@link RoomCounts}, kept as the rooms change so that a HUD
 * refresh does not pass over the rooms (HP-12 in
 * `docs/performance/hot-path-review.md`, #905).
 *
 * The counts are built in one pass over `roomUnits` whenever that list is
 * rebuilt (a placement, a removal, a load, a merge that moved the units).
 * Between rebuilds, each write of a field the counts read
 * ({@link COUNTED_FIELDS}) marks its room through {@link setRoomState} or
 * {@link markRoom}, and a read recounts only the marked rooms: it takes each
 * one's last share out and puts its share as the fields stand now back in.
 * A room's kind never changes in place (`roomUnits` relies on the same; the
 * hosts' full merge and hourly delta, the writers that could, drop the rooms
 * list when a kind moves), so the kind counts move only with the list. The
 * returned object is the ledger's own: the next read after a write updates it
 * in place, and a rebuild replaces it, so a caller that keeps the counts
 * copies them.
 */
export function roomCounts(tower: Tower): Readonly<RoomCounts> {
  const rooms = roomUnits(tower);
  const ledger = ledgers.get(tower);
  if (!ledger || ledger.rooms !== rooms) return countRooms(tower, rooms);
  for (const u of ledger.changed) {
    const share = ledger.shares.get(u);
    // A structure tile, the one marked unit with no share: the list holds
    // every room, and no writer swaps a room's object while the list stands.
    if (!share) continue;
    tally(ledger.counts, share, -1);
    share.flags = flagsOf(u);
    share.population = populationOf(u);
    tally(ledger.counts, share, 1);
  }
  ledger.changed.clear();
  return ledger.counts;
}

/** Set `u.state` and mark the room for {@link roomCounts}. */
export function setRoomState(tower: Tower, u: Unit, state: UnitState): void {
  u.state = state;
  markRoom(tower, u);
}

/** Mark `u` as changed since the counts were last read, after a write to one
 *  of the fields {@link roomCounts} reads (or before it: the next read takes
 *  the fields as they stand then, so one mark covers every write made before
 *  that read). Nothing to do before the tower's first count. */
export function markRoom(tower: Tower, u: Unit): void {
  ledgers.get(tower)?.changed.add(u);
}

const cache = new WeakMap<Tower, { units: Unit[]; length: number; revision: number; rooms: readonly Unit[] }>();
const runsCache = new WeakMap<Tower, { units: Unit[]; length: number; revision: number; runs: readonly StructureRun[] }>();

function buildRuns(units: readonly Unit[]): readonly StructureRun[] {
  const byFloor = new Map<number, Unit[]>();
  for (const u of units) {
    if (!isStructural(u.kind)) continue;
    const tiles = byFloor.get(u.floor);
    if (tiles) tiles.push(u);
    else byFloor.set(u.floor, [u]);
  }
  const floors = [...byFloor.keys()].sort((a, b) => a - b);
  const runs: StructureRun[] = [];
  for (const floor of floors) {
    const tiles = byFloor.get(floor) as Unit[];
    if (!inOrder(tiles)) tiles.sort((a, b) => a.x - b.x);
    let open: { kind: "floor" | "lobby"; x: number; width: number; count: number } | undefined;
    for (const t of tiles) {
      const kind = t.kind as "floor" | "lobby";
      if (open && open.kind === kind && open.width === t.width && open.x + open.count * open.width === t.x) {
        open.count++;
        continue;
      }
      if (open) runs.push(Object.freeze({ floor, ...open }));
      open = { kind, x: t.x, width: t.width, count: 1 };
    }
    if (open) runs.push(Object.freeze({ floor, ...open }));
  }
  return Object.freeze(runs);
}

function inOrder(tiles: readonly Unit[]): boolean {
  for (let i = 1; i < tiles.length; i++) if (tiles[i].x < tiles[i - 1].x) return false;
  return true;
}

/** A room's part in the condition counts and the population. */
interface Share {
  flags: number;
  population: number;
}

interface RoomLedger {
  rooms: readonly Unit[];
  counts: RoomCounts;
  shares: Map<Unit, Share>;
  changed: Set<Unit>;
}

const ledgers = new WeakMap<Tower, RoomLedger>();

const OCCUPIED_OFFICE = 1;
const VACANT = 2;
const VACANT_NO_RATE = 4;
const SOLD_CONDO = 8;
const OCCUPIED_HOTEL = 16;
const DIRTY = 32;

/** Which condition counts `u` is in, by the tests `stats()` has always used. */
function flagsOf(u: Unit): number {
  if (u.kind === "office") {
    let flags = isTenanted(u) ? OCCUPIED_OFFICE : 0; // a lame-duck on notice still holds the space
    // Off-market (No Rate) vacancies are split out so the headline count
    // stays honest: these will never fill at the current setting.
    if (u.state === "empty") flags |= u.noRate ? VACANT | VACANT_NO_RATE : VACANT;
    return flags;
  }
  if (u.kind === "condo") return u.everOccupied ? SOLD_CONDO : 0;
  if (isHotelKind(u.kind)) return (u.state === "asleep" ? OCCUPIED_HOTEL : 0) | (u.state === "dirty" ? DIRTY : 0);
  return 0;
}

/** A room's part in the population: its census count while anyone is in. */
function populationOf(u: Unit): number {
  return isPresent(u) ? censusCount(u) : 0;
}

function tally(c: RoomCounts, share: Share, sign: 1 | -1): void {
  c.population += sign * share.population;
  if (share.flags === 0) return;
  if (share.flags & OCCUPIED_OFFICE) c.occupiedOffices += sign;
  if (share.flags & VACANT) c.vacant += sign;
  if (share.flags & VACANT_NO_RATE) c.vacantNoRate += sign;
  if (share.flags & SOLD_CONDO) c.soldCondos += sign;
  if (share.flags & OCCUPIED_HOTEL) c.occupiedHotel += sign;
  if (share.flags & DIRTY) c.dirty += sign;
}

/** One pass over the rooms: the kind counts, and each room's share. */
function countRooms(tower: Tower, rooms: readonly Unit[]): RoomCounts {
  const counts: RoomCounts = {
    population: 0, offices: 0, occupiedOffices: 0, vacant: 0, vacantNoRate: 0, condos: 0, soldCondos: 0,
    hotelRooms: 0, occupiedHotel: 0, dirty: 0, shops: 0, restaurants: 0, parkingSpaces: 0,
  };
  const shares = new Map<Unit, Share>();
  for (const u of rooms) {
    if (u.kind === "office") counts.offices++;
    else if (u.kind === "condo") counts.condos++;
    else if (isHotelKind(u.kind)) counts.hotelRooms++;
    else if (u.kind === "shop") counts.shops++;
    else if (u.kind === "restaurant" || u.kind === "fastFood") counts.restaurants++;
    else if (u.kind === "parking") counts.parkingSpaces++;
    const share = { flags: flagsOf(u), population: populationOf(u) };
    tally(counts, share, 1);
    shares.set(u, share);
  }
  ledgers.set(tower, { rooms, counts, shares, changed: new Set() });
  return counts;
}
