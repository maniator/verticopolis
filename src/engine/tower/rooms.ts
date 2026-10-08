import type { Tower } from "../Tower";
import type { Unit } from "../types";
import { isStructural } from "./towerTopology";

/**
 * The tower's units minus its bare structure tiles (floor and lobby), in the
 * same order as `tower.units`.
 *
 * Structure tiles are most of the unit list on a real tower (about 11,000 of
 * 12,000 on a 78-floor save). The per-step scans that use this list (trip-spawn
 * binning, elevator waiting demand, the population census and its meal
 * overlay) skip them by kind or because a tile holds no population, no
 * occupants (zeroed on load), no customers and no meal-goers. Iterating this
 * list instead gives those loops the same results in the same order.
 *
 * Not a general "structure is inert" rule: some saves carry legacy floor tiles
 * in the `occupied` state, which the hourly satisfaction sweep does process.
 * Check a loop's body against that before switching it to this list.
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
