import type { Clock } from "./Clock";
import type { Tower } from "./Tower";
import type { FacilityKind, Transport, Unit } from "./types";
import { isOperational, isTenanted } from "./types";
import { CAR_FLOORS_PER_MINUTE } from "./ElevatorDispatch";
import { isElevatorKind, isHotelKind, isOpenAt, isStaffOnlyTransport, isStaffTransportKind } from "./facilities";
import { HK_SHIFT_END, HK_SHIFT_START } from "./EconomySystem";
import { ECON } from "./econConfig";
import { RNG } from "./rng";

/**
 * Meal cadence (gdd/arch-tower-wide-meal-cadence-2026-07-09). Four meal windows
 * drive real transport pressure: every "eating" population (offices, condos,
 * hotel guests, on-shift staff) spawns outbound trips to open food venues near
 * the peak of its window and lagged return trips near the tail. Trip options
 * feed the same weighted `options` array {@link Crowd.spawnTrips} already uses,
 * so the `MAX_PEOPLE` cap self-balances the pool. Economy is untouched:
 * `collectTrafficIncome` already models demand volume through appeal factors;
 * the meal-cadence change just makes the shafts feel the demand.
 */
export type StaffKind = "security" | "medical" | "housekeeping" | "recycling";

export const MEAL_WINDOWS = {
  breakfast: { start: 6, end: 9, venues: ["fastFood"] as FacilityKind[] },
  lunch: { start: 11, end: 14, venues: ["fastFood", "restaurant"] as FacilityKind[] },
  dinner: { start: 17, end: 20, venues: ["fastFood", "restaurant"] as FacilityKind[] },
  lateNight: { start: 21, end: 24, venues: ["fastFood", "cinema"] as FacilityKind[] },
} as const;

export type MealWindow = keyof typeof MEAL_WINDOWS;

/** The window whose `[start, end)` covers `hour`, or null when off-window.
 *  Lunch (11-14) matches {@link Clock.isLunch} byte-for-byte. */
export function mealWindowFor(hour: number): MealWindow | null {
  for (const k of Object.keys(MEAL_WINDOWS) as MealWindow[]) {
    const w = MEAL_WINDOWS[k];
    if (hour >= w.start && hour < w.end) return k;
  }
  return null;
}

/** Whether a staff kind is eligible to make meal trips at this hour. Only
 *  housekeeping has a modeled shift window today ([HK_SHIFT_START, HK_SHIFT_END)
 *  in `EconomySystem`); security, medical, and recycling are always eligible
 *  while their facility is operational. If a future kind gains a shift, add
 *  its case here alongside the new constants, so the gate stays single-source. */
export function staffOnShift(kind: StaffKind, hour: number): boolean {
  if (kind === "housekeeping") return hour >= HK_SHIFT_START && hour < HK_SHIFT_END;
  return true;
}

/**
 * Per-window origin mix (arch §4). The table is authoritative; adding a new
 * meal window means one row. Weights come from {@link ECON.mealPopulationWeights}.
 */
type MealOriginKind = "office" | "condo" | "hotel" | "staff";
type MealMix = { origins: MealOriginKind[] };
const MEAL_MIX: Record<MealWindow, MealMix> = {
  breakfast: { origins: ["hotel", "condo", "staff"] },
  lunch: { origins: ["office", "condo", "hotel", "staff"] },
  dinner: { origins: ["office", "condo", "hotel", "staff"] },
  lateNight: { origins: ["hotel", "condo"] },
};

/** True when this unit's kind belongs to the meal-origin bucket. Used by
 *  `spawnMealOutbound` to pick a specific room on a floor whose visible
 *  occupancy to drop. */
function matchesMealOriginKind(u: { kind: FacilityKind }, bucket: MealOriginKind): boolean {
  switch (bucket) {
    case "office":
      return u.kind === "office";
    case "condo":
      return u.kind === "condo";
    case "hotel":
      return isHotelKind(u.kind);
    case "staff":
      return (
        u.kind === "security" ||
        u.kind === "medical" ||
        u.kind === "housekeeping" ||
        u.kind === "recycling"
      );
  }
}

/**
 * Outbound phase profile. `t` is normalized 0..1 across the meal window.
 * Weight is heavier in the first ~60% of the window and hits zero at t=0.6,
 * so outbound trips cluster near the start and taper toward the middle.
 * Returns are self-scheduled by each round-tripper on their eating-timer
 * expiry (PR A retired the aggregate return branch), so no matching
 * `returnWeight(t)` exists here.
 */
