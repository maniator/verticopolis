import type { Clock } from "../Clock";
import type { Tower } from "../Tower";
import type { FacilityKind, Unit } from "../types";
import { isOperational, isTenanted } from "../types";
import {
  attendanceCap,
  isCommercialKind,
  isHotelKind,
  isOpenAt,
  syncAttendanceOccupants,
  FACILITIES,
} from "../facilities";
import type { Crowd } from "../Crowd";
import type { Person, SpawnFloors } from "./person";
import { dwellSecondsRange, visibleOccupants } from "./person";
import { matchesMealOriginKind } from "./meals";
import { add, venueHasRoom } from "./trips";

/**
 * Attendance visits: round-trip trips to the entertainment venues (cinema,
 * party hall, wedding hall) and the shared dwell-entry that registers a
 * round-tripper at its venue on arrival. The spawn side contributes options
 * to the same weighted pool the commute/meal flows use
 * ({@link pushVenueVisitOptions}); the arrival side ({@link beginDwell}) is
 * called from the motion state machine's `toDest` completion. Split from
 * `spawn.ts` / `motion.ts` for cohesion (and the file-size ceiling): this
 * module owns "people at venues", its siblings own cadence and physics.
 */

/** Arrival window for weekend wedding guests (canon: weddings happen on
 *  weekends only). Guests arriving across these hours plus the long wedding
 *  dwell overlap into a visible congregation at the hall. */
export const WEDDING_ARRIVAL_START = 11;
export const WEDDING_ARRIVAL_END = 14;

/**
 * The origin populations a venue visit can start from. `outside` is a street
 * visitor; the room kinds ride the meal round-trip origin accounting (a
 * specific room's visible occupancy thins while its person is out). Staff
 * kinds are deliberately absent: they are on shift, and their sanctioned
 * break is the meal system's job.
 */
export type VisitOrigin = "outside" | "condo" | "office" | "hotel";

/** Per-venue origin mix. Everyone can arrive from outside; residents and
 *  hotel guests go out to the movies and to parties (canon calls out hotel
 *  guests mingling at the party hall); office workers catch a matinee while
 *  the office is staffed (presence self-gates: `staffedOffices` empties at
 *  18:00 and on weekends). Wedding guests are invited from outside only. */
const VISIT_ORIGINS: Record<"cinema" | "partyHall" | "weddingHall", VisitOrigin[]> = {
  cinema: ["outside", "condo", "office", "hotel"],
  partyHall: ["outside", "condo", "hotel"],
  weddingHall: ["outside"],
};

/** The spawn-floor bin a room-origin draws from (see {@link spawnVenueVisit}). */
function originFloorsFor(origin: Exclude<VisitOrigin, "outside">, floors: SpawnFloors): number[] {
  switch (origin) {
    case "condo":
      return floors.condoFloors;
    case "office":
      return floors.staffedOffices;
    case "hotel":
      return floors.hotelFloors;
  }
}

/**
 * Contribute entertainment attendance-visit options: round trips from each
 * eligible origin population (see {@link VISIT_ORIGINS}) to an open cinema /
 * party hall, and weekend-midday wedding-guest trips to the wedding hall.
 * Additive over the shipped branch tree, exactly like the meal overlay; the
 * shared options pool and `MAX_PEOPLE` bound the whole thing. Venue floors
 * were binned by `spawnFloors` only while open (the wedding hall whenever
 * built), so an empty bin means "nothing to visit right now".
 */
export function pushVenueVisitOptions(
  crowd: Crowd,
  tower: Tower,
  clock: Clock,
  floors: SpawnFloors,
  options: Array<() => void>,
): void {
  const hour = clock.hour;
  const pushVisits = (kind: keyof typeof VISIT_ORIGINS, venueFloors: number[]) => {
    for (const origin of VISIT_ORIGINS[kind]) {
      // Room-origin options only exist while that population has floors to
      // draw from; `outside` always applies (the street never empties).
      if (origin !== "outside" && originFloorsFor(origin, floors).length === 0) continue;
      options.push(() => spawnVenueVisit(crowd, tower, kind, venueFloors, floors, hour, origin));
    }
  };
  const cinemas = floors.venuesByKind.cinema;
  if (cinemas?.length) {
    pushVisits("cinema", cinemas);
    // A blockbuster month draws a bigger crowd (canon): one extra option
    // contribution, aimed at the FLOORS that hold a blockbuster house so the
    // boost lands there and not uniformly across every cinema floor; the
    // candidate doubling in spawnVenueVisit then settles ties on a floor
    // holding both a blockbuster and a plain cinema.
    if (crowd.blockbusters.size > 0) {
      const bbFloors = blockbusterCinemaFloors(crowd, floors, cinemas);
      if (bbFloors.length) {
        options.push(() => spawnVenueVisit(crowd, tower, "cinema", bbFloors, floors, hour, "outside"));
      }
    }
  }
  const halls = floors.venuesByKind.partyHall;
  if (halls?.length) pushVisits("partyHall", halls);
  const weddings = floors.venuesByKind.weddingHall;
  if (
    weddings?.length &&
    clock.isWeekend &&
    hour >= WEDDING_ARRIVAL_START &&
    hour < WEDDING_ARRIVAL_END
  ) {
    pushVisits("weddingHall", weddings);
  }
}

