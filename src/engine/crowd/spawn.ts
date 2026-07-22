import type { Clock } from "../Clock";
import type { Tower } from "../Tower";
import type { FacilityKind, Unit, WeatherKind } from "../types";
import { isOperational, isTenanted } from "../types";
import { attendanceCap, isHotelKind, isOpenAt } from "../facilities";
import { ECON } from "../econConfig";
import type { Crowd } from "../Crowd";
import type { SpawnFloors, StaffKind } from "./person";
import { MAX_PEOPLE, visibleOccupants, CROWD_SECONDS_PER_MINUTE } from "./person";
import { HK_MAIDS_PER_UNIT } from "../economy/housekeeping";
import {
  MEAL_WINDOWS,
  mealWindowFor,
  staffOnShift,
  MEAL_MIX,
  matchesMealOriginKind,
  outboundWeight,
  type MealOriginKind,
} from "./meals";
import { isMetroPlatformServed } from "../tower/routing";
import { weatherFor } from "../sim/build";
import { add, makePerson, venueHasRoom } from "./trips";
import { pushVenueVisitOptions } from "./visits";
import { pushRoutineOptions } from "./routines";
import { metroArrival, metroDeparture } from "./venueTrips";

// Re-exported so existing importers (motion.ts, tests) keep their historical
// entry point; the primitives now live in the `trips.ts` leaf.
export { add, makePerson, pickX, venueHasRoom } from "./trips";

/**
 * The crowd's spawn cadence, pulled out of `Crowd.ts` as friend functions that
 * take the {@link Crowd} instance. They read/advance `crowd.spawnAcc`, append to
 * `crowd.people`, mint ids from `crowd.nextId`, and draw from `crowd.rng`; the
 * meal-window and attendance-visit overlays fold into the same weighted option
 * pool. The trip primitives live in `trips.ts`, the venue-visit flow in
 * `visits.ts`; the class keeps thin `spawn` / `spawnStaff` / `takeStaffResults`
 * methods that delegate here.
 */

// Shared empty result for the no-work path (avoids a per-tick allocation). Typed
// AND frozen readonly so a caller that tries to mutate it fails at compile time
// (and at runtime as a backstop) instead of leaking state into a later read; the
// sole caller only iterates.
const NO_RESULTS: readonly { unitId: number; ok: boolean }[] = Object.freeze([]);