function outboundWeight(t: number): number {
  return Math.max(0, Math.min(1, 2 * (0.6 - t)));
}

/**
 * Individual people who actually route through the tower — SimTower's signature.
 * Each person has an origin and destination floor, a transport route worked out
 * by breadth-first search over the elevator/stair network, and a little state
 * machine: walk to the shaft, wait, ride a real car, transfer at lobbies, walk
 * to the destination. Their waiting time is the true source of tenant stress.
 *
 * This module is deliberately DOM-free so it can be unit-tested; the renderer
 * reads {@link Crowd.people} each frame and draws them. It advances on real
 * seconds (passed in by the renderer) so people move at a steady, watchable
 * pace regardless of the game-speed time compression.
 */

export type PersonState = "toShaft" | "waiting" | "riding" | "climbing" | "toDest" | "eating" | "done";

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
  /** shaft id used for leg i (floors[i] → floors[i+1]); -1 if unreachable. */
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
  /** Unit id of the ORIGIN room for a round-trip meal person (an office,
   *  condo, or hotel room whose visible occupancy dropped by 1 when this
   *  person spawned outbound). Undefined for lobby-centric commuter trips
   *  and staff dispatches. On return arrival the person decrements
   *  `originUnit.outForMeal`, guarded so a bulldozed origin cannot ghost-
   *  decrement a fresh unit built in the same slot after. */
  originUnitId?: number;
  /** Remaining crowd-seconds in the `eating` state (a stationary sit at the
   *  destination floor after the outbound trip's `toDest` completes). Only
   *  set for round-trip meal persons; drained in the `advance` loop. */
  eatSecondsLeft?: number;
  /** True once the outbound arrival has transitioned this person into their
   *  return trip (venue -> origin). Distinguishes the two `toDest` completions
   *  a round-tripper has (outbound arrival triggers eating; return arrival
   *  triggers the outForMeal decrement + despawn). */
  returning?: boolean;
}

/** A transport route as a list of floors and the shaft used between each. */
interface Route {
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
interface SpawnFloors {
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
}

/** Live calls the drawn crowd places on the elevators (see elevatorCalls).
 *  A read-only snapshot: the dispatch consumes it, never mutates it. */
export interface ElevatorCalls {
  /** Landing buttons: shaftId → floor → how many people want a car there. */
  hall: ReadonlyMap<number, ReadonlyMap<number, number>>;
  /** Cab buttons: shaftId → carIndex → floors that car's riders need. */
  cab: ReadonlyMap<number, ReadonlyMap<number, ReadonlySet<number>>>;
}

/**
 * Crowd time-base: one in-game minute is worth this many of the crowd's own
 * seconds (small, so a commute spans a few game-minutes and people zip through
 * trips at fast speed). Exported for the Simulation's tick conversion.
 */
export const CROWD_SECONDS_PER_MINUTE = 2;

const WALK_SPEED = 6; // tiles per second
const CAR_CAPACITY = 12; // drawn commuters allowed aboard one car (hidden while riding)
const MAX_PEOPLE = 140;
/** Round-trip meal person "eating" duration, drawn uniformly per person. Real
 *  minutes converted to crowd-seconds via {@link CROWD_SECONDS_PER_MINUTE}.
 *  Chosen so a lunch round-trip fits inside the 3-hour window with visible
 *  slack: ~5 min there, 30-60 min eating, ~5 min back leaves the office
 *  visibly thinned for ~40-70 minutes. */
const EAT_MINUTES_MIN = 30;
const EAT_MINUTES_MAX = 60;
export const EAT_SECONDS_MIN = EAT_MINUTES_MIN * CROWD_SECONDS_PER_MINUTE;
export const EAT_SECONDS_MAX = EAT_MINUTES_MAX * CROWD_SECONDS_PER_MINUTE;

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
const MAX_STAFF = 32;
const STRESS_WAIT = 25; // seconds of waiting that counts as "fed up"
/**
 * A commuter who hasn't reached their floor within this many real seconds gives
 * up and leaves — a safety valve so nobody is ever stranded forever (a car the
 * aggregate scheduler never sends to their floor, an elevator removed from
 * under them) silently consuming the on-screen population cap.
 */
const GIVE_UP = 120;
/** Staff are on the clock: they wait longer than a fed-up tenant before
 *  abandoning a job (the failed room is handed back to dispatch and retried),
 *  but not so long that stuck trips pin the staff pool for hours. */
const STAFF_GIVE_UP = GIVE_UP * 3;
/** Extra patience per floor of the trip's total ride distance — what one floor
 *  of riding honestly costs in crowd-seconds, derived from the car speed so it
 *  can never drift from the dispatch. A fixed budget alone would despawn every
 *  long-haul rider mid-shaft on a tall tower no matter how good the service. */
const RIDE_SECONDS_PER_FLOOR = CROWD_SECONDS_PER_MINUTE / CAR_FLOORS_PER_MINUTE;

export class Crowd {
  people: Person[] = [];
  private rng: RNG;
  private nextId = 1;
  private spawnAcc = 0;
  /** Riders currently aboard each car, keyed "shaftId:carIndex". */
  private carRiders = new Map<string, number>();
  /** Rolling fraction of recent travellers who waited too long (0..1). */
  private frustration = 0;
  /** Cached transport stop-graph, rebuilt only when the tower changes. */
  private adj: Map<number, { f: number; shaft: number }[]> | null = null;
  private adjRev = -1;
  /** Cached STAFF stop-graph (service elevators / stairs / escalators). */
  private staffAdj: Map<number, { f: number; shaft: number }[]> | null = null;
  private staffAdjRev = -1;
  /** Finished staff jobs since the last drain: unit id + whether the staffer
   *  actually reached the destination (vs. gave up / lost their shaft). */
  private staffDone: { unitId: number; ok: boolean }[] = [];

