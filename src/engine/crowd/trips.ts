import type { Tower } from "../Tower";
import type { Unit } from "../types";
import { attendanceCap, FACILITIES } from "../facilities";
import { segmentsOf } from "../tower/segments";
import type { Crowd } from "../Crowd";
import type { Person, Route } from "./person";

/**
 * The low-level trip primitives shared by every spawn path (commutes, meal
 * round-trips, attendance visits, staff dispatch): build a person on a route,
 * route-and-build in one step, pick a solid floor tile, and the one venue
 * fullness predicate. Imports only person/facilities/types plus the pure segment
 * geometry (tower/segments, itself a leaf), so `spawn.ts` and `visits.ts` can
 * both use it without a cycle.
 */

/** Build a person on `route`, walking to `destX` at the end. Shared by
 *  tenant and staff spawns so the two can never drift field-by-field. */
export function makePerson(
  crowd: Crowd,
  tower: Tower,
  route: Route,
  destX: number,
  originX?: number,
): Person {
  const from = route.floors[0];
  const seed = (crowd.nextId * 2654435761) | 0;
  // Place the sprite on the route's ORIGIN segment (#647): the route boards from
  // `originX`'s run, so the figure must start there too, or on a split floor it
  // spawns on the wrong run, is edge-clamped by the walk guard, and boards a shaft
  // across the gap it cannot actually reach. `pickXInSegment` picks a seeded tile
  // inside that run; on a gap-free floor the run spans the whole floor, so it
  // returns the exact `pickX` tile and the placement is byte-identical.
  const originSpawnX =
    originX !== undefined ? pickXInSegment(tower, from, seed, originX) : pickX(tower, from, seed);
  const person: Person = {
    id: crowd.nextId++,
    seed,
    // A route with no rides (same floor) goes straight to the stroll leg.
    state: route.shafts.length === 0 ? "toDest" : "toShaft",
    floor: from,
    fy: from,
    x: originSpawnX,
    floors: route.floors,
    originFloor: from,
    shafts: route.shafts,
    leg: 0,
    shaftId: route.shafts[0] ?? null,
    carIndex: null,
    wait: 0,
    tripWait: 0,
    age: 0,
    linger: 0,
    destX,
  };
  crowd.people.push(person);
  return person;
}

export function add(
  crowd: Crowd,
  tower: Tower,
  from: number,
  to: number,
  fromX?: number,
  toX?: number,
): Person | null {
  // Route from the exact tiles the spawned person will stand on, so the trip's
  // origin/destination SEGMENTS match where the sprite is placed (and a trip
  // whose destination segment is unreachable, e.g. across a gap, null-routes and
  // no one spawns into the void). When a caller names an exact origin/destination
  // tile (a meal origin unit, a venue), route to THAT tile's segment so the rider
  // alights on the destination's own run and never has to walk across a gap to
  // reach it; otherwise fall back to the seed-derived representative tile. `seed`
  // is the same value makePerson derives its origin x from, so an unqualified call
  // lines the tiles up exactly and draws no rng: a gap-free tower is
  // byte-identical (a floor is one segment, so an explicit x resolves to the same
  // node the seed tile does).
  const seed = (crowd.nextId * 2654435761) | 0;
  const routeFromX = fromX ?? pickX(tower, from, seed);
  const routeToX = toX ?? pickX(tower, to, seed);
  const r = crowd.route(tower, from, to, routeFromX, routeToX);
  // Only a null route is unreachable. A same-floor trip is a valid walk-only
  // route (`bfsRoute` returns `{ floors: [from], shafts: [] }` when the origin
  // and destination share a segment), and `makePerson` already starts those in
  // `state: "toDest"`, so a meal origin and venue on the same segment still
  // spawns and strolls.
  if (!r) return null;
  // Thread the routed origin tile through so the sprite spawns on the same run the
  // route boards from (byte-identical on a gap-free floor: one segment, so
  // `routeFromX` and the seed tile resolve to the same node).
  return makePerson(crowd, tower, r, routeToX, routeFromX);
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

/** A solid floor tile within the contiguous structural run that contains
 *  `(floor, anchorX)`, chosen with the same seeded index {@link pickX} uses. It
 *  keeps a placed sprite on the anchor's OWN segment, so a rider strolling to it
 *  never crosses a gap to a tile on another run of a split floor. On a gap-free
 *  floor the run spans the whole floor, so the tile list is exactly pickX's list
 *  in the same order and this returns the identical tile (byte-identical). Falls
 *  back to the anchor tile itself when the anchor sits over a bare gap. */
export function pickXInSegment(tower: Tower, floor: number, seed: number, anchorX: number): number {
  let lo = anchorX;
  let hi = anchorX;
  for (const [start, end] of segmentsOf(tower, floor)) {
    if (anchorX < start) break; // runs are sorted, so no later run can contain it
    if (anchorX <= end) {
      lo = start;
      hi = end;
      break;
    }
  }
  const tiles: number[] = [];
  for (const u of tower.units) {
    if ((u.kind === "floor" || u.kind === "lobby") && u.floor === floor) {
      for (let i = 0; i < u.width; i++) {
        const x = u.x + i;
        if (x >= lo && x <= hi) tiles.push(x);
      }
    }
  }
  if (tiles.length === 0) return anchorX;
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

/** The metro station whose platform story (`floor + 1`) is `platformFloor`, or
 *  undefined when none is. Metro is capped at one per tower, so at most one
 *  matches. Used to place a metro-origin visitor's return destX inside the
 *  station footprint, the same way the outbound origin x is stamped, since the
 *  platform story has no floor tiles for pickX. Deliberately NOT gated on
 *  operational state: the station's footprint still physically exists when it
 *  catches fire or is gutted, so a visitor who rode in and is returning to a
 *  now-broken platform must still land on the deck, not the lot-edge fallback.
 *  The outbound origin gate (pickOutsideStreetDoor) stays operational-only; a
 *  visitor never originates from a broken metro. Does no rng draw, so a
 *  metro-less tower's spawn/motion stream is untouched. */
export function metroStationForPlatform(tower: Tower, platformFloor: number): Unit | undefined {
  // A metro platform is always a basement story (the station is a below-ground
  // module, so its middle deck sits below floor 1). Ground-lobby returns pass
  // platformFloor === 1, the common case; short-circuit them before the linear
  // scan over every unit (which includes each structural tile). This changes
  // nothing behaviorally: a floor >= 1 never matched a metro platform anyway,
  // so it still falls through to pickX exactly as before.
  if (platformFloor >= 1) return undefined;
  return tower.units.find((u) => u.kind === "metro" && u.floor + 1 === platformFloor);
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