export function spawnFloors(tower: Tower, clock: Clock): SpawnFloors {
  const hour = clock.hour;
  const weekend = clock.isWeekend;
  // The one-way ambient venue pool: shoppers/diners/players who stroll in and
  // despawn at the venue. Modern Amusements joins it as a footfall venue, so
  // people travel to it (foot traffic + transport demand) like a shop instead of
  // it being a dead destination. Cinema stays out (round-trip attendance flow).
  const isVenue = (k: FacilityKind) => k === "shop" || k === "restaurant" || k === "fastFood" || k === "amusements";
  const isStaffKind = (k: FacilityKind): k is StaffKind =>
    k === "security" || k === "medical" || k === "housekeeping" || k === "recycling";
  const leased = new Set<number>();
  const staffed = new Set<number>();
  const homes = new Set<number>();
  const venues = new Set<number>();
  const metroStations: Unit[] = [];
  // Meal-cadence bins: condos and hotels tracked separately (arch §2).
  const condoFloors = new Set<number>();
  const hotelFloors = new Set<number>();
  const staffFloors: { kind: StaffKind; floor: number }[] = [];
  const seenStaff = new Set<string>(); // dedupe kind:floor pairs.
  // Set per kind so dedupe stays O(1) per unit; a large tower with many
  // same-kind venues on one floor would otherwise make binning O(units^2).
  const venuesByKindSet: Partial<Record<FacilityKind, Set<number>>> = {};
  const unitsByFloor = new Map<number, Unit[]>();
  const addVenueByKind = (kind: FacilityKind, floor: number) => {
    const set = venuesByKindSet[kind] ?? (venuesByKindSet[kind] = new Set());
    set.add(floor);
  };
  for (const u of tower.units) {
    const floorUnits = unitsByFloor.get(u.floor);
    if (floorUnits) floorUnits.push(u);
    else unitsByFloor.set(u.floor, [u]);
    // Staff floors read the OPERATIONAL predicate rather than tenant/asleep
    // because staff facilities are not tenanted; they exist and function
    // whenever they are built and not on fire / under construction.
    if (isStaffKind(u.kind)) {
      if (isOperational(u)) {
        const key = `${u.kind}:${u.floor}`;
        if (!seenStaff.has(key)) {
          seenStaff.add(key);
          staffFloors.push({ kind: u.kind, floor: u.floor });
        }
      }
      continue;
    }
    if (u.kind === "weddingHall") {
      // The wedding hall is never tenanted (it earns nothing, so the traffic
      // loop never stamps it "occupied"); like the staff rooms above it
      // functions whenever it is built and not mid-build / on fire. The
      // weekend-and-midday gate lives at option time (pushVenueVisitOptions),
      // not here: spawnFloors bins what exists, options decide when.
      if (isOperational(u)) addVenueByKind(u.kind, u.floor);
      continue;
    }
    // The metro is a destination without being a tenant (population 0, never
    // leased), so it bins BEFORE the tenant gate below, on the same
    // operational predicate the staff kinds use. The party hall is NOT binned
    // here: hall guests ride the attendance-visit flow (pushVenueVisitOptions).
    if (u.kind === "metro") {
      if (isOperational(u)) metroStations.push(u);
      continue;
    }
    if (!(isTenanted(u) || u.state === "asleep")) continue;
    if (u.kind === "office") {
      // Offices are leased year-round but only staffed on weekdays, so inbound
      // workers only head to weekday offices; outbound trips need workers
      // actually present right now (presence zeroes occupants after 18:00 /
      // at weekends).
      if (!weekend) leased.add(u.floor);
      if (u.occupants > 0) staffed.add(u.floor);
    } else if (u.kind === "condo") {
      homes.add(u.floor);
      condoFloors.add(u.floor);
    } else if (isHotelKind(u.kind)) {
      homes.add(u.floor);
      hotelFloors.add(u.floor);
    } else if (isVenue(u.kind) && isOpenAt(u.kind, hour)) {
      // Venues are destinations only while open for business.
      venues.add(u.floor);
      addVenueByKind(u.kind, u.floor);
    } else if (attendanceCap(u.kind) !== undefined && isOpenAt(u.kind, hour)) {
      // Attendance venues (cinema, party hall) take round-trip visits only,
      // never the one-way ambient pool: bin by kind so both the visit options
      // and the late-night meal window (cinema) can draw them.
      addVenueByKind(u.kind, u.floor);
    }
  }
  // Materialize the Sets into insertion-order arrays for the returned bin,
  // preserving the deterministic `rng.pick` behavior the pool relies on.
  const venuesByKind: Partial<Record<FacilityKind, number[]>> = {};
  for (const [kind, set] of Object.entries(venuesByKindSet) as [FacilityKind, Set<number>][]) {
    if (set) venuesByKind[kind] = [...set];
  }
  return {
    leasedOffices: [...leased],
    staffedOffices: [...staffed],
    homes: [...homes],
    openVenues: [...venues],
    condoFloors: [...condoFloors],
    hotelFloors: [...hotelFloors],
    staffFloors,
    venuesByKind,
    unitsByFloor,
    metroStations,
  };
}

