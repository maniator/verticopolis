import type { Clock } from "./Clock";
import type { Tower } from "./Tower";
import { RNG } from "./rng";
import type { Person, Route, ElevatorCalls, ElevatorQueueView } from "./crowd/person";
import * as routing from "./crowd/routing";
import * as motion from "./crowd/motion";
import * as crowdSpawn from "./crowd/spawn";

/**
 * The tower's drawn crowd: the pool of {@link Person} figures and the machinery
 * that spawns, routes, and steps them. This is the class shell; the cohesive
 * pieces live in siblings under `crowd/` and are wired in as friend functions
 * that take this instance:
 *   - `crowd/person.ts`: the Person model, tuning constants, `visibleOccupants`.
 *   - `crowd/meals.ts`: the meal-window cadence tables and pure helpers.
 *   - `crowd/routing.ts`: adjacency graphs, BFS routing, elevator calls.
 *   - `crowd/spawn.ts`: the spawn cadence (trips, meal overlay, staff dispatch).
 *   - `crowd/motion.ts`: the per-frame state machine (walk / ride / eat).
 * The public surface is re-exported at the bottom so every importer is unchanged.
 *
 * This module is deliberately DOM-free so it can be unit-tested; the renderer
 * reads {@link Crowd.people} each frame and draws them. It advances on real
 * seconds (passed in by the renderer) so people move at a steady, watchable
 * pace regardless of the game-speed time compression.
 */
