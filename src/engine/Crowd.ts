import type { Clock } from "./Clock";
import type { Tower } from "./Tower";
import type { FacilityKind, Transport, Unit } from "./types";
import { isElevatorKind, isHotelKind, isOpenAt } from "./facilities";
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

const WALK_SPEED = 6; // tiles per second
const CAR_CAPACITY = 6; // visible riders per car
const MAX_PEOPLE = 140;
/** Staff travel outside the tenant cap (they must be able to work even in a
 *  packed tower) but stay bounded so dispatch can't flood the screen. */
const MAX_STAFF = 24;
const STRESS_WAIT = 25; // seconds of waiting that counts as "fed up"
/**
 * A commuter who hasn't reached their floor within this many real seconds gives
 * up and leaves — a safety valve so nobody is ever stranded forever (a car the
 * aggregate scheduler never sends to their floor, an elevator removed from
 * under them) silently consuming the on-screen population cap.
 */
const GIVE_UP = 90;
/** Staff are on the clock: they wait far longer before abandoning a job (their
 *  give-up only guards against a truly unreachable call, and the failed room
 *  is re-dispatched later). */
const STAFF_GIVE_UP = GIVE_UP * 8;

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
  }

  /** 0..1 — how stressed the current crowd is by elevator waits. */
  get stress(): number {
    return this.frustration;
  }

  // ---- Routing ------------------------------------------------------------

  /** Floors a transport actually stops at. */
  private stopsOf(tower: Tower, t: Transport): number[] {
    const s: number[] = [];
    for (let f = t.bottom; f <= t.top; f++) if (tower.stopsAt(t, f)) s.push(f);
    return s;
  }

  /**
   * The floor → one-ride-reachable-floors graph, built from elevator stops.
   * It only changes when the tower's transports change, so we cache it by
   * {@link Tower.revision} and rebuild lazily instead of on every spawn.
   */
  private adjacency(tower: Tower): Map<number, { f: number; shaft: number }[]> {
    if (this.adj && this.adjRev === tower.revision) return this.adj;
    // Service elevators are staff-only: tenants and visitors never route
    // over them (canon — that's the whole point of building one).
    this.adj = this.buildAdjacency(tower, (t) => t.kind !== "elevatorService");
    this.adjRev = tower.revision;
    return this.adj;
  }

  /** The staff stop-graph: service elevators plus walkable links (stairs and
   *  escalators) — never the passenger lifts. Housekeepers route over this. */
  private staffAdjacency(tower: Tower): Map<number, { f: number; shaft: number }[]> {
    if (this.staffAdj && this.staffAdjRev === tower.revision) return this.staffAdj;
    this.staffAdj = this.buildAdjacency(
      tower,
      (t) => t.kind === "elevatorService" || t.kind === "stairs" || t.kind === "escalator",
    );
    this.staffAdjRev = tower.revision;
    return this.staffAdj;
  }

  private buildAdjacency(
    tower: Tower,
    include: (t: Transport) => boolean,
  ): Map<number, { f: number; shaft: number }[]> {
    const adj = new Map<number, { f: number; shaft: number }[]>();
    for (const t of tower.transports) {
      if (!include(t)) continue;
      // Elevators carry riders in cars; stairs/escalators are walked (a
      // "climbing" leg, no car). Both are real routing edges now, so short
      // hops travel on foot and BFS still prefers a single long elevator ride
      // (one transfer) over many stair flights for tall trips.
      const stops = this.stopsOf(tower, t);
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
  /** Staff aren't bound by the two-ride comfort rule — a housekeeper will chain
   *  stairs and service lifts as far as the network reaches (bounded to keep
   *  the BFS finite on degenerate towers). */
  private static readonly MAX_STAFF_RIDES = 10;
  route(tower: Tower, from: number, to: number): Route | null {
    return this.bfsRoute(this.adjacency(tower), from, to, Crowd.MAX_RIDES);
  }

  /** Route over the STAFF network (service elevators / stairs / escalators). */
  staffRoute(tower: Tower, from: number, to: number): Route | null {
    return this.bfsRoute(this.staffAdjacency(tower), from, to, Crowd.MAX_STAFF_RIDES);
  }

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

  private add(tower: Tower, from: number, to: number): void {
    const r = this.route(tower, from, to);
    if (!r || r.shafts.length === 0) return; // unreachable — no point spawning
    const seed = (this.nextId * 2654435761) | 0;
    this.people.push({
      id: this.nextId++,
      seed,
      state: "toShaft",
      floor: from,
      fy: from,
      x: this.pickX(tower, from, seed),
      floors: r.floors,
      shafts: r.shafts,
      leg: 0,
      shaftId: r.shafts[0],
      carIndex: null,
      wait: 0,
      age: 0,
      linger: 0,
      destX: this.pickX(tower, to, seed),
    });
  }

  /**
   * Dispatch a staff member (housekeeper) from `from` to `to` over the STAFF
   * network, walking to `destX` (the room being serviced). Returns false when
   * no staff route exists or too many staff are already on shift; the caller
   * keeps the job queued and retries later.
   */
  spawnStaff(tower: Tower, from: number, to: number, destX: number, cleanUnitId: number): boolean {
    let staffCount = 0;
    for (const p of this.people) if (p.staff) staffCount++;
    if (staffCount >= MAX_STAFF) return false;
    // Same floor needs no ride — the housekeeper just walks down the corridor.
    const r = from === to ? { floors: [from], shafts: [] } : this.staffRoute(tower, from, to);
    if (!r) return false;
    const seed = (this.nextId * 2654435761) | 0;
    this.people.push({
      id: this.nextId++,
      seed,
      state: r.shafts.length === 0 ? "toDest" : "toShaft",
      floor: from,
      fy: from,
      x: this.pickX(tower, from, seed),
      floors: r.floors,
      shafts: r.shafts,
      leg: 0,
      shaftId: r.shafts[0] ?? null,
      carIndex: null,
      wait: 0,
      age: 0,
      linger: 0,
      destX,
      staff: true,
      cleanUnitId,
    });
    return true;
  }

  /**
   * Live elevator calls from staff, for the dispatcher: floors where staff are
   * heading to / waiting at a shaft, plus the destinations of staff already
   * riding — so service cars actually come for them and then deliver them.
   * Rebuilt fresh each tick from the people themselves.
   */
  staffCalls(): Map<number, number> {
    const calls = new Map<number, number>();
    const bump = (f: number) => calls.set(f, (calls.get(f) ?? 0) + 1);
    for (const p of this.people) {
      if (!p.staff) continue;
      if (p.state === "toShaft" || p.state === "waiting") bump(p.floor);
      else if (p.state === "riding") bump(p.floors[p.leg + 1]);
    }
    return calls;
  }

  /** Drain the staff jobs that ended since the last call (arrived or failed). */
  takeStaffResults(): { unitId: number; ok: boolean }[] {
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

  update(dtSec: number, tower: Tower, clock: Clock): void {
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

    let frustrated = 0;
    let travelling = 0;
    for (const p of this.people) {
      p.age += dtSec;
      // Give up if the journey drags on too long — a fed-up traveller who
      // leaves rather than riding forever toward a floor no car will serve.
      // (Staff are on the clock and wait much longer; a failed job is handed
      // back to housekeeping dispatch to retry.)
      if (p.age > (p.staff ? STAFF_GIVE_UP : GIVE_UP) && p.state !== "toDest" && p.state !== "done") {
        if (!p.staff) {
          frustrated++;
          travelling++;
        }
        this.finish(p);
        continue;
      }
      this.step(p, dtSec, tower);
      // Staff never count toward tenant stress — a housekeeper waiting for the
      // service lift is payroll, not an unhappy customer.
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
        p.fy = pos;
        p.x = shaft.x + shaft.width / 2;
        const dest = p.floors[p.leg + 1];
        if (Math.abs(pos - dest) < 0.2) {
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
    if (p.staff && p.cleanUnitId !== undefined) {
      this.staffDone.push({ unitId: p.cleanUnitId, ok: p.state === "toDest" });
    }
    p.state = "done";
  }
}