/** Decide who travels right now, based on the time of day. */
export function spawnTrips(crowd: Crowd, tower: Tower, clock: Clock, floors: SpawnFloors): void {
  if (crowd.people.length >= MAX_PEOPLE) return;
  // Reuse the Clock's own commute windows so peak hours never drift out of
  // sync between the simulation and the crowd.
  const morning = clock.isMorning();
  const evening = clock.isEvening();
  const day = !morning && !evening && !clock.isNight();
  const { leasedOffices, staffedOffices, homes, openVenues, metroStations } = floors;
  // A metro contributes commuter options only when passenger transport reaches
  // its platform. Otherwise every metroArrival/metroDeparture through it
  // null-routes and spends the spawn budget on guaranteed no-ops (issue #315),
  // starving the real trips that would have filled those slots. The bin itself
  // stays inclusive (the visit-origin path needs every operational station);
  // this gate is the commuter path's own, keyed off the same shared
  // isMetroPlatformServed predicate the visit path and the daily cutoff advisory
  // use so they cannot drift.
  const reachableMetros = metroStations.filter((s) => isMetroPlatformServed(tower, s));

  const trip = (from: number, to: number) => add(crowd, tower, from, to);
  // Each call makes one trip, chosen at random from whatever movements fit
  // the hour, so the evening rush is a genuine mix of workers leaving,
  // residents/guests arriving home and diners heading out, rather than only
  // ever emptying the offices (the old if/else chain starved the others).
  //
  // A reachable operational metro joins each window's mix as a second street
  // door: arrivals step off the train onto the platform and ride up into the
  // tower, departures ride down and wait at the platform edge for theirs. Every
  // metro option is gated on `reachableMetros` being non-empty, so a tower with
  // no metro (or only an unreachable one) pushes the exact option list it always
  // did and the shared rng stream is untouched (the golden master fixture has
  // none). Party hall, cinema, and wedding guests ride the attendance-visit flow
  // (pushVenueVisitOptions), not this branch tree.
  const options: Array<() => void> = [];
  if (morning) {
    if (leasedOffices.length) options.push(() => trip(1, crowd.rng.pick(leasedOffices)));
    if (homes.length) options.push(() => trip(crowd.rng.pick(homes), 1)); // residents head out
    if (reachableMetros.length) {
      // The commuter rush: trains feed the offices, residents catch one out.
      if (leasedOffices.length)
        options.push(() => metroArrival(crowd, tower, crowd.rng.pick(reachableMetros), crowd.rng.pick(leasedOffices)));
      if (homes.length) options.push(() => metroDeparture(crowd, tower, crowd.rng.pick(reachableMetros), crowd.rng.pick(homes)));
    }
  } else if (evening) {
    if (staffedOffices.length) options.push(() => trip(crowd.rng.pick(staffedOffices), 1));
    if (homes.length) options.push(() => trip(1, crowd.rng.pick(homes)));
    if (openVenues.length) options.push(() => trip(1, crowd.rng.pick(openVenues)));
    if (reachableMetros.length) {
      // The evening rush mirrored: workers ride down to the platform,
      // residents and venue visitors arrive by train.
      if (staffedOffices.length)
        options.push(() => metroDeparture(crowd, tower, crowd.rng.pick(reachableMetros), crowd.rng.pick(staffedOffices)));
      if (homes.length) options.push(() => metroArrival(crowd, tower, crowd.rng.pick(reachableMetros), crowd.rng.pick(homes)));
      if (openVenues.length)
        options.push(() => metroArrival(crowd, tower, crowd.rng.pick(reachableMetros), crowd.rng.pick(openVenues)));
    }
  } else if (day) {
    if (openVenues.length) options.push(() => trip(1, crowd.rng.pick(openVenues)));
    if (leasedOffices.length && crowd.rng.chance(0.3)) options.push(() => trip(1, crowd.rng.pick(leasedOffices)));
    // Day-trippers: the visitors the metro's catalog blurb promises.
    if (reachableMetros.length && openVenues.length)
      options.push(() => metroArrival(crowd, tower, crowd.rng.pick(reachableMetros), crowd.rng.pick(openVenues)));
  } else {
    if (openVenues.length) {
      options.push(() => trip(crowd.rng.pick(openVenues), 1)); // late-night stragglers leaving
      if (reachableMetros.length)
        options.push(() => metroDeparture(crowd, tower, crowd.rng.pick(reachableMetros), crowd.rng.pick(openVenues)));
    }
  }

  // Meal-cadence overlay: add outbound `origin -> venue` options during the
  // active meal window. Round-trippers self-schedule their own return leg
  // after an eating pause (the `dwelling` state, PR A); no `venue -> origin` options are pushed
  // here. The existing branches above stay untouched; meal options fold into
  // the same weighted pool `rng.pick` fires from. `MAX_PEOPLE` at the top
  // of the method caps the whole thing so tuning meal weights alone bounds
  // saturation.
  pushMealOptions(crowd, tower, clock, floors, options);
  pushVenueVisitOptions(crowd, tower, clock, floors, options);
  // Demographic routines (#397): school-run and sales-call options, Modern-only
  // through the GameRules seam. Classic reads zero weights and the call returns
  // before any rng draw, so its pool and stream are exactly what they were.
  pushRoutineOptions(crowd, tower, clock, floors, options);

  if (options.length) crowd.rng.pick(options)();
}