/** The binned cinema floors holding a blockbuster house this month. Bounded by
 *  the 16-cinema build cap, and only consulted while blockbusters exist. */
function blockbusterCinemaFloors(crowd: Crowd, floors: SpawnFloors, cinemaFloors: number[]): number[] {
  const out: number[] = [];
  for (const f of cinemaFloors) {
    for (const u of floors.unitsByFloor.get(f) ?? []) {
      if (u.kind === "cinema" && crowd.blockbusters.has(u.id)) {
        out.push(f);
        break;
      }
    }
  }
  return out;
}

/**
 * Fire a single attendance round-trip to a venue of `kind`: pick a floor from
 * the bin, a concrete open venue with a free seat on it, and an origin (the
 * street door for `outside`, or an occupied room of the origin population),
 * then spawn the round-tripper. Arrival registers attendance
 * ({@link beginDwell}), the dwell runs the kind's window, and the return leg
 * walks the trip back. Any missing piece (no candidate venue, no in-room
 * origin person, no route) makes the call a no-op, exactly like the meal
 * outbound spawn.
 */
export function spawnVenueVisit(
  crowd: Crowd,
  tower: Tower,
  kind: FacilityKind,
  venueFloors: number[],
  floors: SpawnFloors,
  hour: number,
  origin: VisitOrigin,
): void {
  if (!isOpenAt(kind, hour)) return;
  const venueFloor = crowd.rng.pick(venueFloors);
  const candidates = (floors.unitsByFloor.get(venueFloor) ?? []).filter(
    (u) =>
      u.kind === kind &&
      // The wedding hall is functional-when-built (never tenanted); the
      // ticketed venues need a tenant, same gate as the meal venues.
      (kind === "weddingHall" ? isOperational(u) : isTenanted(u)) &&
      venueHasRoom(u),
  );
  if (candidates.length === 0) return;
  // Blockbuster houses draw double from the candidate pool, so the bigger
  // crowd lands at the cinema actually showing the film.
  const pool =
    kind === "cinema" && crowd.blockbusters.size > 0
      ? candidates.flatMap((u) => (crowd.blockbusters.has(u.id) ? [u, u] : [u]))
      : candidates;
  const venue = crowd.rng.pick(pool);
  // TODO(metro street door): `outside` resolves to the ground lobby (floor
  // 1), the tower's only street entrance today. Once the metro platform
  // lands as a second street door (PR #294), pick the entry point here
  // (ground lobby or an operational platform) so venue visitors also arrive
  // by train, matching the metro's "brings huge numbers of visitors" line.
  let originFloor = 1;
  let originRoom: Unit | undefined;
  if (origin !== "outside") {
    const originFloorBin = originFloorsFor(origin, floors);
    if (originFloorBin.length === 0) return;
    const roomFloor = crowd.rng.pick(originFloorBin);
    // A specific room of the origin population with someone still IN it,
    // exactly the meal spawn's origin rule (same bucket predicate, so the
    // two paths can never drift on what counts as "home").
    const rooms = (floors.unitsByFloor.get(roomFloor) ?? []).filter(
      (r) => matchesMealOriginKind(r, origin) && visibleOccupants(r) > 0,
    );
    if (rooms.length === 0) return;
    originRoom = crowd.rng.pick(rooms);
    originFloor = roomFloor;
  }
  const spawned = add(crowd, tower, originFloor, venueFloor);
  if (!spawned) return;
  spawned.destX = crowd.rng.int(venue.x, venue.x + venue.width - 1);
  spawned.mealVenueId = venue.id;
  if (originRoom) {
    // Room-origin visitors ride the meal round-trip origin accounting: the
    // room's visible occupancy thins while they are out, and every despawn
    // path balances the decrement through finish().
    spawned.originUnitId = originRoom.id;
    originRoom.outForMeal = (originRoom.outForMeal ?? 0) + 1;
    tower.bumpMealOverlayRevision();
  }
}

