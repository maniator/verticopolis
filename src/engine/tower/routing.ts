import type { Tower } from "../Tower";
import { FACILITIES, censusCount, isHotelKind, isStaffOnlyTransport, isStaffTransportKind } from "../facilities";
import { isOperational, isPresent } from "../types";
import type { Facility, Unit } from "../types";

/** Reachability / staff-network / parking routing for the Tower, as friend
 * functions taking the {@link Tower} instance. Extracted from `Tower.ts`. */

/** The full set of floors reachable from the ground lobby, memoized per revision. */
export function servedFloors(tower: Tower): Set<number> {
  if (tower.servedRev === tower.revision) return tower.servedSet;
  const reachable = new Set<number>([1]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tower.transports) {
      // Service elevators are staff-only (canon): tenants and visitors never
      // ride them, so they don't make a floor reachable. Staff travel is the
      // separate {@link staffConnected} network.
      if (isStaffOnlyTransport(t.kind)) continue;
      let connects = false;
      for (let fl = t.bottom; fl <= t.top; fl++) {
        if (tower.stopsAt(t, fl) && reachable.has(fl)) {
          connects = true;
          break;
        }
      }
      if (connects) {
        for (let fl = t.bottom; fl <= t.top; fl++) {
          if (tower.stopsAt(t, fl) && !reachable.has(fl)) {
            reachable.add(fl);
            changed = true;
          }
        }
      }
    }
  }
  tower.servedSet = reachable;
  tower.servedRev = tower.revision;
  return reachable;
}

/**
 * A floor is "served" if a chain of transports connects it to the ground
 * lobby (floor 1). Transports link via the floors they actually STOP at, so
 * an express that skips a floor does not serve it (it only passes through).
 * O(1) after the first call per revision, see {@link servedFloors}.
 */
export function isFloorServed(tower: Tower, floor: number): boolean {
  if (floor === 1) return true;
  return tower.servedFloors().has(floor);
}

/** The full set of ground-connected floors (memoized per revision). Read-only
 * view for the spatial congestion model. */
export function servedFloorSet(tower: Tower): ReadonlySet<number> {
  return tower.servedFloors();
}

/**
 * Label every floor touched by a staff-capable transport (service elevators,
 * stairs, escalators, never passenger elevators) with a connected-component id.
 * Housekeepers travel this network to reach dirty rooms, exactly as in the
 * original where staff ride the service elevator while guests take the
 * passenger ones. Floors with no staff transport get no label: staff there
 * can only work their own floor.
 */
export function staffComponents(tower: Tower): Map<number, number> {
  if (tower.staffRev === tower.revision) return tower.staffComp;
  const comp = new Map<number, number>();
  const relabel = (from: number, to: number) => {
    for (const [f, c] of comp) if (c === from) comp.set(f, to);
  };
  let next = 0;
  for (const t of tower.transports) {
    if (!isStaffTransportKind(t.kind)) continue;
    const stops = tower.stopsOf(t);
    if (stops.length < 2) continue;
    // Merge every component this transport touches into one.
    let id: number | undefined;
    for (const f of stops) {
      const c = comp.get(f);
      if (c === undefined) continue;
      if (id === undefined) id = c;
      else if (c !== id) relabel(c, id);
    }
    if (id === undefined) id = next++;
    for (const f of stops) comp.set(f, id);
  }
  tower.staffComp = comp;
  tower.staffRev = tower.revision;
  return comp;
}

/** True if staff stationed on floor `a` can reach floor `b` (same floor, or
 *  connected through service elevators / stairs / escalators). */
export function staffConnected(tower: Tower, a: number, b: number): boolean {
  if (a === b) return true;
  const comp = tower.staffComponents();
  const ca = comp.get(a);
  return ca !== undefined && ca === comp.get(b);
}

/**
 * Count parking SPACES that actually function, i.e. connect to a Parking Ramp
 * through a contiguous chain of parking/ramp tiles (canon: "spaces must be
 * touching the ramp or another space"). Flood-fills from every operational ramp
 * over adjacent parking/ramp tiles (horizontally along a floor, and vertically
 * only across a ramp, cars change floors through ramps); a space with no path
 * back to a ramp is a dead X.
 */