/** Contribute meal-window options to `options` when the clock is inside a
 *  meal window. Kept separate from the branch tree above so meal cadence is
 *  clearly additive over the shipped morning/evening/day/night flow. */
export function pushMealOptions(
  crowd: Crowd,
  tower: Tower,
  clock: Clock,
  floors: SpawnFloors,
  options: Array<() => void>,
): void {
  const window = mealWindowFor(clock.hour);
  if (!window) return;
  const w = MEAL_WINDOWS[window];
  // Normalized position across the window, [0..1). At the start of the
  // window the outbound weight is 1 and only outbound trips spawn; returns
  // are self-scheduled by round-trippers on dwell-timer expiry (PR A), so
  // no separate returnWeight is applied here. Include the sub-hour fraction
  // so the profile shifts within an hour, not in one-hour steps.
  const hourFrac = clock.minuteOfDay / 60 - w.start;
  const t = Math.max(0, Math.min(1, hourFrac / (w.end - w.start)));
  const outbound = outboundWeight(t);

  // Meal venues open this window (arch §1). If the tower has none, the whole
  // meal path yields nothing (players see no meal trips until they build
  // food; that is correct behavior).
  const venueFloors = w.venues.flatMap((k) => floors.venuesByKind[k] ?? []);
  if (!venueFloors.length) return;

  // The origins pool: every eligible meal-origin bin, tagged with its
  // per-population weight, its floor list, AND the origin KIND so
  // spawnMealOutbound can pick a specific matching unit on the floor and
  // attribute the round-trip identity to it.
  type MealPool = { originKind: MealOriginKind; floors: number[]; weight: number };
  const originPools: MealPool[] = [];
  const push = (originKind: MealOriginKind, list: number[], weight: number): void => {
    if (list.length && weight > 0) originPools.push({ originKind, floors: list, weight });
  };
  const { office, condo, hotel, staff } = ECON.mealPopulationWeights;
  for (const kind of MEAL_MIX[window].origins) {
    switch (kind) {
      case "office":
        // Weekday-only comes for free: staffedOffices is empty on weekends
        // (updatePresence zeros office occupants), so no redundant isWeekend
        // check is needed here.
        push("office", floors.staffedOffices, office);
        break;
      case "condo":
        push("condo", floors.condoFloors, condo);
        break;
      case "hotel":
        // Hotels declared as origins for every meal window per the arch, but
        // `hotelFloors` is gated by `isTenanted(u) || u.state === "asleep"`
        // (same as the shipped `homes` bin). Guests are only `asleep`
        // between evening move-in (17:00+) and checkout (08:00), so
        // `hotelFloors` is EMPTY during lunch (11-14) and mostly empty
        // during dinner (17-20 fills gradually). Breakfast and late-night
        // see full hotel participation. Broadening the gate is a follow-up
        // (backlog `per-person-meal-round-trips` post-PR-A note); keeping
        // the origin declared here documents the design intent in one place.
        push("hotel", floors.hotelFloors, hotel);
        break;
      case "staff": {
        const onShift = floors.staffFloors
          .filter((s) => staffOnShift(s.kind, clock.hour, tower.rules.housekeepingShift()))
          .map((s) => s.floor);
        push("staff", onShift, staff);
        break;
      }
    }
  }
  if (!originPools.length) return;

  // Per-window contribution. Outbound spawns REAL round-trip persons who
  // handle their own return leg after an eating pause (see spawnMealOutbound,
  // advance's `dwelling` case, and transitionToReturn). The aggregate return
  // branch that pushed `venue -> origin` options was retired in PR A.
  //
  // The base coefficient is 3 to preserve the shipped pool weight against
  // the morning/evening/night branches; `rng.chance(pool.weight)` gates each
  // option so a low-weight population (condos, 0.3x) contributes with the
  // right probability at every phase, not on/off in coarse chunks.
  const outboundBase = Math.max(0, Math.round(outbound * 3));
  for (const pool of originPools) {
    for (let i = 0; i < outboundBase; i++) {
      if (pool.weight >= 1 || crowd.rng.chance(pool.weight)) {
        options.push(() => spawnMealOutbound(crowd, tower, pool, venueFloors, w.venues, clock.hour, floors));
      }
    }
  }
}

