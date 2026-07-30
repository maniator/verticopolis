import type { Tower } from "../Tower";
import { FACILITIES, GRID, isElevatorKind, isFixedSpanTransport, isStaffOnlyTransport, maxCarsFor } from "../facilities";
import type { FacilityKind, PlaceResult, Transport, Unit } from "../types";
import { isStructural, isSkyLobbyFloor, NEEDS_FLOORS, SHAFT_OVERLAP } from "./towerTopology";
import { coerceSchedule, snapHomesToStops } from "../elevatorSchedule";

/** Transport CRUD, stops, and resize (friend functions of {@link Tower}). */

/** Validate a transport placement without mutating anything. */
export function validateTransport(tower: Tower, kind: FacilityKind, x: number, bottom: number, top: number): PlaceResult {
  const f = FACILITIES[kind];
  if (!f.transport) return { ok: false, reason: "Not a transport." };
  const cap = tower.capReason(kind);
  if (cap) return { ok: false, reason: cap };
  if (top <= bottom) return { ok: false, reason: "Transport needs height." };
  if (x < 0 || x + f.width > GRID.width) {
    return { ok: false, reason: "Off the edge of the lot." };
  }
  const spanBad = tower.spanReason(kind, bottom, top);
  if (spanBad) return { ok: false, reason: spanBad };
  // Canon: escalators serve commercial spaces (shops/food/theatres), not office
  // complexes, so they may not be placed on a floor that holds an office.
  // Classic keeps the 1994 refusal; Modern lifts it (see GameRules).
  if (kind === "escalator" && !tower.rules.allowsEscalatorOnOfficeFloors) {
    for (const fl of [bottom, top]) {
      if (tower.units.some((u) => u.kind === "office" && u.floor === fl)) {
        return { ok: false, reason: "Escalators can't serve office floors. They link commercial floors only." };
      }
    }
  }

  // Transports may NOT overlap other shafts, and every floor they serve
  // must exist as built structure at the shaft, so elevators can never
  // float outside the tower. Rooms are deliberately NOT a collision: a
  // shaft may share a cell with a room and simply draws in front of it,
  // as in the original, where lifts overlap facilities.
  for (let fl = bottom; fl <= top; fl++) {
    if (!tower.shaftHasStructureAt(fl, x, f.width)) {
      return { ok: false, reason: NEEDS_FLOORS };
    }
    for (const t of tower.transports) {
      if (tower.transportOverlaps(t, x, f.width, fl)) {
        // Stacked stair/escalator flights may share their LANDING floor,
        // the top of one is the bottom of the next, and the flights occupy
        // different bands, so a continuous stair run stacks in one column,
        // exactly like the original. The stack must align EXACTLY (same
        // column and width); a partially offset flight is still a collision.
        if (
          isFixedSpanTransport(kind) &&
          isFixedSpanTransport(t.kind) &&
          t.x === x &&
          t.width === f.width &&
          (bottom === t.top || top === t.bottom)
        ) {
          continue;
        }
        return { ok: false, reason: SHAFT_OVERLAP };
      }
    }
  }
  return { ok: true };
}

/** Convenience boolean dry-run for previews. */
export function placeTransportDryRun(tower: Tower, kind: FacilityKind, x: number, bottom: number, top: number): boolean {
  return tower.validateTransport(kind, x, bottom, top).ok;
}

export function placeTransport(tower: Tower, 
  kind: FacilityKind,
  x: number,
  bottom: number,
  top: number,
): PlaceResult {
  const valid = tower.validateTransport(kind, x, bottom, top);
  if (!valid.ok) return valid;
  const f = FACILITIES[kind];
  const span = top - bottom;
  // Clamp the initial car count to the kind's own cap (the single source of
  // truth) so a fresh shaft can never open above what setCars would allow.
  const cars = isElevatorKind(kind) ? Math.min(maxCarsFor(kind), Math.max(1, Math.ceil(span / 6))) : 0;
  const t: Transport = {
    id: tower.nextId++,
    kind,
    x,
    width: f.width,
    bottom,
    top,
    cars,
    carPositions: Array.from({ length: cars }, (_, i) => bottom + i),
    carDir: Array.from({ length: cars }, () => 0),
    load: 0,
  };
  tower.transports.push(t);
  tower.transportsById.set(t.id, t);
  // Express elevators are lobby-to-lobby by definition: seed their skip list so
  // a freshly placed express actually behaves like one (stops only at lobby /
  // sky-lobby floors plus its own endpoints), instead of stopping everywhere
  // until the player opens the editor.
  if (kind === "elevatorExpress") tower.setExpressStops(t.id);
  tower.revision++;
  return { ok: true, transportId: t.id };
}