  constructor(seed = 1) {
    this.rng = new RNG(seed);
  }

  reset(): void {
    this.people = [];
    this.carRiders.clear();
    this.frustration = 0;
    // Drop the partial spawn accumulator and id counter too, so a fresh sim
    // doesn't immediately spawn a backlog or grow ids without bound.
    this.spawnAcc = 0;
    this.nextId = 1;
    this.adj = null;
    this.adjRev = -1;
    this.staffAdj = null;
    this.staffAdjRev = -1;
    this.staffDone = [];
    this.staffCount = 0;
  }

  /** 0..1 — how stressed the current crowd is by elevator waits. */
  get stress(): number {
    return this.frustration;
  }

  /** Live elevator calls from real people (tenants AND staff), for the
   *  dispatch. Two kinds, exactly like a real lift: `hall` (shaftId → floor →
   *  waiter count — the landing button) and `cab` (shaftId → carIndex → floors
   *  a rider aboard that car needs — the buttons inside the cab). Without
   *  these the drawn commuters exist only in the statistical demand model's
   *  blind spot: cars glide past waiters, and a rider is hauled around until
   *  they despawn because their floor is never this particular car's stop.
   *  Cab stops must be per-car — a rider can only alight from the car they're
   *  in, so their floor being "handled" by some other car delivers nothing.
   *  Staff walking toward a staff-only shaft already raise a hall call so the
   *  car pre-positions instead of retreating to idle just before they arrive
   *  (a walk toward stairs/escalators never calls a car). */
  elevatorCalls(tower: Tower): ElevatorCalls {
    const hall = new Map<number, Map<number, number>>();
    const cab = new Map<number, Map<number, Set<number>>>();
    const bump = (shaftId: number, floor: number) => {
      let floors = hall.get(shaftId);
      if (!floors) hall.set(shaftId, (floors = new Map()));
      floors.set(floor, (floors.get(floor) ?? 0) + 1);
    };
    for (const p of this.people) {
      if (p.shaftId == null) continue;
      if (p.state === "waiting") {
        bump(p.shaftId, p.floor);
      } else if (p.state === "riding" && p.carIndex != null) {
        // Guard the leg lookup — a state-machine hiccup must not leak an
        // undefined floor into the dispatch's call set.
        const dest = p.floors[p.leg + 1];
        if (dest === undefined) continue;
        let cars = cab.get(p.shaftId);
        if (!cars) cab.set(p.shaftId, (cars = new Map()));
        let floors = cars.get(p.carIndex);
        if (!floors) cars.set(p.carIndex, (floors = new Set()));
        floors.add(dest);
      } else if (p.staff && p.state === "toShaft") {
        const shaft = this.shaftOf(tower, p.shaftId);
        if (shaft && isStaffOnlyTransport(shaft.kind)) bump(p.shaftId, p.floor);
      }
    }
    return { hall, cab };
  }

  // ---- Routing ------------------------------------------------------------