/**
 * Fire a single meal-round-trip outbound. Picks a random floor from the
 * pool, then finds a candidate origin unit on that floor of the pool's
 * kind whose `visibleOccupants > 0` (a worker still IN the room, not
 * already out). Increments the origin's `outForMeal` and stamps
 * `originUnitId` on the spawned person; the person self-transitions to
 * `dwelling` on arrival and to a return trip on dwell-timer expiry.
 *
 * If no candidate exists (all workers already out), the call is a no-op:
 * the caller's `rng.pick` fired but no person spawns. The `MAX_PEOPLE` cap
 * self-balances the pool.
 */
export function spawnMealOutbound(
  crowd: Crowd,
  tower: Tower,
  pool: { originKind: MealOriginKind; floors: number[] },
  venueFloors: number[],
  venueKinds: FacilityKind[],
  hour: number,
  floors: SpawnFloors,
): void {
  const originFloor = crowd.rng.pick(pool.floors);
  // Candidate units on the chosen floor of the right kind with at least one
  // available (in-room) occupant. For the "staff" bucket, ALSO gate on
  // on-shift status per unit kind: an off-shift housekeeping room can be on
  // the same floor as an on-shift security room, and the pool-floor bin only
  // guarantees at least one on-shift kind exists; the per-unit filter here
  // makes sure the picked unit is itself on shift (review Blind #5).
  const floorUnits = floors.unitsByFloor.get(originFloor) ?? [];
  const candidates = floorUnits.filter(
    (u) =>
      matchesMealOriginKind(u, pool.originKind) &&
      (pool.originKind !== "staff" || staffOnShift(u.kind as StaffKind, hour, tower.rules.housekeepingShift())) &&
      visibleOccupants(u) > 0,
  );
  if (candidates.length === 0) return;
  const origin = crowd.rng.pick(candidates);
  const venueFloor = crowd.rng.pick(venueFloors);
  // A concrete venue on the chosen floor, matching this window's venue kinds
  // and open right now (the same gate spawnFloors used to bin the floor).
  // The census needs a specific unit to attribute the customer to, and destX
  // must land inside its footprint: destX from pickX is a random corridor
  // tile, so inferring the venue from it at arrival attributes customers to
  // whatever room the tile happens to sit under (review P2). Full houses are
  // skipped via venueHasRoom: census venues clamp at their catalog population
  // (the advertised "up to N", so an undersupplied tower self-limits, review
  // P2), attendance venues (cinema on the late-night window) at their
  // attendance cap.
  const venueCandidates = (floors.unitsByFloor.get(venueFloor) ?? []).filter(
    (u) =>
      venueKinds.includes(u.kind) &&
      isTenanted(u) &&
      isOpenAt(u.kind, hour) &&
      venueHasRoom(u),
  );
  if (venueCandidates.length === 0) return;
  const venue = crowd.rng.pick(venueCandidates);
  // The route is computed by `add`, which may fail (route unreachable
  // from origin to venue). If it fails, no person exists and we must not
  // increment outForMeal. Order: add first, THEN increment on the returned
  // person object.
  const spawned = add(crowd, tower, originFloor, venueFloor);
  if (!spawned) return;
  spawned.destX = crowd.rng.int(venue.x, venue.x + venue.width - 1);
  spawned.mealVenueId = venue.id;
  spawned.originUnitId = origin.id;
  origin.outForMeal = (origin.outForMeal ?? 0) + 1;
  tower.bumpMealOverlayRevision();
}

/**
 * Dispatch a staff member (housekeeper) from `from` to `to` over the STAFF
 * network, walking to `destX` (the room being serviced). The two failure
 * modes are distinct so the caller reacts correctly: "full" (staff pool at
 * cap, retry later) vs "no-route" (the network can't get there, surface
 * it, don't retry silently). `cleanMinutes` is the per-room cleaning dwell in
 * game-minutes: the maid holds in the room (the arrived `toDest` pose, via
 * `lingerFor`) for that long before the job reports done, so cleaning is
 * watchable work over time, never instant on arrival.
 */
