import type { Tower } from "../Tower";
import type { Clock } from "../Clock";
import type { Transport, Unit } from "../types";
import { isElevatorKind, isHotelKind, isCommercialKind, FACILITIES } from "../facilities";
import type { Crowd } from "../Crowd";
import type { Person } from "./person";
import {
  WALK_SPEED,
  CAR_CAPACITY,
  EAT_SECONDS_MIN,
  EAT_SECONDS_MAX,
  STRESS_WAIT,
  GIVE_UP,
  STAFF_GIVE_UP,
  RIDE_SECONDS_PER_FLOOR,
} from "./person";
import { pickX } from "./spawn";

/**
 * The per-frame crowd physics (spawn cadence aside), pulled out of `Crowd.ts`
 * as friend functions that take the {@link Crowd} instance. They mutate the
 * shared `crowd.people` array and `crowd.carRiders` / `crowd.frustration` /
 * `crowd.staffCount` / `crowd.staffDone` state, and call back into the class
 * for spawning (`crowd.spawn`), routing (`crowd.route`), and floor placement
 * (`crowd.pickX`). Behavior is unchanged; the class keeps thin `update` /
 * `advance` methods that delegate here.
 */

/** At fast game speeds a single tick can span tens of crowd-seconds, but the
 *  person state machine only makes ~one transition per pass (one boarding
 *  window, one alight check) while the give-up clock charges the full span,
 *  so long trips die by quantization, not by bad service. Sub-stepping makes
 *  coarse ticks simulate the way fine ones do. */
const SUB_STEP = 5;

export function update(crowd: Crowd, dtSec: number, tower: Tower, clock: Clock): void {
  crowd.spawn(dtSec, tower, clock);
  while (dtSec > SUB_STEP) {
    advance(crowd, SUB_STEP, tower);
    dtSec -= SUB_STEP;
  }
  advance(crowd, dtSec, tower);
}

/** Advance every person by a (short) time slice: see SUB_STEP. */
export function advance(crowd: Crowd, dtSec: number, tower: Tower): void {
  let frustrated = 0;
  let travelling = 0;
  for (const p of crowd.people) {
    p.age += dtSec;
    // Give up if the journey drags on too long: a fed-up traveller who
    // leaves rather than riding forever toward a floor no car will serve.
    // (Staff are on the clock and wait much longer; a failed job is handed
    // back to housekeeping dispatch to retry.) The budget also scales with
    // the trip's ride distance so a legitimate long haul up a tall tower
    // isn't culled mid-ride.
    const patience = (p.staff ? STAFF_GIVE_UP : GIVE_UP) + tripFloors(p) * RIDE_SECONDS_PER_FLOOR;
    // `eating` is a stationary meal pause at the venue (PR A); it is neither
    // "travelling" nor a service the give-up valve should cull. Excluding it
    // here keeps a long-tail eater (up to EAT_SECONDS_MAX plus their outbound
    // trip's age accumulation) from being finished mid-eat and mis-flagged as
    // a frustrated commuter, which would pollute the crowd stress signal AND
    // skip the return leg the round-trip design promises. See review Edge #1.
    if (p.age > patience && p.state !== "toDest" && p.state !== "eating" && p.state !== "done") {
      if (!p.staff) {
        frustrated++;
        travelling++;
      }
      finish(crowd, p, tower);
      continue;
    }
    step(crowd, p, dtSec, tower);
    // Staff never count toward tenant stress: a housekeeper waiting for the
    // service elevator is payroll, not an unhappy customer.
    if (!p.staff && (p.state === "waiting" || p.state === "riding" || p.state === "toShaft" || p.state === "climbing")) {
      travelling++;
      if (p.wait > STRESS_WAIT) frustrated++;
    }
  }
  // Smooth the frustration signal the sim reads for satisfaction.
  const target = travelling > 0 ? frustrated / travelling : 0;
  crowd.frustration += (target - crowd.frustration) * Math.min(1, dtSec * 0.5);

  crowd.people = crowd.people.filter((p) => p.state !== "done");
}

function shaftOf(tower: Tower, id: number | null): Transport | undefined {
  return id == null ? undefined : tower.getTransport(id);
}

