import type { FacilityKind, Unit } from "../types";
import { CAR_FLOORS_PER_MINUTE } from "../ElevatorDispatch";

/**
 * The Person model plus the crowd's shared tuning constants and the
 * `visibleOccupants` projection. Extracted from `Crowd.ts` so the types and the
 * physics numbers live in one leaf that the routing / motion / spawn siblings
 * all import, and `Crowd.ts` re-exports the public ones so importers are
 * unchanged.
 *
 * This module is deliberately DOM-free so it can be unit-tested; the renderer
 * reads {@link Crowd.people} each frame and draws them.
 */

export type StaffKind = "security" | "medical" | "housekeeping" | "recycling";

/**
 * Individual people who actually route through the tower: SimTower's signature.
 * Each person has an origin and destination floor, a transport route worked out
 * by breadth-first search over the elevator/stair network, and a little state
 * machine: walk to the shaft, wait, ride a real car, transfer at lobbies, walk
 * to the destination. Their waiting time is the true source of tenant stress.
 *
 * It advances on real seconds (passed in by the renderer) so people move at a
 * steady, watchable pace regardless of the game-speed time compression.
 */

export type PersonState = "toShaft" | "waiting" | "riding" | "climbing" | "toDest" | "dwelling" | "done";

export interface Person {
  id: number;
  seed: number;
  state: PersonState;
  /** Discrete current floor (where they're standing / boarding). */
  floor: number;
  /** Continuous floor for rendering while riding a car. */
  fy: number;
  /** Continuous tile x. */
  x: number;
  /** Per-leg transport route: floors[0]=origin … floors[n]=destination. */
  floors: number[];
  /** shaft id used for leg i (floors[i] → floors[i+1]); always a valid id. An
   *  unreachable destination yields no route at all (routing returns null), so
   *  this array never holds a sentinel. */
  shafts: number[];
  leg: number;
  shaftId: number | null;
  carIndex: number | null;
  /** Tile x to stroll to on the destination floor (within built structure). */
  destX: number;
  /** Seconds spent waiting on the current call (drives stress). */
  wait: number;
  /** Total seconds in transit (origin → destination), for the give-up valve. */
  age: number;
  /** Idle timer once arrived, before despawning. */
  linger: number;
  /** True for tower staff (housekeepers): they route over the STAFF network
   *  (service elevators / stairs / escalators), never count toward tenant
   *  stress, and render in a work uniform. */
  staff?: boolean;
  /** Unit id this staffer is dispatched to service (a dirty hotel room). */
  cleanUnitId?: number;
  /** Unit id of the meal venue chosen at spawn for a round-trip meal person;
   *  `destX` points inside this unit's footprint. Distinct from `venueUnitId`:
   *  this records the intent (set on spawn), while `venueUnitId` records the
   *  census count actually taken (set on dwell entry), so a give-up before
   *  arrival never decrements a count that was never incremented. */
  mealVenueId?: number;
  /** Unit id of the commercial venue (fastFood / restaurant / shop) where this
   *  person is currently attending. Set when the person enters the
   *  `dwelling` state;
   *  used to decrement `venueUnit.customersIn` when they leave. Undefined for
   *  all non-meal persons and for eaters at non-commercial destinations. */
  venueUnitId?: number;
  /** True when this counted eater came from a HOTEL origin, so finish() also
   *  decrements the venue's `hotelCustomersIn` (the 4-star-plus census
   *  exclusion). Captured at dwell entry, when the origin still exists. */
  countedHotelGuest?: boolean;
  /** Unit id of the ORIGIN room for a round-trip meal person (an office,
   *  condo, or hotel room whose visible occupancy dropped by 1 when this
   *  person spawned outbound). Undefined for lobby-centric commuter trips
   *  and staff dispatches. On return arrival the person decrements
   *  `originUnit.outForMeal`, guarded so a bulldozed origin cannot ghost-
   *  decrement a fresh unit built in the same slot after. */
  originUnitId?: number;
  /** Remaining crowd-seconds in the `dwelling` state (a stationary stay at
   *  the destination floor after the outbound trip's `toDest` completes: a
   *  meal, a showing, a party, a wedding). Only set for round-trippers;
   *  drained in the `advance` loop. */
  dwellSecondsLeft?: number;
  /** True once the outbound arrival has transitioned this person into their
   *  return trip (venue -> origin). Distinguishes the two `toDest` completions
   *  a round-tripper has (outbound arrival triggers the dwell; return arrival
   *  triggers the outForMeal decrement + despawn). */
  returning?: boolean;
  /** Extended arrival linger (crowd-seconds): how long to hold the arrived
   *  pose before despawning. A metro commuter waiting on the platform for
   *  their train. Unset for ordinary trips, which keep the default 2-second
   *  linger; distinct from the venue round-trippers' `dwelling` state and
   *  its `dwellSecondsLeft`. In-memory only, like every Person field. */
  lingerFor?: number;
}

