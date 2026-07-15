import type { Tower } from "../Tower";
import type { Unit } from "../types";
import { isOperational } from "../types";
import { attendanceCap, FACILITIES } from "../facilities";
import type { Crowd } from "../Crowd";
import type { Person, Route } from "./person";

/**
 * The low-level trip primitives shared by every spawn path (commutes, meal
 * round-trips, attendance visits, staff dispatch): build a person on a route,
 * route-and-build in one step, pick a solid floor tile, and the one venue
 * fullness predicate. A leaf module (imports only person/facilities/types) so
 * `spawn.ts` and `visits.ts` can both use it without a cycle.
 */

/** Build a person on `route`, walking to `destX` at the end. Shared by
 *  tenant and staff spawns so the two can never drift field-by-field. */
export function makePerson(crowd: Crowd, tower: Tower, route: Route, destX: number): Person {
  const from = route.floors[0];
  const seed = (crowd.nextId * 2654435761) | 0;
  const person: Person = {
    id: crowd.nextId++,
    seed,
    // A route with no rides (same floor) goes straight to the stroll leg.
    state: route.shafts.length === 0 ? "toDest" : "toShaft",
    floor: from,
    fy: from,
    x: pickX(tower, from, seed),
    floors: route.floors,
    shafts: route.shafts,
    leg: 0,
    shaftId: route.shafts[0] ?? null,
    carIndex: null,
    wait: 0,
    age: 0,
    linger: 0,
    destX,
  };
  crowd.people.push(person);
  return person;
}

export function add(crowd: Crowd, tower: Tower, from: number, to: number): Person | null {
  const r = crowd.route(tower, from, to);
  // Only a null route is unreachable. A same-floor trip is a valid walk-only
  // route (`bfsRoute` returns `{ floors: [from], shafts: [] }` when
  // from === to), and `makePerson` already starts those in `state: "toDest"`,
  // so a meal origin and venue on the same floor still spawns and strolls.
  if (!r) return null;
  return makePerson(crowd, tower, r, pickX(tower, to, (crowd.nextId * 2654435761) | 0));
}

/** An actual built structural tile of a floor (so people stand on solid
 * ground, never in a gap between separate corridor runs). Falls back to a
 * sensible spot if the floor is bare. */
export function pickX(tower: Tower, floor: number, seed: number): number {
  const tiles: number[] = [];
  for (const u of tower.units) {
    if ((u.kind === "floor" || u.kind === "lobby") && u.floor === floor) {
      for (let i = 0; i < u.width; i++) tiles.push(u.x + i);
    }
  }
  if (tiles.length === 0) return 2 + (Math.abs(seed) % 40);
  return tiles[Math.abs(seed) % tiles.length];
}

/** A uniformly random tile inside the unit footprint, `inset` tiles off each
 *  edge. Unit widths come from the catalog in a live game, but saves persist
 *  widths verbatim, so BOTH bounds are clamped rather than trusted: `lo` can
 *  never pass the unit's rightmost tile, and `hi` can never fall below `lo`,
 *  so a hand-edited unit narrower than the insets collapses the range onto
 *  its rightmost tile and the result always stays within
 *  `[u.x, u.x + u.width - 1]`. Shared by the metro commuter spawns
 *  (venueTrips) and the metro-origin venue visitor (visits): both stamp an
 *  origin/destination x inside a station footprint, whose platform story has
 *  no floor tiles for pickX to find. */
export function insideX(crowd: Crowd, u: Unit, inset: number): number {
  const lo = Math.min(u.x + inset, u.x + u.width - 1);
  const hi = Math.max(lo, u.x + u.width - inset - 1);
  return crowd.rng.int(lo, hi);
}

/** The operational metro station whose platform story (`floor + 1`) is
 *  `platformFloor`, or undefined when none is. Metro is capped at one per
 *  tower, so at most one matches. Used to place a metro-origin visitor's
 *  return destX inside the station footprint, the same way the outbound origin
 *  x is stamped, since the platform story has no floor tiles for pickX. Does no
 *  rng draw, so a metro-less tower's spawn/motion stream is untouched. */
export function metroStationForPlatform(tower: Tower, platformFloor: number): Unit | undefined {
  return tower.units.find((u) => u.kind === "metro" && isOperational(u) && u.floor + 1 === platformFloor);
}

/** Spawn-side venue fullness filter, the mirror of the arrival-side clamps in
 *  `visits.ts` (beginDwell): census venues (population > 0) clamp at the
 *  catalog population, attendance venues at their attendance cap, anything
 *  else is uncapped. Keeping one predicate stops the two spawn paths (meals,
 *  visits) from drifting on the rule. */
export function venueHasRoom(u: Unit): boolean {
  const pop = FACILITIES[u.kind].population;
  if (pop > 0) return (u.customersIn ?? 0) < pop;
  const cap = attendanceCap(u.kind);
  return cap === undefined || (u.customersIn ?? 0) < cap;
}
