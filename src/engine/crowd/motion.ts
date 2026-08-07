import type { Tower } from "../Tower";
import type { Clock } from "../Clock";
import type { Transport, Unit } from "../types";
import { isElevatorKind, syncAttendanceOccupants } from "../facilities";
import type { Crowd } from "../Crowd";
import type { Person } from "./person";
import {
  CAR_CAPACITY,
  STRESS_WAIT,
  GIVE_UP,
  STAFF_GIVE_UP,
  RIDE_SECONDS_PER_FLOOR,
} from "./person";
import { pickX, pickXInSegment, insideX, metroStationForPlatform } from "./trips";
import { walkTo } from "./walk";
import { landingSlots } from "./landing";
import { alightX } from "../tower/segments";
import { beginDwell } from "./visits";

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
  // Place each elevator-bound person in its landing's line so waiters form a
  // queue at the doors instead of stacking on the shaft center. Computed once
  // per slice; because it recomputes every advance, the line advances as riders
  // board (each boarder frees the front and everyone behind steps forward).
  const slots = landingSlots(crowd, tower);
  for (const p of crowd.people) {
    p.age += dtSec;
    // Give up if the journey drags on too long: a fed-up traveller who
    // leaves rather than riding forever toward a floor no car will serve.
    // (Staff are on the clock and wait much longer; a failed job is handed
    // back to housekeeping dispatch to retry.) The budget also scales with
    // the trip's ride distance so a legitimate long haul up a tall tower
    // isn't culled mid-ride.
    const patience = (p.staff ? STAFF_GIVE_UP : GIVE_UP) + tripFloors(p) * RIDE_SECONDS_PER_FLOOR;
    // `dwelling` is a stationary venue stay (a meal or an attendance visit);
    // "travelling" nor a service the give-up valve should cull. Excluding it
    // here keeps a long-tail eater (up to EAT_SECONDS_MAX plus their outbound
    // trip's age accumulation) from being finished mid-eat and mis-flagged as
    // a frustrated commuter, which would pollute the crowd stress signal AND
    // skip the return leg the round-trip design promises. See review Edge #1.
    if (p.age > patience && p.state !== "toDest" && p.state !== "dwelling" && p.state !== "done") {
      if (!p.staff) {
        frustrated++;
        travelling++;
      }
      finish(crowd, p, tower);
      continue;
    }
    step(crowd, p, dtSec, tower, slots);
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

function step(crowd: Crowd, p: Person, dt: number, tower: Tower, slots: Map<number, number>): void {
  switch (p.state) {
    case "toShaft": {
      const shaft = shaftOf(tower, p.shaftId);
      if (!shaft) return finish(crowd, p, tower);
      // Approach the shaft face (unchanged): riders then fan into the landing
      // line once they are `waiting`. Targeting the queue slot here instead
      // would change the walk distance and so the toShaft -> waiting timing,
      // which feeds the frustration/satisfaction the sim serializes; the queue
      // must stay a purely visual placement, so the spread happens in `waiting`.
      const targetX = shaft.x + shaft.width / 2;
      if (walkTo(p, targetX, dt, tower)) {
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
          p.x = alightX(tower, shaft, dest, p.destX);
        } else {
          p.shaftId = p.shafts[p.leg];
          const next = shaftOf(tower, p.shaftId);
          p.x = alightX(tower, shaft, dest, next ? next.x + next.width / 2 : p.destX);
          p.state = "toShaft";
        }
      }
      break;
    }
    case "waiting": {
      p.wait += dt;
      const shaft = shaftOf(tower, p.shaftId);
      if (!shaft) return finish(crowd, p, tower);
      // Edge forward to the current slot as the line advances: when a rider
      // ahead boards, this waiter's slot moves toward the doors, so they step up
      // rather than teleport. Position never gates boarding (that is purely
      // car-at-floor plus capacity), so drifting here is safe.
      walkTo(p, slots.get(p.id) ?? shaft.x + shaft.width / 2, dt, tower);
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
        // Bank it into the whole-trip total first, so the per-origin
        // commute-stress accumulator (#514) sees every leg's wait, not just
        // the last one, when the trip finishes.
        p.tripWait += p.wait;
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
          p.x = alightX(tower, shaft, dest, p.destX);
        } else {
          p.shaftId = p.shafts[p.leg];
          const next = shaftOf(tower, p.shaftId);
          p.x = alightX(tower, shaft, dest, next ? next.x + next.width / 2 : p.destX);
          p.state = "toShaft";
        }
      }
      break;
    }
    case "toDest": {
      // Stroll to a spot on the destination floor, linger, then leave. The
      // give-up valve exempts `toDest`, so a held arrival (a dwell, or a
      // venue stay entered below) is never culled mid-stay.
      if (walkTo(p, p.destX, dt, tower)) {
        p.linger += dt;
        // A person with `lingerFor` (a metro commuter waiting for their
        // train) holds the arrived pose past the default beat; venue
        // round-trippers never carry it (their stationary stay is the
        // `dwelling` state below), so the two mechanisms cannot stack.
        if (p.linger > (p.lingerFor ?? 2)) {
          // Round-tripper (meal or attendance visit): outbound arrival
          // transitions to the stationary dwell (beginDwell registers the
          // person at their venue and sets the kind's dwell timer), then a
          // return trip. Meal people carry an origin unit (originUnitId);
          // lobby-origin attendance visitors carry only the venue intent
          // (mealVenueId). `returning` distinguishes the two `toDest`
          // arrivals a round-tripper has; without it, the return arrival
          // would loop back into the dwell forever.
          if ((p.originUnitId !== undefined || p.mealVenueId !== undefined) && !p.returning) {
            beginDwell(crowd, tower, p);
          } else {
            finish(crowd, p, tower);
          }
        }
      }
      break;
    }
    case "dwelling": {
      // Stationary stay at the venue floor (a meal, a showing, a party). The
      // person is still rendered at their destX from the outbound trip. When
      // the timer expires, mutate into a return trip toward `originUnitId`'s
      // floor (if it still exists), the spawn floor for outside visitors, or
      // despawn quietly (ghost origin from a bulldoze while dwelling).
      p.dwellSecondsLeft = (p.dwellSecondsLeft ?? 0) - dt;
      if (p.dwellSecondsLeft <= 0) transitionToReturn(crowd, tower, p);
      break;
    }
    default:
      break;
  }
}

