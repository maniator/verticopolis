import type { Tower } from "../Tower";
import type { Unit } from "../types";
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