/** Total floors this trip covers across all its legs. */
function tripFloors(p: Person): number {
  let n = 0;
  for (let i = 0; i + 1 < p.floors.length; i++) n += Math.abs(p.floors[i + 1] - p.floors[i]);
  return n;
}

function step(crowd: Crowd, p: Person, dt: number, tower: Tower): void {
  switch (p.state) {
    case "toShaft": {
      const shaft = shaftOf(tower, p.shaftId);
      if (!shaft) return finish(crowd, p, tower);
      const targetX = shaft.x + shaft.width / 2;
      if (walkTo(p, targetX, dt)) {
        // Elevators are boarded (wait for a car); stairs/escalators are
        // simply climbed on foot.
        if (isElevatorKind(shaft.kind)) {
          p.state = "waiting";
          p.wait = 0;
        } else {
          p.state = "climbing";
          p.wait = 0; // climbing is on-foot, never "waiting": don't inflate stress
        }
      }
      break;
    }
    case "climbing": {
      const shaft = shaftOf(tower, p.shaftId);
      if (!shaft) return finish(crowd, p, tower);
      const dest = p.floors[p.leg + 1];
      const dir = Math.sign(dest - p.fy) || 1;
      // Escalators carry you a little faster than trudging up stairs.
      const speed = shaft.kind === "escalator" ? 1.3 : 0.85; // floors/sec
      p.fy += dir * speed * dt;
      p.x = shaft.x + shaft.width / 2;
      if ((dir > 0 && p.fy >= dest) || (dir < 0 && p.fy <= dest)) {
        p.fy = dest;
        p.floor = dest;
        p.leg++;
        if (p.leg >= p.shafts.length) {
          p.state = "toDest";
        } else {
          p.shaftId = p.shafts[p.leg];
          p.state = "toShaft";
        }
      }
      break;
    }
    case "waiting": {
      p.wait += dt;
      const shaft = shaftOf(tower, p.shaftId);
      if (!shaft) return finish(crowd, p, tower);
      // Board a car of this shaft that's stopped at our floor with room.
      for (let i = 0; i < shaft.cars; i++) {
        if (Math.abs(shaft.carPositions[i] - p.floor) > 0.25) continue;
        const key = `${shaft.id}:${i}`;
        const n = crowd.carRiders.get(key) ?? 0;
        if (n >= CAR_CAPACITY) continue;
        crowd.carRiders.set(key, n + 1);
        p.carIndex = i;
        p.state = "riding";
        // The call is served: clear the wait so a once-slow pickup doesn't
        // keep counting toward frustration for the whole ride (and doesn't
        // leave the figure red-"!" while strolling off at the destination).
        p.wait = 0;
        break;
      }
      break;
    }
    case "riding": {
      const shaft = shaftOf(tower, p.shaftId);
      // The car can vanish from under a rider: the shaft bulldozed, or the
      // player trimming the car count (Tower.setCars shrinks carPositions).
      // Either way, step off and move on rather than riding a phantom car.
      if (!shaft || p.carIndex == null || p.carIndex >= shaft.carPositions.length) {
        return finish(crowd, p, tower);
      }
      const pos = shaft.carPositions[p.carIndex];
      const prev = p.fy;
      p.fy = pos;
      p.x = shaft.x + shaft.width / 2;
      const dest = p.floors[p.leg + 1];
      // Arrived if the car is at the floor, or passed it between samples
      // (cars move up to ~a floor per step at coarse ticks, so a pure
      // proximity check can sail a rider straight past their stop). Never
      // alight at a floor the shaft no longer stops at (express skip-floors
      // reconfigured mid-ride): ride on until the give-up valve resolves it.
      const arrived = Math.abs(pos - dest) < 0.2 || (prev - dest) * (pos - dest) <= 0;
      if (arrived && tower.stopsAt(shaft, dest)) {
        // Arrived at this leg's floor: step off.
        releaseSeat(crowd, p);
        p.floor = dest;
        p.fy = dest;
        p.leg++;
        if (p.leg >= p.shafts.length) {
          p.state = "toDest";
        } else {
          p.shaftId = p.shafts[p.leg];
          p.state = "toShaft";
        }
      }
      break;
    }
    case "toDest": {
      // Stroll to a spot on the destination floor, linger, then leave.
      if (walkTo(p, p.destX, dt)) {
        p.linger += dt;
        if (p.linger > 2) {
          // Meal round-tripper: outbound arrival transitions to a stationary
          // `eating` pause, then a return trip. `returning` distinguishes
          // the two `toDest` arrivals a round-tripper has; without it, the
          // return arrival would loop back into `eating` forever.
          if (p.originUnitId !== undefined && !p.returning) {
            p.state = "eating";
            p.linger = 0;
            // Reset the give-up age so the outbound trip's accumulated seconds
            // do not eat into the return-leg patience budget once
            // `transitionToReturn` fires. `transitionToReturn` ALSO resets
            // `p.age` when it succeeds; this reset is the "even if we later
            // ghost or route-fail" belt-and-braces.
            p.age = 0;
            p.eatSecondsLeft = crowd.rng.int(EAT_SECONDS_MIN, EAT_SECONDS_MAX);
            // Track this customer at their venue for the live census. The
            // venue was stamped at spawn time (mealVenueId, with destX inside
            // its footprint), so the count attaches to the exact venue this
            // person eats at even when the floor holds several rooms. O(1):
            // getUnit uses an internal Map. A venue bulldozed mid-trip
            // resolves to undefined and the person simply eats uncounted.
            // Gate on population > 0 because cinema is a lateNight meal venue
            // but carries population = 0 and must not count toward the census.
            // The capacity clamp is the arrival-side half of the spawn-side
            // fullness filter: several eaters can be en route before any of
            // them arrives, so the count could otherwise pass the catalog
            // capacity anyway. An over-capacity arrival eats uncounted
            // (venueUnitId stays unset, so finish() will not decrement).
            const venueUnit = p.mealVenueId === undefined ? undefined : tower.getUnit(p.mealVenueId);
            if (
              venueUnit &&
              isCommercialKind(venueUnit.kind) &&
              FACILITIES[venueUnit.kind].population > 0 &&
              (venueUnit.customersIn ?? 0) < FACILITIES[venueUnit.kind].population
            ) {
              p.venueUnitId = venueUnit.id;
              venueUnit.customersIn = (venueUnit.customersIn ?? 0) + 1;
              // Origin split for the rating census: hotel guests drop out of
              // the 4-star-plus census, so a guest eating here must not
              // re-enter it through the venue tally. Flag the person so the
              // decrement in finish() mirrors exactly even if the origin
              // room is bulldozed while they eat.
              const originUnitRoom = originUnit(tower, p);
              if (originUnitRoom && isHotelKind(originUnitRoom.kind)) {
                p.countedHotelGuest = true;
                venueUnit.hotelCustomersIn = (venueUnit.hotelCustomersIn ?? 0) + 1;
              }
              tower.bumpMealOverlayRevision();
            }
          } else {
            finish(crowd, p, tower);
          }
        }
      }
      break;
    }
    case "eating": {
      // Stationary sit at the venue floor. The person is still rendered at
      // their destX from the outbound trip. When the timer expires, mutate
      // into a return trip toward `originUnitId`'s floor (if it still exists)
      // or despawn quietly (ghost origin from a bulldoze while eating).
      p.eatSecondsLeft = (p.eatSecondsLeft ?? 0) - dt;
      if (p.eatSecondsLeft <= 0) transitionToReturn(crowd, tower, p);
      break;
    }
    default:
      break;
  }
}