export function transportOverlaps(_tower: Tower, t: Transport, x: number, width: number, floor: number): boolean {
  if (floor < t.bottom || floor > t.top) return false;
  return x < t.x + t.width && x + width > t.x;
}

/**
 * Why a unit may not be removed by the player, or undefined if removal is
 * safe. Mirrors the placement invariant: above ground, structure must rest
 * on the story below, so a floor/lobby tile can't be pulled out from under
 * standing structure. (Internal callers like {@link ensureFloorUnder}'s
 * rollback bypass this via {@link removeUnit} directly.)
 */
export function removalReason(tower: Tower, id: number): string | undefined {
  const u = tower.byId.get(id);
  if (!u || !isStructural(u.kind)) return undefined;
  // Canon (1994 SimTower): once a lobby is placed, it cannot be bulldozed.
  // Applies at EVERY floor including the ground concourse (floor 1). The
  // sky-lobby-claimed placement rule scopes ground floor 1 out of the
  // placement half of the canon, but permanence has no such scope: a ground
  // lobby tile is just as final as a sky-lobby tile. Fires FIRST so the
  // canon reason wins over the generic structural message when both would
  // apply (a lobby with structure resting on it). Internal callers that
  // need to revert a lobby tile (bridge rollback, ensureFloorUnder rollback)
  // go through {@link removeUnit} directly and are unaffected.
  if (u.kind === "lobby") {
    return "Lobby tiles are permanent. The 1994 game does not let you remove them.";
  }
  if (u.floor >= 1 && !tower.structureSpanFree(u.floor + 1, u.x, u.width)) {
    return "Remove the story above first. Floors can't hang in midair.";
  }
  return undefined;
}

export function removeUnit(tower: Tower, id: number): Unit | undefined {
  const idx = tower.units.findIndex((u) => u.id === id);
  if (idx === -1) return undefined;
  const [u] = tower.units.splice(idx, 1);
  tower.unregister(u);
  // Derive from what actually still stands, so bulldozing one of two halls
  // doesn't wrongly clear the flag while a hall remains.
  if (u.kind === "weddingHall") {
    tower.builtWeddingHall = tower.units.some((x) => x.kind === "weddingHall");
  }
  // Last lobby tile gone → the floor is no longer a lobby, so express elevators
  // spanning it stop stopping there.
  if (u.kind === "lobby" && !tower.floorHasLobby(u.floor)) {
    tower.syncExpressStopsForFloor(u.floor);
  }
  tower.revision++;
  return u;
}

/** Lay plain floor across `[x, x + width)` on each floor in `floors` that lacks
 *  it, in support order (upward runs bottom-up, basements top-down, exactly like
 *  {@link ensureFloorUnder}). Returns the ids laid, or `null` if some tile can
 *  never be supported, after rolling the whole batch back so the caller can
 *  refuse without leaving an orphan floor. Used by the elevator-extend
 *  auto-floor: extending past built structure brings the floor along. */
export function layShaftFloors(tower: Tower, floors: number[], x: number, width: number): number[] | null {
  const tiles: { fl: number; x: number }[] = [];
  for (const fl of floors) {
    for (let i = 0; i < width; i++) {
      if (!tower.structure.has(tower.key(fl, x + i))) tiles.push({ fl, x: x + i });
    }
  }
  if (tiles.length === 0) return [];
  const { placed, stuck } = tower.placeStructureRun(tiles, "floor");
  if (stuck.length > 0) {
    for (const id of placed) tower.removeUnit(id);
    return null;
  }
  return placed;
}