export function spawnStaff(
  crowd: Crowd,
  tower: Tower,
  from: number,
  to: number,
  destX: number,
  cleanUnitId: number,
  cleanMinutes: number,
  fromX?: number,
): "sent" | "full" | "no-route" {
  if (crowd.staffCount >= maxStaffFor(tower)) return "full";
  const r = crowd.staffRoute(tower, from, to); // handles from === to (walk only)
  if (!r) return "no-route";
  const p = makePerson(crowd, tower, r, destX);
  // Staff step out of their own station, not a random corridor tile: pin the
  // spawn x to the dispatching unit's footprint when the caller names one
  // (overhaul GDD legibility; makePerson's seeded pickX stays the fallback).
  if (fromX !== undefined) p.x = fromX;
  p.staff = true;
  p.cleanUnitId = cleanUnitId;
  p.lingerFor = cleanMinutes * CROWD_SECONDS_PER_MINUTE;
  crowd.staffCount++;
  return "sent";
}

/** The staff-actor spawn ceiling: built housekeeping units x
 *  {@link HK_MAIDS_PER_UNIT}. Canon has no tower-wide staff pool (each 1994
 *  unit staffs its own 6 maids), so a fixed cap here silently throttled big
 *  hotels; the per-crew ledgers in `economy/housekeeping.ts` are the real
 *  constraint and this gate only backstops them. Counted by KIND alone (a
 *  burning crew keeps its share, so orphaned in-flight maids never pinch
 *  healthy crews; dispatch's operational filter stops a burned crew fielding
 *  new maids) and memoized per {@link Tower.revision}, which the kind count
 *  tracks exactly (the gate runs in dispatch's per-room loop; a fresh
 *  O(units) scan per call is out). A crewless tower reads "full" to any staff actor. */
const staffCeiling = new WeakMap<Tower, { rev: number; cap: number }>();
export function maxStaffFor(tower: Tower): number {
  const hit = staffCeiling.get(tower);
  if (hit && hit.rev === tower.revision) return hit.cap;
  let crews = 0;
  for (const u of tower.units) if (u.kind === "housekeeping") crews++;
  const entry = { rev: tower.revision, cap: crews * HK_MAIDS_PER_UNIT };
  staffCeiling.set(tower, entry);
  return entry.cap;
}

/** Drain the staff jobs that ended since the last call (arrived or failed). */
export function takeStaffResults(crowd: Crowd): readonly { unitId: number; ok: boolean }[] {
  if (crowd.staffDone.length === 0) return NO_RESULTS;
  const out = crowd.staffDone;
  crowd.staffDone = [];
  return out;
}

export function spawnStep(
  crowd: Crowd,
  dtSec: number,
  tower: Tower,
  clock: Clock,
  weather?: WeatherKind,
): void {
  // Spawn at a rate that scales with how busy the hour is AND how populated the
  // tower is (review F39): a 6-office tower and a 12,000-pop tower no longer
  // spawn identically. The MAX_PEOPLE cap in spawnTrips still bounds the total.
  const timeRate = clock.isNight() ? 0.3 : clock.isWeekend ? 1.2 : 2.2;
  const popFactor = Math.min(3, 0.4 + tower.totalPopulation() / 2000);
  // Rain thins the people out and about (weather-shapes-crowd, #430): fewer
  // spawns on a rainy day, so the visible crowd empties and attendance houses
  // fill less. Read the SAME authoritative `sim.weather` the economy's rain
  // channel reads (the loop passes it in), so the crowd and the income loop can
  // never disagree about whether it is raining within a tick; fall back to the
  // pure per-day `weatherFor` hash (the value `sim.weather` is itself set from)
  // for the crowd-only paths that have no Simulation to hand (motion.update and
  // the crowd-driven tests). Either source is off the gameplay RNG, and it scales
  // the accumulator like the time and population factors above, so it perturbs no
  // seeded draw; a clear or cloudy sky multiplies by exactly 1.
  const sky = weather ?? weatherFor(clock.day);
  const weatherFactor = sky === "rain" ? tower.rules.rainCrowdFactor() : 1;
  crowd.spawnAcc += dtSec * timeRate * popFactor * weatherFactor;
  if (crowd.spawnAcc < 1) return;
  // Categorize floors once per outer step: the drain loop below only adds
  // people (never units), so the four lists are stable across its iterations.
  const floors = spawnFloors(tower, clock);
  let guard = 0;
  while (crowd.spawnAcc >= 1 && guard++ < 8) {
    crowd.spawnAcc -= 1;
    spawnTrips(crowd, tower, clock, floors);
  }
}