/** Mutate an `eating` person into their return leg. Silent despawn on any
 *  route failure or missing origin unit; the `finish` path will handle the
 *  `outForMeal` decrement (guarded so a bulldozed origin does not ghost-
 *  decrement a fresh unit built on the same floor after). */
function transitionToReturn(crowd: Crowd, tower: Tower, p: Person): void {
  const origin = originUnit(tower, p);
  if (!origin) {
    // Ghost origin: unit was bulldozed while the person was eating, so there
    // is no origin unit left to decrement. Just despawn.
    p.originUnitId = undefined;
    finish(crowd, p, tower);
    return;
  }
  const venueFloor = p.floor;
  const originFloor = origin.floor;
  const r = crowd.route(tower, venueFloor, originFloor);
  if (!r) {
    // Return route unreachable (transport degraded while eating). The person
    // "went home some other way"; the accounting must still balance, so
    // finish() decrements outForMeal via the ghost-guarded path below.
    p.returning = true;
    finish(crowd, p, tower);
    return;
  }
  p.floors = r.floors;
  p.shafts = r.shafts;
  p.leg = 0;
  p.shaftId = r.shafts[0] ?? null;
  p.carIndex = null;
  // A same-floor return has no rides, so walk straight back (mirrors
  // makePerson): otherwise a "toShaft" state with no shaft would stall.
  p.state = r.shafts.length === 0 ? "toDest" : "toShaft";
  p.wait = 0;
  p.age = 0;
  p.linger = 0;
  p.destX = pickX(tower, originFloor, p.seed);
  p.returning = true;
}