export class Crowd {
  // Fields marked `@internal` below are read/written by the friend modules
  // (routing/spawn/motion) that take this instance; treat them as private.
  people: Person[] = [];
  /** @internal */ rng: RNG;
  /** @internal Monotonic person-id source. */ nextId = 1;
  /** @internal Fractional spawn accumulator carried across steps. */ spawnAcc = 0;
  /** @internal Riders currently aboard each car, keyed "shaftId:carIndex". */
  carRiders = new Map<string, number>();
  /** @internal Rolling fraction of recent travellers who waited too long (0..1). */
  frustration = 0;
  /** @internal Cached passenger stop-graph, rebuilt when the tower changes. */
  adj: Map<number, { f: number; shaft: number; express: boolean }[]> | null = null;
  /** @internal */ adjRev = -1;
  /** @internal Cached STAFF stop-graph (service elevators / stairs / escalators). */
  staffAdj: Map<number, { f: number; shaft: number; express: boolean }[]> | null = null;
  /** @internal */ staffAdjRev = -1;
  /** @internal Cinema unit ids showing a blockbuster this month, primed once
   *  per outer step by the sim loop from the EconomySystem's bookings (the
   *  crowd never sees the economy directly). Read by the venue-visit spawn
   *  path to weight the bigger blockbuster crowd; standalone-crowd tests can
   *  leave it empty or set it directly. */
  blockbusters: ReadonlySet<number> = new Set();
  /** @internal Finished staff jobs since the last drain (unit id + reached-dest). */
  staffDone: { unitId: number; ok: boolean }[] = [];
  /** @internal Live staff on shift (a counter so the spawn cap never scans all). */
  staffCount = 0;
  /** @internal Monotonic outer-step counter, bumped once per sim step by
   *  {@link beginStep} (called right after ElevatorDispatch.accumulate). It keys
   *  the per-step memo of the read-only {@link queueView}, the way tower.revision
   *  keys Tower.stopsCache: queue contents change every step, not per structural
   *  edit, so the token advances per step rather than per revision. */
  step = 0;
  /** @internal Memoized queue projection and the (step, revision) key it was
   *  built for. Keyed on the outer-step token AND tower.revision, so a
   *  structural edit made while the sim is paused (step frozen, revision bumped)
   *  still invalidates it instead of serving a stale projection for the pause. */
  private queueCache: ElevatorQueueView | null = null;
  /** @internal */ private queueStep = -1;
  /** @internal */ private queueRev = -1;

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
    this.blockbusters = new Set();
    this.step = 0;
    this.queueCache = null;
    this.queueStep = -1;
    this.queueRev = -1;
  }

  /** 0..1: how stressed the current crowd is by elevator waits. */
  get stress(): number {
    return this.frustration;
  }

  /**
   * Venue-associated meal-customer census: how many tower occupants are
   * currently out on a meal round-trip (heading to a venue, `dwelling`, or
   * returning). This is a separate venue-side census seam for meal traffic; it
   * does not change HUD population or star-rating population, which stay on the
   * canonical room census.
   *
   * The count is read from the derived `outForMeal` overlay each origin unit
   * carries (delegated to {@link Tower.associatedPopulation}); spawn increments
   * exactly one origin and every despawn path decrements exactly one, so each
   * round-tripper is counted once with no scan of the Person array and no
   * double-count against {@link Tower.totalPopulation}, which already counts the
   * origin unit's static residents. `opts.excludeHotelOrigin` drops hotel-origin
   * customers so the star census can keep the canon "hotel guests stop counting
   * at 4 stars" rule.
   */
  mealAssociatedPopulation(tower: Tower, opts?: { excludeHotelOrigin?: boolean }): number {
    return tower.associatedPopulation(opts);
  }

  /** Live elevator calls from real people, for the dispatch (routing module). */
  elevatorCalls(tower: Tower): ElevatorCalls {
    return routing.elevatorCalls(this, tower);
  }

  /** Open a new outer sim step: invalidates the per-step {@link queueView} memo.
   *  Called once per step from the sim loop, right after
   *  ElevatorDispatch.accumulate, so the projection is derived at most once per
   *  step and never inside the car/crowd sub-step loop. */
  beginStep(): void {
    this.step++;
  }

  /** Read-only elevator queue + car-fill projection for the render layer
   *  (routing module), memoized on the (step, revision) key. The sim loop primes
   *  it once per outer step (right after {@link beginStep}), so the single
   *  `crowd.people` scan normally lands in the sim step and a render frame between
   *  steps reads the cached snapshot without scanning. The one exception: a
   *  structural edit made while paused bumps `revision` with the step frozen, so
   *  the next call (possibly a render frame) rebuilds once. Mirrors how
   *  {@link Tower.stopsOf} caches by revision. */
  queueView(tower: Tower): ElevatorQueueView {
    if (this.queueCache && this.queueStep === this.step && this.queueRev === tower.revision) {
      return this.queueCache;
    }
    // Build into a local FIRST, then stamp the key and cache together: if the
    // builder throws, neither the token nor the cache advances, so a same-step
    // retry rebuilds instead of returning a stale-but-same-step snapshot.
    const view = routing.elevatorQueueView(this, tower);
    this.queueStep = this.step;
    this.queueRev = tower.revision;
    this.queueCache = view;
    return view;
  }

  /** Fewest-transfer passenger route (two-ride cap), delegated to routing. */
  route(tower: Tower, from: number, to: number): Route | null {
    return routing.route(this, tower, from, to);
  }

  /** Uncapped staff-network route (service elevators / stairs / escalators). */
  staffRoute(tower: Tower, from: number, to: number): Route | null {
    return routing.staffRoute(this, tower, from, to);
  }

  /** Spawn new trips for a span of time (delegated to the spawn module). Split
   *  from {@link update} because spawning scans the whole unit list: it must run
   *  once per outer sim step, not once per fine-grained sub-step. */
  spawn(dtSec: number, tower: Tower, clock: Clock): void {
    crowdSpawn.spawnStep(this, dtSec, tower, clock);
  }

  /**
   * Dispatch a staff member (housekeeper) over the STAFF network (delegated to
   * the spawn module). Returns "sent", "full" (pool at cap, retry), or
   * "no-route" (the network can't get there, surface it).
   */
  spawnStaff(tower: Tower, from: number, to: number, destX: number, cleanUnitId: number): "sent" | "full" | "no-route" {
    return crowdSpawn.spawnStaff(this, tower, from, to, destX, cleanUnitId);
  }

  /** Drain the staff jobs that ended since the last call (arrived or failed). */
  takeStaffResults(): readonly { unitId: number; ok: boolean }[] {
    return crowdSpawn.takeStaffResults(this);
  }

  /** Per-frame entry point: spawn new trips, then step everyone (delegates to
   *  the motion module, which sub-steps coarse ticks). */
  update(dtSec: number, tower: Tower, clock: Clock): void {
    motion.update(this, dtSec, tower, clock);
  }

  /** Advance every person by a (short) time slice (delegates to motion). */
  advance(dtSec: number, tower: Tower): void {
    motion.advance(this, dtSec, tower);
  }
}

// ---- Barrel: preserve the original public surface of this module. ----
export {
  CROWD_SECONDS_PER_MINUTE,
  EAT_SECONDS_MIN,
  EAT_SECONDS_MAX,
  visibleOccupants,
  type Person,
  type PersonState,
  type StaffKind,
  type ElevatorCalls,
  type ElevatorQueueView,
  type QueueLanding,
} from "./crowd/person";
export { MEAL_WINDOWS, mealWindowFor, staffOnShift, type MealWindow } from "./crowd/meals";