  /**
   * The floor → one-ride-reachable-floors graph, built from elevator stops.
   * It only changes when the tower's transports change, so we cache it by
   * {@link Tower.revision} and rebuild lazily instead of on every spawn.
   */
  private adjacency(tower: Tower): Map<number, { f: number; shaft: number }[]> {
    if (this.adj && this.adjRev === tower.revision) return this.adj;
    // Staff-only transports (service elevators) carry no tenants or visitors:
    // that's the whole point of building one.
    this.adj = this.buildAdjacency(tower, tower.transports, (t) => !isStaffOnlyTransport(t.kind));
    this.adjRev = tower.revision;
    return this.adj;
  }

  /** The staff stop-graph: service elevators plus walkable links (stairs and
   *  escalators) — never the passenger elevators. Housekeepers route over
   *  this, using the SAME kind predicate as Tower.staffConnected so routing
   *  and reachability can never disagree. Staff-only elevators are listed
   *  first so equal-leg route ties break toward RIDING the service elevator
   *  rather than climbing stairs — housekeepers ride, and the player sees the
   *  shaft they built actually working. */
  private staffAdjacency(tower: Tower): Map<number, { f: number; shaft: number }[]> {
    if (this.staffAdj && this.staffAdjRev === tower.revision) return this.staffAdj;
    const serviceFirst = [...tower.transports].sort(
      (a, b) => Number(isStaffOnlyTransport(b.kind)) - Number(isStaffOnlyTransport(a.kind)),
    );
    this.staffAdj = this.buildAdjacency(tower, serviceFirst, (t) => isStaffTransportKind(t.kind));
    this.staffAdjRev = tower.revision;
    return this.staffAdj;
  }

  private buildAdjacency(
    tower: Tower,
    transports: readonly Transport[],
    include: (t: Transport) => boolean,
  ): Map<number, { f: number; shaft: number }[]> {
    const adj = new Map<number, { f: number; shaft: number }[]>();
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

  /**
   * BFS over the transport network for the fewest-transfer route. Each edge is
   * one transport ride, and — per the original ("Sims will only take two methods
   * of transportation to their destination") — a trip is capped at TWO rides
   * (i.e. one sky-lobby transfer). A destination needing 3+ rides returns null,
   * so a badly-zoned tower's commuters give up rather than teleporting there.
   */
  private static readonly MAX_RIDES = 2;
  route(tower: Tower, from: number, to: number): Route | null {
    return this.bfsRoute(this.adjacency(tower), from, to, Crowd.MAX_RIDES);
  }

  /** Route over the STAFF network (service elevators / stairs / escalators).
   *  Staff aren't bound by the two-ride comfort rule: the search is UNCAPPED
   *  (the BFS `seen` set terminates it), so it agrees with what
   *  Tower.staffConnected calls reachable — both walk the same
   *  isStaffTransportKind/stopsOf graph. (Parallel implementations: if they
   *  ever drift, spawnStaff reports "no-route" so dispatch can surface it
   *  instead of retrying silently.) */
  staffRoute(tower: Tower, from: number, to: number): Route | null {
    return this.bfsRoute(this.staffAdjacency(tower), from, to, Infinity);
  }

  /** NOTE: edge ORDER is a contract — within a BFS level the first-listed
   *  edge wins (seen is marked on enqueue), which is how staffAdjacency's
   *  service-first ordering expresses the routing preference. Don't replace
   *  this with a priority frontier or Set-deduped adjacency without keeping
   *  that tie-break. */
  private bfsRoute(
    adj: Map<number, { f: number; shaft: number }[]>,
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

  // ---- Spawning -----------------------------------------------------------

  /** Bin every in-service floor into the spawn categories in one pass over
   *  `tower.units` (a `vacating` tenant still commutes through their notice
   *  period). Insertion order is preserved so `rng.pick` stays deterministic. */
  private spawnFloors(tower: Tower, clock: Clock): SpawnFloors {
    const hour = clock.hour;
    const weekend = clock.isWeekend;
    const isVenue = (k: FacilityKind) => k === "shop" || k === "restaurant" || k === "fastFood" || k === "cinema";
    const isStaffKind = (k: FacilityKind): k is StaffKind =>
      k === "security" || k === "medical" || k === "housekeeping" || k === "recycling";
    const leased = new Set<number>();
    const staffed = new Set<number>();
    const homes = new Set<number>();
    const venues = new Set<number>();
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
    };
  }

  /** Decide who travels right now, based on the time of day. */
  private spawnTrips(tower: Tower, clock: Clock, floors: SpawnFloors): void {
    if (this.people.length >= MAX_PEOPLE) return;
    // Reuse the Clock's own commute windows so peak hours never drift out of
    // sync between the simulation and the crowd.
    const morning = clock.isMorning();
    const evening = clock.isEvening();
    const day = !morning && !evening && !clock.isNight();
    const { leasedOffices, staffedOffices, homes, openVenues } = floors;

    const trip = (from: number, to: number) => this.add(tower, from, to);
    // Each call makes one trip, chosen at random from whatever movements fit
    // the hour, so the evening rush is a genuine mix of workers leaving,
    // residents/guests arriving home and diners heading out, rather than only
    // ever emptying the offices (the old if/else chain starved the others).
    const options: Array<() => void> = [];
    if (morning) {
      if (leasedOffices.length) options.push(() => trip(1, this.rng.pick(leasedOffices)));
      if (homes.length) options.push(() => trip(this.rng.pick(homes), 1)); // residents head out
    } else if (evening) {
      if (staffedOffices.length) options.push(() => trip(this.rng.pick(staffedOffices), 1));
      if (homes.length) options.push(() => trip(1, this.rng.pick(homes)));
      if (openVenues.length) options.push(() => trip(1, this.rng.pick(openVenues)));
    } else if (day) {
      if (openVenues.length) options.push(() => trip(1, this.rng.pick(openVenues)));
      if (leasedOffices.length && this.rng.chance(0.3)) options.push(() => trip(1, this.rng.pick(leasedOffices)));
    } else if (openVenues.length) {
      options.push(() => trip(this.rng.pick(openVenues), 1)); // late-night stragglers leaving
    }

    // Meal-cadence overlay: add outbound `origin -> venue` options during the
    // active meal window. Round-trippers self-schedule their own return leg
    // after an eating pause (PR A); no `venue -> origin` options are pushed
    // here. The existing branches above stay untouched; meal options fold into
    // the same weighted pool `rng.pick` fires from. `MAX_PEOPLE` at the top
    // of the method caps the whole thing so tuning meal weights alone bounds
    // saturation.
    this.pushMealOptions(tower, clock, floors, options);

    if (options.length) this.rng.pick(options)();
  }

  /** Contribute meal-window options to `options` when the clock is inside a
   *  meal window. Kept separate from the branch tree above so meal cadence is
   *  clearly additive over the shipped morning/evening/day/night flow. */
  private pushMealOptions(
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
    // are self-scheduled by round-trippers on eating-timer expiry (PR A), so
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
            .filter((s) => staffOnShift(s.kind, clock.hour))
            .map((s) => s.floor);
          push("staff", onShift, staff);
          break;
        }
      }
    }
    if (!originPools.length) return;