/** Walk toward a tile x on the current floor; returns true once arrived. */
function walkTo(p: Person, targetX: number, dt: number): boolean {
  const dx = targetX - p.x;
  const step = WALK_SPEED * dt;
  if (Math.abs(dx) <= step) {
    p.x = targetX;
    return true;
  }
  p.x += Math.sign(dx) * step;
  return false;
}

/** The room a meal round-tripper originated from, if it still exists. */
function originUnit(tower: Tower, p: Person): Unit | undefined {
  return p.originUnitId === undefined ? undefined : tower.getUnit(p.originUnitId);
}

/** Free this person's seat in their current car (if aboard), so bulldozing
 * a shaft mid-ride never leaks rider counts and shrinks a car's capacity. */
function releaseSeat(crowd: Crowd, p: Person): void {
  if (p.carIndex == null || p.shaftId == null) return;
  const key = `${p.shaftId}:${p.carIndex}`;
  crowd.carRiders.set(key, Math.max(0, (crowd.carRiders.get(key) ?? 1) - 1));
  p.carIndex = null;
}

export function finish(crowd: Crowd, p: Person, tower: Tower): void {
  releaseSeat(crowd, p);
  // Report a staff job's outcome: it succeeded only if the staffer actually
  // made it to the destination floor (state "toDest"); a give-up or a shaft
  // vanishing mid-route hands the job back to dispatch as failed.
  if (p.staff) {
    crowd.staffCount = Math.max(0, crowd.staffCount - 1);
    if (p.cleanUnitId !== undefined) {
      crowd.staffDone.push({ unitId: p.cleanUnitId, ok: p.state === "toDest" });
    }
  }
  // Meal round-tripper: decrement the origin's outForMeal on ANY despawn
  // path (successful return arrival, mid-transit give-up, mid-eating
  // give-up, unreachable-return), so the accounting always balances for a
  // person whose spawn incremented outForMeal. `tower` is REQUIRED (not
  // optional) so a future call site cannot accidentally leak a decrement
  // by omitting it; the compiler enforces the balance. Guarded so a
  // bulldozed origin cannot ghost-decrement a fresh unit built on the same
  // floor after (`Tower.nextId` is monotonic so bulldoze + rebuild never
  // reuses an id; the guard defends against the "unit no longer exists"
  // case, which is the only reachable one).
  const origin = originUnit(tower, p);
  if (origin && (origin.outForMeal ?? 0) > 0) {
    origin.outForMeal = (origin.outForMeal ?? 0) - 1;
    tower.bumpMealOverlayRevision();
  }
  // Venue customer: decrement the destination's live customer count on any
  // despawn path (successful return, mid-eating give-up, ghost origin).
  // O(1): getUnit uses an internal Map. Guarded the same way as outForMeal.
  if (p.venueUnitId !== undefined) {
    const venue = tower.getUnit(p.venueUnitId);
    if (venue && (venue.customersIn ?? 0) > 0) {
      venue.customersIn = (venue.customersIn ?? 0) - 1;
      // Mirror the hotel-origin split taken at eating entry (via the flag
      // rather than a fresh origin lookup, so a mid-meal bulldoze cannot
      // unbalance it).
      if (p.countedHotelGuest && (venue.hotelCustomersIn ?? 0) > 0) {
        venue.hotelCustomersIn = (venue.hotelCustomersIn ?? 0) - 1;
      }
      tower.bumpMealOverlayRevision();
    }
    p.venueUnitId = undefined;
    p.countedHotelGuest = undefined;
  }
  p.state = "done";
}
