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
 * in place). The returned array is frozen and shared.
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

const cache = new WeakMap<Tower, { units: Unit[]; length: number; revision: number; rooms: readonly Unit[] }>();