/** A transport route as a list of floors and the shaft used between each. */
export interface Route {
  floors: number[];
  shafts: number[];
}

/** The spawn-source floor lists, computed once per outer sim step. `homes`
 *  keeps its lumped condo+hotel population for the existing morning/evening
 *  flows; `condoFloors` and `hotelFloors` split them for the meal-cadence path
 *  (breakfast draws heavily from hotels and lightly from condos, so meals need
 *  each population weighted independently). `staffFloors` carries the staff
 *  kind alongside the floor so on-shift filtering can run at consumption time
 *  without re-scanning `tower.units`. */
export interface SpawnFloors {
  leasedOffices: number[];
  staffedOffices: number[];
  homes: number[];
  openVenues: number[];
  condoFloors: number[];
  hotelFloors: number[];
  staffFloors: { kind: StaffKind; floor: number }[];
  /** Per-kind venue floor lists for the meal-mix path (same info as
   *  `openVenues` but keyed so meal windows can draw fastFood-only for
   *  breakfast or fastFood+cinema for late-night without a per-tick filter
   *  over units). */
  venuesByKind: Partial<Record<FacilityKind, number[]>>;
  /** Snapshot of unit lists by floor, built in {@link spawnFloors} once per
   *  outer step so outbound meal spawns can sample candidates without
   *  re-scanning the full `tower.units` array each time. */
  unitsByFloor: Map<number, Unit[]>;
  /** Operational metro stations (capped at 1 per tower). Kept as units rather
   *  than floors: commuter spawns stamp their origin/destination x inside the
   *  station footprint (the platform story has no floor tiles for pickX), and
   *  the platform story is derived from the unit (floor + 1, the middle of
   *  the three-story module). */
  metroStations: Unit[];
}

/** Live calls the drawn crowd places on the elevators (see elevatorCalls).
 *  A read-only snapshot: the dispatch consumes it, never mutates it. */
export interface ElevatorCalls {
  /** Landing buttons: shaftId → floor → how many people want a car there. */
  hall: ReadonlyMap<number, ReadonlyMap<number, number>>;
  /** Cab buttons: shaftId → carIndex → floors that car's riders need. */
  cab: ReadonlyMap<number, ReadonlyMap<number, ReadonlySet<number>>>;
}

/** One landing's waiting line in an {@link ElevatorQueueView}: how many real
 *  people wait there and a bounded wait-tier (0 content, 1 impatient, 2 fed up),
 *  the max over its waiters. */
export interface QueueLanding {
  count: number;
  tier: 0 | 1 | 2;
}

/**
 * Read-only projection of the waiting crowd and per-car occupancy, sized for
 * the render layer (see `elevatorQueueView`). A VIEW of state the crowd
 * already tracks (the same `waiting` people {@link ElevatorCalls} counts, and
 * each car's drawn occupancy `crowd.carRiders`), so it re-simulates nothing:
 * it surfaces boarding, it does not perform it. Both halves count ONE
 * population, the drawn crowd, so a waiter boarding moves the same figure
 * from a landing into a car. {@link Crowd.queueView} memoizes it once per
 * outer sim step, so a render frame reads it without re-scanning the crowd.
 */
export interface ElevatorQueueView {
  /** Landing queues: shaftId → floor → count and wait-tier. The waiters' stable
   *  order in `crowd.people` is the queue order the render draws; this view
   *  carries the length and tier, not the identities. */
  landings: ReadonlyMap<number, ReadonlyMap<number, QueueLanding>>;
  /** Boarded riders per car: shaftId → carIndex → count, read from
   *  `crowd.carRiders` (the drawn per-car occupancy, the same routed figures
   *  `landings` counts, now aboard). Not the dispatch's statistical `carLoad`. */
  boarded: ReadonlyMap<number, ReadonlyMap<number, number>>;
}

/**
 * Crowd time-base: one in-game minute is worth this many of the crowd's own
 * seconds (small, so a commute spans a few game-minutes and people zip through
 * trips at fast speed). Exported for the Simulation's tick conversion.
 */
export const CROWD_SECONDS_PER_MINUTE = 2;