export function functionalParkingSpots(tower: Tower): number {
  return tower.functionalParkingSet().size;
}

/**
 * The set of parking-SPACE unit ids that function, i.e. chain back to a ramp
 * (see {@link functionalParkingSpots}). A space whose id is absent is dead (no
 * relief). NOT memoized: it depends on unit STATE (construction/fire), and
 * those transitions don't bump {@link revision} (finishConstruction / the fire
 * handlers mutate `state` directly), so a revision cache would go stale. The
 * flood-fill is bounded by the parking region with O(1) `roomAt`, so it's cheap
 * enough for the callers (inspector, economy, and a once-per-sync render read).
 */
export function functionalParkingSet(tower: Tower): ReadonlySet<number> {
  const usable = (u?: Unit): boolean =>
    !!u && (u.kind === "parking" || u.kind === "parkingRamp") && isOperational(u);
  const stack: [number, number][] = [];
  for (const u of tower.units) {
    if (u.kind === "parkingRamp" && isOperational(u)) {
      for (let i = 0; i < u.width; i++) stack.push([u.floor, u.x + i]);
    }
  }
  const visited = new Set<string>();
  const reached = new Set<number>(); // parking-unit ids connected to a ramp
  while (stack.length) {
    const [f, x] = stack.pop()!;
    const key = `${f}:${x}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const u = tower.roomAt(f, x);
    if (!usable(u)) continue;
    if (u!.kind === "parking") reached.add(u!.id);
    // Horizontal chaining is always allowed (spaces touch along a floor).
    stack.push([f, x - 1], [f, x + 1]);
    // Cars only change floors through a RAMP, so a vertical step is allowed
    // only from a ramp tile, two parking spaces stacked with no ramp between
    // them do NOT connect (they'd be dead Xs in the original).
    if (u!.kind === "parkingRamp") stack.push([f - 1, x], [f + 1, x]);
  }
  return reached;
}

export function facilityOf(_tower: Tower, unit: Unit): Facility {
  return FACILITIES[unit.kind];
}

export function totalPopulation(tower: Tower): number {
  let pop = 0;
  for (const u of tower.units) {
    if (!isPresent(u)) continue;
    // Commercial venues count their live customer tally (meal round-trippers
    // currently eating there); everyone else uses the catalog occupant count.
    // censusCount owns that rule (cinema stays out via its population = 0).
    pop += censusCount(u);
  }
  return pop;
}

/**
 * Venue-associated meal customers currently out of their home unit: the sum of
 * the transient `outForMeal` overlay across present units. These are the
 * workers/residents who left an office, condo, or hotel room for a meal round-
 * trip and are now at (or traveling to/from) a venue. Reading the derived
 * overlay counts each round-tripper exactly once (spawn increments, despawn
 * decrements a single origin), so it never double-counts and needs no scan of
 * the crowd's Person array. Mirrors {@link totalPopulation}: gated on
 * `isPresent` and a pure read with no side effects.
 *
 * `outForMeal` is a `Unit` field this class already owns, so the count lives
 * here (single source of truth); {@link Crowd.mealAssociatedPopulation} is the
 * meal-domain seam that delegates to it. `opts.excludeHotelOrigin` drops
 * customers whose origin is a hotel room, so the star census can hold the canon
 * "hotel guests stop counting at 4 stars" rule for meal customers too.
 */
export function associatedPopulation(tower: Tower, opts?: { excludeHotelOrigin?: boolean }): number {
  const excludeHotel = opts?.excludeHotelOrigin ?? false;
  let pop = 0;
  for (const u of tower.units) {
    const out = u.outForMeal ?? 0;
    if (out <= 0 || !isPresent(u)) continue;
    if (excludeHotel && isHotelKind(u.kind)) continue;
    pop += out;
  }
  return pop;
}