/** Grow or shrink a transport's served range. Returns the floors added
 *  (negative if removed) on success, or a failure reason. Newly served floors
 *  are validated against other shafts; one with no structure under the shaft
 *  auto-lays plain floor behind it (the 1994 extend-past-structure behavior)
 *  rather than refusing. `floorTilesCreated` counts the width-1 floor units
 *  laid (a 4-wide shaft growing one story lays 4), not stories, so the caller
 *  can size any structure charge exactly. */
export function resizeTransport(tower: Tower, id: number, newBottom: number, newTop: number): PlaceResult & { added?: number; floorTilesCreated?: number } {
  const t = tower.transportById(id);
  if (!t) return { ok: false, reason: "No such transport." };
  if (newTop <= newBottom) return { ok: false, reason: "Transport needs height." };
  if (newBottom < GRID.minFloor || newTop > GRID.maxFloor) {
    return { ok: false, reason: "Outside the buildable range." };
  }
  // Same span rules as placement, the extend arrows must not stretch a
  // transport past what validateTransport would ever allow (this once let
  // stairs grow the whole tower height one extend at a time).
  const spanBad = tower.spanReason(t.kind, newBottom, newTop);
  if (spanBad) return { ok: false, reason: spanBad };
  // First pass over the newly-added floors: refuse on any hard conflict (a
  // different shaft already occupies the cell) and collect the whole set of
  // newly-served floors. Every one of them is handed to `layShaftFloors`,
  // which fills only the still-empty cells across the shaft footprint. Passing
  // ALL new floors (not just the ones with zero structure) closes the partial-
  // floor gap: a floor with structure under SOME of the shaft's columns but
  // not all would otherwise pass the any-tile served check and leave the shaft
  // floating over the empty columns. Now those columns are completed too, so
  // the extend always brings a FULL floor with it.
  const newFloors: number[] = [];
  for (let fl = newBottom; fl <= newTop; fl++) {
    if (fl >= t.bottom && fl <= t.top) continue; // already served
    for (const other of tower.transports) {
      if (other.id === t.id) continue;
      if (tower.transportOverlaps(other, t.x, t.width, fl)) {
        return { ok: false, reason: SHAFT_OVERLAP };
      }
    }
    // A sky-lobby floor (15/30/45…) is a player-placed concourse. Plain floor
    // IS placeable on an empty sky-lobby story, and a later sky lobby upgrades
    // that bare floor in place, so auto-laid floor would not trap the player.
    // The extend still refuses to AUTO-lay floor on an unbuilt sky-lobby story,
    // to avoid pre-empting the concourse the player still has to place: it tells
    // them to build the lobby first rather than silently filling the story with
    // plain floor they never asked for. A story that already carries its lobby
    // under the shaft needs no fill and passes (`spanHasFloor` counts lobby
    // tiles as structure).
    if (isSkyLobbyFloor(fl) && !tower.spanHasFloor(fl, t.x, t.width)) {
      return { ok: false, reason: `Build the sky lobby on floor ${fl} first, then extend through it.` };
    }
    newFloors.push(fl);
  }
  // Auto-lay plain floor across every still-empty cell behind the shaft on the
  // new floors. `layShaftFloors` returns null when a tile can never be
  // supported (an above-ground extend into open sky, or a column with nothing
  // below it), rolling back cleanly, so the shaft and its floor never float;
  // nothing else was mutated yet, so we refuse with the same message the old
  // hard structure check used.
  const createdFloors = tower.layShaftFloors(newFloors, t.x, t.width);
  if (createdFloors === null) {
    return { ok: false, reason: NEEDS_FLOORS };
  }
  const before = t.top - t.bottom + 1;
  const prevBottom = t.bottom;
  const prevTop = t.top;
  t.bottom = newBottom;
  t.top = newTop;
  // Keep cars within the new range.
  for (let i = 0; i < t.carPositions.length; i++) {
    t.carPositions[i] = Math.max(newBottom, Math.min(newTop, t.carPositions[i]));
  }
  // Keep express skipFloors coherent after a resize (a common build-order path):
  //   - Drop the new endpoints from skip, so shrinking onto a formerly-skipped
  //     floor doesn't disconnect the new endpoint.
  //   - Add newly-in-span non-lobby floors to skip, so growing past new territory
  //     doesn't turn the express into a local elevator.
  //   - Floors that were already in-span are LEFT ALONE, so a manual stop the
  //     player set inside the old range survives the resize.
  if (t.kind === "elevatorExpress") {
    // Rebuild the skip set by (a) preserving only in-span choices, pruning
    // anything now outside [newBottom, newTop] so the model can't carry ghost
    // floors after a shrink, (b) dropping the new endpoints (they always
    // stop), and (c) adding newly-in-span non-lobby floors so a grow doesn't
    // turn the express into a local elevator.
    const skip = new Set<number>();
    for (const f of t.skipFloors ?? []) {
      if (f > newBottom && f < newTop) skip.add(f); // in-span (endpoints excluded)
    }
    for (let fl = newBottom + 1; fl < newTop; fl++) {
      if (fl >= prevBottom && fl <= prevTop) continue; // preserve pre-existing choice
      if (!tower.floorHasLobby(fl)) skip.add(fl); // newly-in-span non-lobby → skip
    }
    t.skipFloors = [...skip].sort((a, b) => a - b);
  }
  // Re-harden an authored schedule against the new span (#305) and snap homes
  // onto the live stop set (#467); revision bumps first so stopsOf recomputes.
  tower.revision++;
  if (t.schedule) t.schedule = coerceSchedule(t.schedule, t.cars, t.bottom, t.top);
  if (t.schedule) t.schedule = snapHomesToStops(t.schedule, stopsOf(tower, t));
  return { ok: true, added: newTop - newBottom + 1 - before, floorTilesCreated: createdFloors.length };
}