export const WALK_SPEED = 6; // tiles per second
export const CAR_CAPACITY = 12; // drawn commuters allowed aboard one car (hidden while riding)
export const MAX_PEOPLE = 140;
/** Round-trip meal person "eating" duration, drawn uniformly per person. Real
 *  minutes converted to crowd-seconds via {@link CROWD_SECONDS_PER_MINUTE}.
 *  Chosen so a lunch round-trip fits inside the 3-hour window with visible
 *  slack: ~5 min there, 30-60 min eating, ~5 min back leaves the office
 *  visibly thinned for ~40-70 minutes. */
const EAT_MINUTES_MIN = 30;
const EAT_MINUTES_MAX = 60;
export const EAT_SECONDS_MIN = EAT_MINUTES_MIN * CROWD_SECONDS_PER_MINUTE;
export const EAT_SECONDS_MAX = EAT_MINUTES_MAX * CROWD_SECONDS_PER_MINUTE;
/** How long a departing commuter waits on the metro platform before their
 *  train "takes" them (the despawn stands in for boarding), in crowd-seconds.
 *  Long enough that a rush hour visibly pools a small waiting crowd at the
 *  platform edge instead of each figure blinking out on arrival. */
export const METRO_DWELL_MIN = 8;
export const METRO_DWELL_MAX = 24;

/** Attendance-visit dwell windows per entertainment venue, in in-game minutes:
 *  a cinema visit spans a showing, a party runs longer, a wedding longer
 *  still. Design tuning (not canon figures), sized so a visit fits inside the
 *  venue's open hours with the crowd visibly overlapping into a full house. */
const ATTEND_MINUTES: Partial<Record<FacilityKind, { min: number; max: number }>> = {
  cinema: { min: 90, max: 120 },
  partyHall: { min: 60, max: 120 },
  weddingHall: { min: 120, max: 180 },
};

/** The stationary-dwell window (in crowd-seconds) for a round-tripper at a
 *  venue of `kind`: the attendance window for entertainment venues, the meal
 *  window for everything else (food venues, and the fallback when the venue
 *  was bulldozed before arrival and its kind is unknown). */
export function dwellSecondsRange(kind: FacilityKind | undefined): { min: number; max: number } {
  const m = kind === undefined ? undefined : ATTEND_MINUTES[kind];
  if (!m) return { min: EAT_SECONDS_MIN, max: EAT_SECONDS_MAX };
  return { min: m.min * CROWD_SECONDS_PER_MINUTE, max: m.max * CROWD_SECONDS_PER_MINUTE };
}

/**
 * Visible occupant count for a room, as seen by the renderer and (PR B) the
 * live pop census. Subtracts the transient `outForMeal` overlay from the
 * canonical `u.occupants` so a room whose worker is out to lunch visibly
 * thins out. Clamped at zero to be robust against any accounting slip; a
 * runaway outForMeal cannot make figures render as negative counts.
 *
 * `u.occupants` remains canonical: `updatePresence` continues to overwrite it
 * hourly with the expected staff for the hour. This helper is a pure
 * projection, no state, no side effects.
 */
export function visibleOccupants(u: { occupants: number; outForMeal?: number }): number {
  return Math.max(0, u.occupants - (u.outForMeal ?? 0));
}

/** Staff travel outside the tenant cap (they must be able to work even in a
 *  packed tower) but stay bounded so dispatch can't flood the screen. */
export const MAX_STAFF = 32;
export const STRESS_WAIT = 25; // seconds of waiting that counts as "fed up"
/**
 * A commuter who hasn't reached their floor within this many real seconds gives
 * up and leaves: a safety valve so nobody is ever stranded forever (a car the
 * aggregate scheduler never sends to their floor, an elevator removed from
 * under them) silently consuming the on-screen population cap.
 */
export const GIVE_UP = 120;
/** Staff are on the clock: they wait longer than a fed-up tenant before
 *  abandoning a job (the failed room is handed back to dispatch and retried),
 *  but not so long that stuck trips pin the staff pool for hours. */
export const STAFF_GIVE_UP = GIVE_UP * 3;
/** Extra patience per floor of the trip's total ride distance: what one floor
 *  of riding honestly costs in crowd-seconds, derived from the car speed so it
 *  can never drift from the dispatch. A fixed budget alone would despawn every
 *  long-haul rider mid-shaft on a tall tower no matter how good the service. */
export const RIDE_SECONDS_PER_FLOOR = CROWD_SECONDS_PER_MINUTE / CAR_FLOORS_PER_MINUTE;