/**
 * A round-tripper's outbound arrival: transition into the stationary dwell
 * (`dwelling` state) and register the person at their venue. Called from the
 * motion state machine when a `toDest` walk completes for a person carrying
 * an origin room or a venue intent; the return leg is self-scheduled when the
 * dwell timer expires (motion's `dwelling` case).
 */
export function beginDwell(crowd: Crowd, tower: Tower, p: Person): void {
  p.state = "dwelling";
  p.linger = 0;
  // Reset the give-up age so the outbound trip's accumulated seconds do not
  // eat into the return-leg patience budget once the return transition
  // fires. That transition ALSO resets `p.age` when it succeeds; this reset
  // is the "even if we later ghost or route-fail" belt-and-braces.
  p.age = 0;
  // Track this customer at their venue for the live census. The venue was
  // stamped at spawn time (mealVenueId, with destX inside its footprint), so
  // the count attaches to the exact venue this person is at even when the
  // floor holds several rooms. O(1): getUnit uses an internal Map. A venue
  // bulldozed mid-trip resolves to undefined and the person simply dwells
  // uncounted.
  const venueUnit = p.mealVenueId === undefined ? undefined : tower.getUnit(p.mealVenueId);
  // Dwell duration by venue kind: the meal window for food venues (and the
  // bulldozed-venue fallback), the longer attendance window for
  // entertainment venues (a showing, a party, a wedding). Same single RNG
  // draw as before the attendance flow existed, so meal-only towers keep a
  // byte-identical stream.
  const dwell = dwellSecondsRange(venueUnit?.kind);
  p.dwellSecondsLeft = crowd.rng.int(dwell.min, dwell.max);
  // Census venues (commercial, population > 0) clamp at the catalog
  // population: that value is the venue's advertised customer capacity AND
  // its census contribution. The capacity clamp is the arrival-side half of
  // the spawn-side fullness filter (venueHasRoom): several people can be en
  // route before any of them arrives, so the count could otherwise pass
  // capacity anyway. An over-capacity arrival dwells uncounted (venueUnitId
  // stays unset, so finish() will not decrement).
  const cap = venueUnit ? attendanceCap(venueUnit.kind) : undefined;
  if (
    venueUnit &&
    isCommercialKind(venueUnit.kind) &&
    FACILITIES[venueUnit.kind].population > 0 &&
    (venueUnit.customersIn ?? 0) < FACILITIES[venueUnit.kind].population
  ) {
    p.venueUnitId = venueUnit.id;
    venueUnit.customersIn = (venueUnit.customersIn ?? 0) + 1;
    // Origin split for the rating census: hotel guests drop out of the
    // 4-star-plus census, so a guest eating here must not re-enter it
    // through the venue tally. Flag the person so the decrement in finish()
    // mirrors exactly even if the origin room is bulldozed while they eat.
    const originUnitRoom = p.originUnitId === undefined ? undefined : tower.getUnit(p.originUnitId);
    if (originUnitRoom && isHotelKind(originUnitRoom.kind)) {
      p.countedHotelGuest = true;
      venueUnit.hotelCustomersIn = (venueUnit.hotelCustomersIn ?? 0) + 1;
    }
    tower.bumpMealOverlayRevision();
  } else if (
    venueUnit &&
    cap !== undefined &&
    isOperational(venueUnit) &&
    (venueUnit.customersIn ?? 0) < cap
  ) {
    // Attendance venue (cinema / party hall / wedding hall): the tally
    // clamps at the catalog attendance cap, fills the occupancy-gated
    // interior art through the occupants mirror, and is census-inert
    // (population 0 keeps censusCount's gate closed), so there is no
    // hotel-origin split to track here. Over-cap arrivals attend uncounted,
    // mirroring the census venues' clamp above. The isOperational recheck
    // covers the ride: a venue that caught fire (or was gutted) after the
    // spawn-side gate passed must not have an audience stamped onto the
    // ruin; the visitor simply dwells uncounted and leaves.
    p.venueUnitId = venueUnit.id;
    venueUnit.customersIn = (venueUnit.customersIn ?? 0) + 1;
    syncAttendanceOccupants(venueUnit);
    tower.bumpMealOverlayRevision();
  }
}