/** Change the number of elevator cars (1..max for that elevator type). */
export function setCars(tower: Tower, id: number, cars: number): boolean {
  const t = tower.transportById(id);
  if (!t || !isElevatorKind(t.kind)) return false;
  cars = Math.max(1, Math.min(maxCarsFor(t.kind), cars));
  if (cars === t.cars) return false;
  if (cars > t.cars) {
    for (let i = t.cars; i < cars; i++) {
      t.carPositions.push(t.bottom);
      t.carDir.push(1);
    }
  } else {
    t.carPositions.length = cars;
    t.carDir.length = cars;
  }
  t.cars = cars;
  // Re-harden an authored schedule against the new car count (#305): a fleet
  // shrink clamps rows and truncates homes past the last remaining car.
  if (t.schedule) t.schedule = coerceSchedule(t.schedule, t.cars, t.bottom, t.top);
  tower.revision++;
  return true;
}

/** Write an authored per-shaft schedule (#305 Phase 3), hardened through
 *  `coerceSchedule` against the live cars and span so it can never carry a count
 *  above the fleet or a home off the shaft. Bumps `revision` so routing and stop
 *  caches invalidate (arch §3). Returns false for a non-elevator id. */
export function setSchedule(tower: Tower, id: number, raw: unknown): boolean {
  const t = tower.transportById(id);
  if (!t || !isElevatorKind(t.kind)) return false;
  tower.revision++; // before the snap: stopsOf caches by revision
  t.schedule = coerceSchedule(raw, t.cars, t.bottom, t.top);
  // Backstop (#467): coerce clamps to the SPAN only; a mid-dialog stop edit
  // (undo/redo) can still hand us a home on a skipped floor.
  if (t.schedule) t.schedule = snapHomesToStops(t.schedule, stopsOf(tower, t));
  return true;
}

/** Floors that have at least one lobby tile (express stops). Derived from the
 *  per-floor lobbyTiles counter kept live by register/unregister, so this is
 *  O(k log k) in the number of lobby floors (a handful in practice) instead
 *  of O(n) over every unit, hot-path callers (ElevatorDispatch) invoke it
 *  every tick. */
export function lobbyFloors(tower: Tower): number[] {
  return [...tower.lobbyTiles.keys()].sort((a, b) => a - b);
}