    // Per-window contribution. Outbound spawns REAL round-trip persons who
    // handle their own return leg after an eating pause (see spawnMealOutbound,
    // advance's `eating` case, and transitionToReturn). The aggregate return
    // branch that pushed `venue -> origin` options was retired in PR A.
    //
    // The base coefficient is 3 to preserve the shipped pool weight against
    // the morning/evening/night branches; `rng.chance(pool.weight)` gates each
    // option so a low-weight population (condos, 0.3x) contributes with the
    // right probability at every phase, not on/off in coarse chunks.
    const outboundBase = Math.max(0, Math.round(outbound * 3));
    for (const pool of originPools) {
      for (let i = 0; i < outboundBase; i++) {
        if (pool.weight >= 1 || this.rng.chance(pool.weight)) {
          options.push(() => this.spawnMealOutbound(tower, pool, venueFloors, clock.hour, floors));
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
   * `eating` on arrival and to a return trip on eat-timer expiry.
   *
   * If no candidate exists (all workers already out), the call is a no-op:
   * the caller's `rng.pick` fired but no person spawns. The `MAX_PEOPLE` cap
   * self-balances the pool.
   */
  private spawnMealOutbound(
    tower: Tower,
    pool: { originKind: MealOriginKind; floors: number[] },
    venueFloors: number[],
    hour: number,
    floors: SpawnFloors,
  ): void {
    const originFloor = this.rng.pick(pool.floors);
    // Candidate units on the chosen floor of the right kind with at least one
    // available (in-room) occupant. For the "staff" bucket, ALSO gate on
    // on-shift status per unit kind: an off-shift housekeeping room can be on
    // the same floor as an on-shift security room, and the pool-floor bin only
    // guarantees at least one on-shift kind exists — the per-unit filter here
    // makes sure the picked unit is itself on shift (review Blind #5).
    const floorUnits = floors.unitsByFloor.get(originFloor) ?? [];
    const candidates = floorUnits.filter(
      (u) =>
        matchesMealOriginKind(u, pool.originKind) &&
        (pool.originKind !== "staff" || staffOnShift(u.kind as StaffKind, hour)) &&
        visibleOccupants(u) > 0,
    );
    if (candidates.length === 0) return;
    const origin = this.rng.pick(candidates);
    const venueFloor = this.rng.pick(venueFloors);
    // The route is computed by `this.add`, which may fail (route unreachable
    // from origin to venue). If it fails, no person exists and we must not
    // increment outForMeal. Order: add first, THEN increment on the returned
    // person object.
    const spawned = this.add(tower, originFloor, venueFloor);
    if (!spawned) return;
    spawned.originUnitId = origin.id;
    origin.outForMeal = (origin.outForMeal ?? 0) + 1;
  }

  /** Build a person on `route`, walking to `destX` at the end. Shared by
   *  tenant and staff spawns so the two can never drift field-by-field. */
  private makePerson(tower: Tower, route: Route, destX: number): Person {
    const from = route.floors[0];
    const seed = (this.nextId * 2654435761) | 0;
    const person: Person = {
      id: this.nextId++,
      seed,
      // A route with no rides (same floor) goes straight to the stroll leg.
      state: route.shafts.length === 0 ? "toDest" : "toShaft",
      floor: from,
      fy: from,
      x: this.pickX(tower, from, seed),
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
    this.people.push(person);
    return person;
  }

  private add(tower: Tower, from: number, to: number): Person | null {
    const r = this.route(tower, from, to);
    if (!r || r.shafts.length === 0) return null; // unreachable — no point spawning
    return this.makePerson(tower, r, this.pickX(tower, to, (this.nextId * 2654435761) | 0));
  }

  /** Live staff members on shift (a counter so the spawn cap never has to
   *  scan the whole crowd). */
  private staffCount = 0;

  /**
   * Dispatch a staff member (housekeeper) from `from` to `to` over the STAFF
   * network, walking to `destX` (the room being serviced). The two failure
   * modes are distinct so the caller reacts correctly: "full" (staff pool at
   * cap — retry later) vs "no-route" (the network can't get there — surface
   * it, don't retry silently).
   */
  spawnStaff(
    tower: Tower,
    from: number,
    to: number,
    destX: number,
    cleanUnitId: number,
  ): "sent" | "full" | "no-route" {
    if (this.staffCount >= MAX_STAFF) return "full";
    const r = this.staffRoute(tower, from, to); // handles from === to (walk only)
    if (!r) return "no-route";
    const p = this.makePerson(tower, r, destX);
    p.staff = true;
    p.cleanUnitId = cleanUnitId;
    this.staffCount++;
    return "sent";
  }

  private static readonly NO_RESULTS: { unitId: number; ok: boolean }[] = [];

  /** Drain the staff jobs that ended since the last call (arrived or failed). */
  takeStaffResults(): { unitId: number; ok: boolean }[] {
    if (this.staffDone.length === 0) return Crowd.NO_RESULTS;
    const out = this.staffDone;
    this.staffDone = [];
    return out;
  }

  /** An actual built structural tile of a floor (so people stand on solid
   * ground, never in a gap between separate corridor runs). Falls back to a
   * sensible spot if the floor is bare. */
  private pickX(tower: Tower, floor: number, seed: number): number {
    const tiles: number[] = [];
    for (const u of tower.units) {
      if ((u.kind === "floor" || u.kind === "lobby") && u.floor === floor) {
        for (let i = 0; i < u.width; i++) tiles.push(u.x + i);
      }
    }
    if (tiles.length === 0) return 2 + (Math.abs(seed) % 40);
    return tiles[Math.abs(seed) % tiles.length];
  }

  // ---- Per-frame update ---------------------------------------------------

  /** At fast game speeds a single tick can span tens of crowd-seconds, but the
   *  person state machine only makes ~one transition per pass (one boarding
   *  window, one alight check) while the give-up clock charges the full span —
   *  so long trips die by quantization, not by bad service. Sub-stepping makes
   *  coarse ticks simulate the way fine ones do. */
  private static readonly SUB_STEP = 5;

  update(dtSec: number, tower: Tower, clock: Clock): void {
    this.spawn(dtSec, tower, clock);
    while (dtSec > Crowd.SUB_STEP) {
      this.advance(Crowd.SUB_STEP, tower);
      dtSec -= Crowd.SUB_STEP;
    }
    this.advance(dtSec, tower);
  }

  /** Spawn new trips for a span of time. Split out from {@link advance} because
   *  spawning scans the whole unit list — it must run once per outer sim step,
   *  not once per fine-grained sub-step, or huge towers grind. */
  spawn(dtSec: number, tower: Tower, clock: Clock): void {
    // Spawn at a rate that scales with how busy the hour is AND how populated the
    // tower is (review F39) — a 6-office tower and a 12,000-pop tower no longer
    // spawn identically. The MAX_PEOPLE cap in spawnTrips still bounds the total.
    const timeRate = clock.isNight() ? 0.3 : clock.isWeekend ? 1.2 : 2.2;
    const popFactor = Math.min(3, 0.4 + tower.totalPopulation() / 2000);
    this.spawnAcc += dtSec * timeRate * popFactor;
    if (this.spawnAcc < 1) return;
    // Categorize floors once per outer step: the drain loop below only adds
    // people (never units), so the four lists are stable across its iterations.
    const floors = this.spawnFloors(tower, clock);
    let guard = 0;
    while (this.spawnAcc >= 1 && guard++ < 8) {
      this.spawnAcc -= 1;
      this.spawnTrips(tower, clock, floors);
    }
  }

  /** Advance every person by a (short) time slice — see SUB_STEP. */
  advance(dtSec: number, tower: Tower): void {
    let frustrated = 0;
    let travelling = 0;
    for (const p of this.people) {
      p.age += dtSec;
      // Give up if the journey drags on too long — a fed-up traveller who
      // leaves rather than riding forever toward a floor no car will serve.
      // (Staff are on the clock and wait much longer; a failed job is handed
      // back to housekeeping dispatch to retry.) The budget also scales with
      // the trip's ride distance so a legitimate long haul up a tall tower
      // isn't culled mid-ride.
      const patience = (p.staff ? STAFF_GIVE_UP : GIVE_UP) + this.tripFloors(p) * RIDE_SECONDS_PER_FLOOR;
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
        this.finish(p, tower);
        continue;
      }
      this.step(p, dtSec, tower);
      // Staff never count toward tenant stress — a housekeeper waiting for the
      // service elevator is payroll, not an unhappy customer.
      if (!p.staff && (p.state === "waiting" || p.state === "riding" || p.state === "toShaft" || p.state === "climbing")) {
        travelling++;
        if (p.wait > STRESS_WAIT) frustrated++;
      }
    }
    // Smooth the frustration signal the sim reads for satisfaction.
    const target = travelling > 0 ? frustrated / travelling : 0;
    this.frustration += (target - this.frustration) * Math.min(1, dtSec * 0.5);

    this.people = this.people.filter((p) => p.state !== "done");
  }

  private shaftOf(tower: Tower, id: number | null): Transport | undefined {
    return id == null ? undefined : tower.getTransport(id);
  }

  /** Total floors this trip covers across all its legs. */
  private tripFloors(p: Person): number {
    let n = 0;
    for (let i = 0; i + 1 < p.floors.length; i++) n += Math.abs(p.floors[i + 1] - p.floors[i]);
    return n;
  }

  private step(p: Person, dt: number, tower: Tower): void {
    switch (p.state) {
      case "toShaft": {
        const shaft = this.shaftOf(tower, p.shaftId);
        if (!shaft) return this.finish(p, tower);
        const targetX = shaft.x + shaft.width / 2;
        if (this.walkTo(p, targetX, dt)) {
          // Elevators are boarded (wait for a car); stairs/escalators are
          // simply climbed on foot.
          if (isElevatorKind(shaft.kind)) {
            p.state = "waiting";
            p.wait = 0;
          } else {
            p.state = "climbing";
            p.wait = 0; // climbing is on-foot, never "waiting" — don't inflate stress
          }
        }
        break;
      }
      case "climbing": {
        const shaft = this.shaftOf(tower, p.shaftId);
        if (!shaft) return this.finish(p, tower);
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
        const shaft = this.shaftOf(tower, p.shaftId);
        if (!shaft) return this.finish(p, tower);
        // Board a car of this shaft that's stopped at our floor with room.
        for (let i = 0; i < shaft.cars; i++) {
          if (Math.abs(shaft.carPositions[i] - p.floor) > 0.25) continue;
          const key = `${shaft.id}:${i}`;
          const n = this.carRiders.get(key) ?? 0;
          if (n >= CAR_CAPACITY) continue;
          this.carRiders.set(key, n + 1);
          p.carIndex = i;
          p.state = "riding";
          // The call is served — clear the wait so a once-slow pickup doesn't
          // keep counting toward frustration for the whole ride (and doesn't
          // leave the figure red-"!" while strolling off at the destination).
          p.wait = 0;
          break;
        }
        break;
      }
      case "riding": {
        const shaft = this.shaftOf(tower, p.shaftId);
        // The car can vanish from under a rider — the shaft bulldozed, or the
        // player trimming the car count (Tower.setCars shrinks carPositions).
        // Either way, step off and move on rather than riding a phantom car.
        if (!shaft || p.carIndex == null || p.carIndex >= shaft.carPositions.length) {
          return this.finish(p, tower);
        }
        const pos = shaft.carPositions[p.carIndex];
        const prev = p.fy;
        p.fy = pos;
        p.x = shaft.x + shaft.width / 2;
        const dest = p.floors[p.leg + 1];
        // Arrived if the car is at the floor — or passed it between samples
        // (cars move up to ~a floor per step at coarse ticks, so a pure
        // proximity check can sail a rider straight past their stop). Never
        // alight at a floor the shaft no longer stops at (express skip-floors
        // reconfigured mid-ride): ride on until the give-up valve resolves it.
        const arrived = Math.abs(pos - dest) < 0.2 || (prev - dest) * (pos - dest) <= 0;
        if (arrived && tower.stopsAt(shaft, dest)) {
          // Arrived at this leg's floor — step off.
          this.releaseSeat(p);
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
        if (this.walkTo(p, p.destX, dt)) {
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
              p.eatSecondsLeft = this.rng.int(EAT_SECONDS_MIN, EAT_SECONDS_MAX);
            } else {
              this.finish(p, tower);
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
        if (p.eatSecondsLeft <= 0) this.transitionToReturn(tower, p);
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
  private transitionToReturn(tower: Tower, p: Person): void {
    const origin = p.originUnitId !== undefined ? tower.units.find((u) => u.id === p.originUnitId) : undefined;
    if (!origin) {
      // Ghost origin: unit was bulldozed while the person was eating, so there
      // is no origin unit left to decrement. Just despawn.
      p.originUnitId = undefined;
      this.finish(p, tower);
      return;
    }
    const venueFloor = p.floor;
    const originFloor = origin.floor;
    const route = this.route(tower, venueFloor, originFloor);
    if (!route || route.shafts.length === 0) {
      // Return route unreachable (transport degraded while eating). The person
      // "went home some other way"; the accounting must still balance, so
      // finish() decrements outForMeal via the ghost-guarded path below.
      p.returning = true;
      this.finish(p, tower);
      return;
    }
    p.floors = route.floors;
    p.shafts = route.shafts;
    p.leg = 0;
    p.shaftId = route.shafts[0] ?? null;
    p.carIndex = null;
    p.state = "toShaft";
    p.wait = 0;
    p.age = 0;
    p.linger = 0;
    p.destX = this.pickX(tower, originFloor, p.seed);
    p.returning = true;
  }

  /** Walk toward a tile x on the current floor; returns true once arrived. */
  private walkTo(p: Person, targetX: number, dt: number): boolean {
    const dx = targetX - p.x;
    const step = WALK_SPEED * dt;
    if (Math.abs(dx) <= step) {
      p.x = targetX;
      return true;
    }
    p.x += Math.sign(dx) * step;
    return false;
  }

  /** Free this person's seat in their current car (if aboard), so bulldozing
   * a shaft mid-ride never leaks rider counts and shrinks a car's capacity. */
  private releaseSeat(p: Person): void {
    if (p.carIndex == null || p.shaftId == null) return;
    const key = `${p.shaftId}:${p.carIndex}`;
    this.carRiders.set(key, Math.max(0, (this.carRiders.get(key) ?? 1) - 1));
    p.carIndex = null;
  }

  private finish(p: Person, tower: Tower): void {
    this.releaseSeat(p);
    // Report a staff job's outcome: it succeeded only if the staffer actually
    // made it to the destination floor (state "toDest"); a give-up or a shaft
    // vanishing mid-route hands the job back to dispatch as failed.
    if (p.staff) {
      this.staffCount = Math.max(0, this.staffCount - 1);
      if (p.cleanUnitId !== undefined) {
        this.staffDone.push({ unitId: p.cleanUnitId, ok: p.state === "toDest" });
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
    if (p.originUnitId !== undefined) {
      const origin = tower.units.find((u) => u.id === p.originUnitId);
      if (origin && (origin.outForMeal ?? 0) > 0) {
        origin.outForMeal = (origin.outForMeal ?? 0) - 1;
      }
    }
    p.state = "done";
  }
}
