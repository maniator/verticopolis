import type { Tower } from "../Tower";
import { snapHomesToStops } from "../elevatorSchedule";

/**
 * Express-elevator stop management for the Tower, as friend functions taking the
 * {@link Tower} instance. Express elevators are locked to (sky) lobbies and
 * their endpoints (1994 parity); this module owns keeping that invariant true:
 * resyncing a single floor as its lobby status changes, (re)configuring a
 * shaft to the lobby-only skip list, and coercing a loaded save's express
 * stops at the trust boundary. `Tower.ts` keeps thin delegations.
 */

/**
 * Keep express elevators serving a floor's *current* lobby status: an express
 * spanning `floor` stops there iff it's a (sky) lobby. Called whenever a floor
 * gains or loses its lobby, so an express built before a sky lobby (or one
 * built after) both end up stopping at it, "express stops at sky lobbies" holds
 * no matter the build order. Only the changed floor is touched, so a player's
 * manual stop choices on *other* floors are preserved. Endpoints always stop.
 */
export function syncExpressStopsForFloor(tower: Tower, floor: number): void {
  const stop = tower.floorHasLobby(floor);
  for (const t of tower.transports) {
    if (t.kind !== "elevatorExpress") continue;
    if (floor <= t.bottom || floor >= t.top) continue; // endpoints always stop
    tower.setStop(t.id, floor, stop);
  }
}

/** Configure an elevator to stop only at lobby floors (true express). */
export function setExpressStops(tower: Tower, id: number): boolean {
  const t = tower.transportById(id);
  if (!t) return false;
  const lobbies = new Set(tower.lobbyFloors());
  const skip: number[] = [];
  for (let fl = t.bottom; fl <= t.top; fl++) {
    // Always keep the bottom and top as stops so it stays connected.
    if (fl === t.bottom || fl === t.top) continue;
    if (!lobbies.has(fl)) skip.push(fl);
  }
  t.skipFloors = skip;
  // The lobby-only lock may have skipped a floor a car homes at (#467).
  if (t.schedule) t.schedule = snapHomesToStops(t.schedule, tower.stopsOf(t));
  tower.revision++;
  return true;
}

/**
 * Trust-boundary defense for the express lobby-stop lock. The import and
 * deserialize paths write `skipFloors` directly, bypassing {@link setStop},
 * so a forged or foreign save could otherwise smuggle a non-lobby express
 * stop past the engine invariant. Force every in-span, non-endpoint floor
 * WITHOUT a (sky) lobby onto each express's skip list. Existing skips are
 * preserved (a player may deliberately skip a lobby, which reindex keeps), so
 * this only ever ADDS the forbidden non-lobby floors, never restores one.
 * Call after {@link reindex}, when the lobby-tile index is populated.
 */
export function coerceExpressStops(tower: Tower): void {
  let changed = false;
  for (const t of tower.transports) {
    if (t.kind !== "elevatorExpress") continue;
    const skip = new Set(t.skipFloors ?? []);
    for (let fl = t.bottom + 1; fl < t.top; fl++) {
      if (!tower.floorHasLobby(fl)) skip.add(fl);
    }
    // Endpoints always stop (a shaft can't disconnect from itself), so scrub a
    // forged bottom/top out of the skip set too: the coercion is the trust
    // boundary, and stopsAt() reads skipFloors literally for endpoints.
    skip.delete(t.bottom);
    skip.delete(t.top);
    const next = [...skip].sort((a, b) => a - b);
    if (next.join(",") !== (t.skipFloors ?? []).join(",")) {
      t.skipFloors = next;
      changed = true;
    }
  }
  // Mutating skipFloors invalidates the memoized stop lists (stopsCache is
  // keyed by revision), so bump it when the coercion actually changed a shaft.
  if (changed) tower.revision++;
}