/** Floor-distance from `floor` to the nearest (sky) lobby, in floors, 0 on a
 *  lobby floor itself. The ground floor (1) always counts as a lobby: visitors
 *  enter there, so it anchors the distance even before any lobby tile is laid.
 *  Drives the W3 commercial-near-lobby income penalty (see
 *  {@link EconomySystem.collectTrafficIncome}). O(lobby floors), a handful. */
export function nearestLobbyFloorDistance(tower: Tower, floor: number): number {
  let best = Math.abs(floor - 1); // ground is always the tower's entrance lobby
  for (const lf of tower.lobbyTiles.keys()) {
    const d = Math.abs(floor - lf);
    if (d < best) best = d;
  }
  return best;
}

/** The nearest sky-lobby slot that is LEGAL (an every-interval floor at or under
 *  `GRID.maxFloor`), does not already hold a lobby, and is strictly nearer to
 *  `floor` than its current nearest lobby; null when no such slot exists. The
 *  inspector's honesty gate for the lobby-distance advice (#394): it may only
 *  name a slot the player can actually reach, so the line goes neutral for the
 *  short block above the highest legal slot instead of prescribing an
 *  impossible fix. A returned slot may still need work first (floors laid, or
 *  a room cleared; callers read {@link Tower.floorHasRoom} to phrase that
 *  step). O(lobby slots), a handful. */
export function nearestBuildableLobbySlot(tower: Tower, floor: number): number | null {
  const current = nearestLobbyFloorDistance(tower, floor);
  let best: number | null = null;
  for (let slot = GRID.lobbyInterval; slot <= GRID.maxFloor; slot += GRID.lobbyInterval) {
    if (!isSkyLobbyFloor(slot) || floorHasLobby(tower, slot)) continue;
    const d = Math.abs(floor - slot);
    if (d >= current) continue; // must actually improve on the nearest lobby
    if (best === null || d < Math.abs(floor - best)) best = slot;
  }
  return best;
}

/**
 * Toggle whether a transport stops at a floor (express configuration).
 * Endpoints are always stops, a shaft's bottom and top can't be skipped, or
 * it would be disconnected from itself, so a request to skip an endpoint is
 * silently ignored regardless of `stop`.
 */
export function setStop(tower: Tower, id: number, floor: number, stop: boolean): boolean {
  const t = tower.transportById(id);
  if (!t || floor < t.bottom || floor > t.top) return false;
  // Endpoints are always stops (a shaft can't disconnect from itself); the
  // request was valid and the endpoint is already stopping, so report success.
  if (floor === t.bottom || floor === t.top) return true;
  // Express elevators are locked to (sky) lobbies and endpoints (1994 parity):
  // a floor may become a stop only if it hosts a lobby tile. Reject any other
  // request (leave it skipped) so the invariant holds against every caller;
  // syncExpressStopsForFloor only passes stop=true for a lobby floor.
  if (t.kind === "elevatorExpress" && stop && !tower.floorHasLobby(floor)) return false;
  const skip = new Set(t.skipFloors ?? []);
  if (stop) skip.delete(floor);
  else skip.add(floor);
  t.skipFloors = [...skip].sort((a, b) => a - b);
  // Bump revision BEFORE the snap: stopsOf caches by revision and dispatch keeps
  // it warm every tick; snapping first would read the pre-edit stops (#467).
  tower.revision++;
  if (t.schedule) t.schedule = snapHomesToStops(t.schedule, stopsOf(tower, t));
  return true;
}

/** Does this floor carry at least one lobby tile (a ground/sky lobby)? O(1). */
export function floorHasLobby(tower: Tower, floor: number): boolean {
  return (tower.lobbyTiles.get(floor) ?? 0) > 0;
}

/** Make a transport stop at every floor again. An express is locked to
 *  lobby-only stops (1994 parity), so "clear" restores its lobby-only skip
 *  list (setExpressStops) rather than a stop-at-every-floor list. */
export function clearStops(tower: Tower, id: number): boolean {
  const t = tower.transportById(id);
  if (!t) return false;
  if (t.kind === "elevatorExpress") return tower.setExpressStops(id);
  t.skipFloors = []; // every floor stops again: no home snap needed
  tower.revision++;
  return true;
}

