import type { Tower } from "../Tower";
import type { Transport } from "../types";
import { isStaffOnlyTransport, isStaffTransportKind } from "../facilities";
import type { Crowd } from "../Crowd";
import type { Route, ElevatorCalls } from "./person";

/**
 * Transport routing for the crowd, pulled out of `Crowd.ts` as friend functions
 * that take the {@link Crowd} instance. They read and cache the adjacency graphs
 * on the crowd (`adj`/`adjRev`, `staffAdj`/`staffAdjRev`) and, for elevator
 * calls, scan `crowd.people`. Behavior is unchanged; the class keeps thin
 * `route` / `staffRoute` / `elevatorCalls` methods that delegate here.
 */

type AdjGraph = Map<number, { f: number; shaft: number }[]>;

/**
 * BFS over the transport network for the fewest-transfer route. Each edge is
 * one transport ride, and, per the original ("Sims will only take two methods
 * of transportation to their destination"), a trip is capped at TWO rides
 * (i.e. one sky-lobby transfer). A destination needing 3+ rides returns null,
 * so a badly-zoned tower's commuters give up rather than teleporting there.
 */
const MAX_RIDES = 2;

/**
 * The floor → one-ride-reachable-floors graph, built from elevator stops.
 * It only changes when the tower's transports change, so we cache it by
 * {@link Tower.revision} and rebuild lazily instead of on every spawn.
 */
export function adjacency(crowd: Crowd, tower: Tower): AdjGraph {
  if (crowd.adj && crowd.adjRev === tower.revision) return crowd.adj;
  // Staff-only transports (service elevators) carry no tenants or visitors:
  // that's the whole point of building one.
  crowd.adj = buildAdjacency(tower, tower.transports, (t) => !isStaffOnlyTransport(t.kind));
  crowd.adjRev = tower.revision;
  return crowd.adj;
}

/** The staff stop-graph: service elevators plus walkable links (stairs and
 *  escalators), never the passenger elevators. Housekeepers route over
 *  this, using the SAME kind predicate as Tower.staffConnected so routing
 *  and reachability can never disagree. Staff-only elevators are listed
 *  first so equal-leg route ties break toward RIDING the service elevator
 *  rather than climbing stairs: housekeepers ride, and the player sees the
 *  shaft they built actually working. */
export function staffAdjacency(crowd: Crowd, tower: Tower): AdjGraph {
  if (crowd.staffAdj && crowd.staffAdjRev === tower.revision) return crowd.staffAdj;
  const serviceFirst = [...tower.transports].sort(
    (a, b) => Number(isStaffOnlyTransport(b.kind)) - Number(isStaffOnlyTransport(a.kind)),
  );
  crowd.staffAdj = buildAdjacency(tower, serviceFirst, (t) => isStaffTransportKind(t.kind));
  crowd.staffAdjRev = tower.revision;
  return crowd.staffAdj;
}

export function buildAdjacency(
  tower: Tower,
  transports: readonly Transport[],
  include: (t: Transport) => boolean,
): AdjGraph {
  const adj: AdjGraph = new Map();
  for (const t of transports) {
    if (!include(t)) continue;
    // Elevators carry riders in cars; stairs/escalators are walked (a
    // "climbing" leg, no car). Both are real routing edges now, so short
    // hops travel on foot and BFS still prefers a single long elevator ride
    // (one transfer) over many stair flights for tall trips.
    const stops = tower.stopsOf(t);
    for (const a of stops) {
      let list = adj.get(a);
      if (!list) adj.set(a, (list = []));
      for (const b of stops) if (b !== a) list.push({ f: b, shaft: t.id });
    }
  }
  return adj;
}

export function route(crowd: Crowd, tower: Tower, from: number, to: number): Route | null {
  return bfsRoute(adjacency(crowd, tower), from, to, MAX_RIDES);
}

