import type { Clock } from "./Clock";
import type { Tower } from "./Tower";
import type { FacilityKind, Transport, Unit } from "./types";
import { CAR_FLOORS_PER_MINUTE } from "./ElevatorDispatch";
import { isElevatorKind, isHotelKind, isOpenAt, isStaffOnlyTransport, isStaffTransportKind } from "./facilities";
import { RNG } from "./rng";

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

export type PersonState = "toShaft" | "waiting" | "riding" | "climbing" | "toDest" | "done";

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
}

/** A transport route as a list of floors and the shaft used between each. */
interface Route {
  floors: number[];
  shafts: number[];
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

  /** Floors carrying an in-service unit (occupied/asleep) that matches `pred`. */
  private floorsWhere(tower: Tower, pred: (u: Unit) => boolean): number[] {
    const set = new Set<number>();
    for (const u of tower.units) {
      if ((u.state === "occupied" || u.state === "asleep") && pred(u)) set.add(u.floor);
    }
    return [...set];
  }

  /** Decide who travels right now, based on the time of day. */
  private spawnTrips(tower: Tower, clock: Clock): void {
    if (this.people.length >= MAX_PEOPLE) return;
    // Reuse the Clock's own commute windows so peak hours never drift out of
    // sync between the simulation and the crowd.
    const hour = clock.hour;
    const morning = clock.isMorning();
    const evening = clock.isEvening();
    const day = !morning && !evening && !clock.isNight();
    const isVenue = (k: FacilityKind) => k === "shop" || k === "restaurant" || k === "fastFood" || k === "cinema";
    // Offices are leased year-round but only staffed on weekdays, so inbound
    // workers only head to weekday offices.
    const leasedOffices = clock.isWeekend ? [] : this.floorsWhere(tower, (u) => u.kind === "office");
    // Outbound office trips require workers actually present right now (presence
    // zeroes occupants after 18:00 and at weekends), so we never spawn commuters
    // leaving an empty office through the back half of the evening window.
    const staffedOffices = this.floorsWhere(tower, (u) => u.kind === "office" && u.occupants > 0);
    const homes = this.floorsWhere(tower, (u) => u.kind === "condo" || isHotelKind(u.kind));
    // Venues are destinations only while they're actually open for business, so
    // visible demand tracks the same hours the economy and sprites use.
    const openVenues = this.floorsWhere(tower, (u) => isVenue(u.kind) && isOpenAt(u.kind, hour));

    const trip = (from: number, to: number) => this.add(tower, from, to);
    // Each call makes one trip, chosen at random from whatever movements fit
    // the hour — so the evening rush is a genuine mix of workers leaving,
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
    if (options.length) this.rng.pick(options)();
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

  private add(tower: Tower, from: number, to: number): void {
    const r = this.route(tower, from, to);
    if (!r || r.shafts.length === 0) return; // unreachable — no point spawning
    this.makePerson(tower, r, this.pickX(tower, to, (this.nextId * 2654435761) | 0));
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
    let guard = 0;
    while (this.spawnAcc >= 1 && guard++ < 8) {
      this.spawnAcc -= 1;
      this.spawnTrips(tower, clock);
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
      if (p.age > patience && p.state !== "toDest" && p.state !== "done") {
        if (!p.staff) {
          frustrated++;
          travelling++;
        }
        this.finish(p);
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
    return id == null ? undefined : tower.transports.find((t) => t.id === id);
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
        if (!shaft) return this.finish(p);
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
        if (!shaft) return this.finish(p);
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
        if (!shaft) return this.finish(p);
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
          return this.finish(p);
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
          if (p.linger > 2) this.finish(p);
        }
        break;
      }
      default:
        break;
    }
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

  private finish(p: Person): void {
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
    p.state = "done";
  }
}