export function removeTransport(tower: Tower, id: number): Transport | undefined {
  const idx = tower.transports.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  const [t] = tower.transports.splice(idx, 1);
  tower.transportsById.delete(id);
  tower.stopsCache.delete(id);
  tower.revision++;
  return t;
}

export function transportAt(tower: Tower, floor: number, x: number): Transport | undefined {
  return tower.transports.find(
    (t) => floor >= t.bottom && floor <= t.top && x >= t.x && x < t.x + t.width,
  );
}

/** Does this transport actually stop at the given floor (vs. skip it)? */
export function stopsAt(_tower: Tower, t: Transport, floor: number): boolean {
  if (floor < t.bottom || floor > t.top) return false;
  return !(t.skipFloors && t.skipFloors.includes(floor));
}

/** The floors a transport actually stops at, the single stop-enumeration
 *  every consumer (routing graphs, dispatch, staff components) shares. */
export function stopsOf(tower: Tower, t: Transport): number[] {
  const cached = tower.stopsCache.get(t.id);
  if (cached && cached.rev === tower.revision) return cached.stops;
  const s: number[] = [];
  for (let fl = t.bottom; fl <= t.top; fl++) if (tower.stopsAt(t, fl)) s.push(fl);
  tower.stopsCache.set(t.id, { rev: tower.revision, stops: s });
  return s;
}

export function transportColumns(tower: Tower, floor: number): Array<[number, number]> {
  if (tower.transportColsRev !== tower.revision) {
    tower.transportColsByFloor.clear();
    const served = tower.servedFloors();
    for (const t of tower.transports) {
      // Service elevators are staff-only (canon): tenants and visitors can't
      // ride them, so a service shaft next door is NOT the "elevator nearby"
      // that spares an office the walk. Mirror servedFloors, which excludes them
      // for the same reason, otherwise a staff shaft would silently suppress W1.
      if (isStaffOnlyTransport(t.kind)) continue;
      for (let fl = t.bottom; fl <= t.top; fl++) {
        // A shaft only helps a floor it stops at, and only if that floor is
        // actually connected to the lobby (a shaft to nowhere is no relief).
        if (!tower.stopsAt(t, fl) || !served.has(fl)) continue;
        const list = tower.transportColsByFloor.get(fl);
        // Clamp the span to the lot: a transport's width is trusted from the
        // save (and can be a legacy value after a catalog change), so an
        // over-wide or corrupt shaft must not report a column past the lot
        // edge and skew the W1 distance scan.
        const span: [number, number] = [Math.max(0, t.x), Math.min(t.x + t.width, GRID.width)];
        if (list) list.push(span);
        else tower.transportColsByFloor.set(fl, [span]);
      }
    }
    tower.transportColsRev = tower.revision;
  }
  return tower.transportColsByFloor.get(floor) ?? [];
}

/**
 * Nearest reachable transport (elevator/stair/escalator) to a unit, as the
 * horizontal gap in tiles between the unit's footprint and the closest shaft
 * column that stops on its floor and is lobby-connected. `0` when a shaft
 * abuts or overlaps the footprint; `Infinity` when the floor has no reachable
 * shaft at all (the plain access drain already covers that case). This is the
 * canon "stairs/elevators are far away" measure, offices past ~79 tiles wear
 * their tenants down (W1, see {@link Simulation.updateSatisfaction}).
 */
export function nearestTransportDistance(tower: Tower, u: Unit): number {
  const cols = tower.transportColumns(u.floor);
  if (cols.length === 0) return Infinity;
  const left = u.x;
  const right = u.x + u.width;
  let best = Infinity;
  for (const [x0, x1] of cols) {
    // Overlap ⇒ 0; shaft entirely left ⇒ left - x1; entirely right ⇒ x0 - right.
    const gap = x1 <= left ? left - x1 : x0 >= right ? x0 - right : 0;
    if (gap < best) best = gap;
    if (best === 0) break;
  }
  return best;
}