/** Route over the STAFF network (service elevators / stairs / escalators).
 *  Staff aren't bound by the two-ride comfort rule: the search is UNCAPPED
 *  (the BFS `seen` set terminates it), so it agrees with what
 *  Tower.staffConnected calls reachable: both walk the same
 *  isStaffTransportKind/stopsOf graph. (Parallel implementations: if they
 *  ever drift, spawnStaff reports "no-route" so dispatch can surface it
 *  instead of retrying silently.) */
export function staffRoute(crowd: Crowd, tower: Tower, from: number, to: number): Route | null {
  return bfsRoute(staffAdjacency(crowd, tower), from, to, Infinity);
}

/** NOTE: edge ORDER is a contract: within a BFS level the first-listed
 *  edge wins (seen is marked on enqueue), which is how staffAdjacency's
 *  service-first ordering expresses the routing preference. Don't replace
 *  this with a priority frontier or Set-deduped adjacency without keeping
 *  that tie-break. */
export function bfsRoute(
  adj: AdjGraph,
  from: number,
  to: number,
  maxRides: number,
): Route | null {
  if (from === to) return { floors: [from], shafts: [] };
  const prev = new Map<number, { f: number; shaft: number }>();
  const seen = new Set<number>([from]);
  let frontier = [from];
  let rides = 0;
  while (frontier.length && rides < maxRides) {
    rides++;
    const next: number[] = [];
    for (const f of frontier) {
      for (const edge of adj.get(f) ?? []) {
        if (seen.has(edge.f)) continue;
        seen.add(edge.f);
        prev.set(edge.f, { f, shaft: edge.shaft });
        if (edge.f === to) {
          // Reconstruct.
          const floors = [to];
          const shafts: number[] = [];
          let cur = to;
          while (cur !== from) {
            const p = prev.get(cur)!;
            floors.push(p.f);
            shafts.push(p.shaft);
            cur = p.f;
          }
          floors.reverse();
          shafts.reverse();
          return { floors, shafts };
        }
        next.push(edge.f);
      }
    }
    frontier = next;
  }
  return null;
}

/** Live elevator calls from real people (tenants AND staff), for the
 *  dispatch. Two kinds, exactly like a real lift: `hall` (shaftId → floor →
 *  waiter count, the landing button) and `cab` (shaftId → carIndex → floors
 *  a rider aboard that car needs, the buttons inside the cab). Without
 *  these the drawn commuters exist only in the statistical demand model's
 *  blind spot: cars glide past waiters, and a rider is hauled around until
 *  they despawn because their floor is never this particular car's stop.
 *  Cab stops must be per-car: a rider can only alight from the car they're
 *  in, so their floor being "handled" by some other car delivers nothing.
 *  Staff walking toward a staff-only shaft already raise a hall call so the
 *  car pre-positions instead of retreating to idle just before they arrive
 *  (a walk toward stairs/escalators never calls a car). */
export function elevatorCalls(crowd: Crowd, tower: Tower): ElevatorCalls {
  const hall = new Map<number, Map<number, number>>();
  const cab = new Map<number, Map<number, Set<number>>>();
  const bump = (shaftId: number, floor: number) => {
    let floors = hall.get(shaftId);
    if (!floors) hall.set(shaftId, (floors = new Map()));
    floors.set(floor, (floors.get(floor) ?? 0) + 1);
  };
  for (const p of crowd.people) {
    if (p.shaftId == null) continue;
    if (p.state === "waiting") {
      bump(p.shaftId, p.floor);
    } else if (p.state === "riding" && p.carIndex != null) {
      // Guard the leg lookup: a state-machine hiccup must not leak an
      // undefined floor into the dispatch's call set.
      const dest = p.floors[p.leg + 1];
      if (dest === undefined) continue;
      let cars = cab.get(p.shaftId);
      if (!cars) cab.set(p.shaftId, (cars = new Map()));
      let floors = cars.get(p.carIndex);
      if (!floors) cars.set(p.carIndex, (floors = new Set()));
      floors.add(dest);
    } else if (p.staff && p.state === "toShaft") {
      const shaft = tower.getTransport(p.shaftId);
      if (shaft && isStaffOnlyTransport(shaft.kind)) bump(p.shaftId, p.floor);
    }
  }
  return { hall, cab };
}