/** Mutate a `dwelling` person into their return leg. Silent despawn
 *  on any route failure or missing origin unit; the `finish` path will handle
 *  the `outForMeal` decrement (guarded so a bulldozed origin does not ghost-
 *  decrement a fresh unit built on the same floor after). */
function transitionToReturn(crowd: Crowd, tower: Tower, p: Person): void {
  const origin = originUnit(tower, p);
  if (!origin && p.originUnitId !== undefined) {
    // Ghost origin: unit was bulldozed while the person was dwelling, so there
    // is no origin unit left to decrement. Just despawn.
    p.originUnitId = undefined;
    finish(crowd, p, tower);
    return;
  }
  const venueFloor = p.floor;
  // A round-tripper with an origin room heads back to it; an outside
  // visitor (no origin unit was ever stamped) heads back to the
  // floor they spawned on (`floors[0]` still holds the outbound route here)
  // and despawns there, leaving the tower the way they entered it.
  const originFloor = origin ? origin.floor : p.floors[0];
  // Route FROM the venue tile the person is standing on (p.x) TO the origin
  // unit's own segment, so the return leg boards from the run they dwelled on and
  // alights on the run their home sits in, never interpolating across a gap. An
  // outside visitor (no origin unit) has no target x, so it routes to the floor's
  // representative segment as before. A gap-free floor is one segment, so both
  // x's resolve to the same node route() used before and the rng stream stays
  // byte-identical.
  const r = crowd.route(tower, venueFloor, originFloor, p.x, origin?.x);
  if (!r) {
    // Return route unreachable (transport degraded while dwelling). The person
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
  // `tripWait` is deliberately NOT reset: it spans the whole round trip so the
  // outbound leg's landing wait folds together with the return leg's into one
  // commute-stress sample at finish (#514), keyed on the immutable originFloor.
  // An outside visitor who rode the train in returns to the platform story,
  // which has no floor tiles for pickX (it would strand them at the lot edge).
  // Place the return destX inside the station footprint, the same treatment
  // the outbound origin got. Everyone else (meal round-trippers, lobby-origin
  // visitors) strolls to a solid tile via pickX. The station lookup does no
  // rng draw, and insideX only draws when a metro is present, so a metro-less
  // tower's motion stream is byte-identical to before.
  const station = origin ? undefined : metroStationForPlatform(tower, originFloor);
  // Land destX inside the segment the return leg actually reaches: a meal
  // round-tripper on its home unit's own run (never a floor-wide pickX tile that
  // could sit across a gap from the alighting run), an outside metro visitor on
  // the station deck, and a lobby-origin visitor on the ground concourse (one
  // contiguous run, so pickX already stays on it). On a gap-free floor
  // pickXInSegment returns exactly what pickX would, keeping the stream identical.
  if (station) p.destX = insideX(crowd, station, 2);
  else if (origin) p.destX = pickXInSegment(tower, originFloor, p.seed, origin.x);
  else p.destX = pickX(tower, originFloor, p.seed);
  p.returning = true;
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
  } else {
    // Read-only commute-stress measurement (#514): fold this non-staff trip's
    // whole-journey landing wait into the per-origin-floor accumulator (every
    // non-staff person, including outside/metro visitors under their origin
    // floor; #502 filters to tenant floors when it surfaces this). The trailing
    // `p.wait` catches a give-up while still queued (unbanked by the boarding
    // fold). Keyed on the immutable `originFloor`, NOT `floors[0]`: a
    // round-tripper's `floors[0]` has been rewritten to the venue by
    // transitionToReturn, so keying on it would misattribute the commute to the
    // venue floor. Staff are excluded (they never count toward tenant stress,
    // matching crowd.frustration). This changes no behavior: nothing reads the
    // accumulator into satisfaction yet (that is #502).
    crowd.recordCommute(p.originFloor, p.tripWait + p.wait);
  }
  // Meal round-tripper: decrement the origin's outForMeal on ANY despawn
  // path (successful return arrival, mid-transit give-up, mid-dwell
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
  // despawn path (successful return, mid-dwell give-up, ghost origin).
  // O(1): getUnit uses an internal Map. Guarded the same way as outForMeal.
  if (p.venueUnitId !== undefined) {
    const venue = tower.getUnit(p.venueUnitId);
    if (venue && (venue.customersIn ?? 0) > 0) {
      venue.customersIn = (venue.customersIn ?? 0) - 1;
      // Attendance venues keep their occupants mirror in step with the tally
      // (a no-op for every other kind).
      syncAttendanceOccupants(venue);
      // Mirror the hotel-origin split taken at dwell entry (via the flag
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
