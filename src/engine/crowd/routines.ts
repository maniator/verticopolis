import type { Clock } from "../Clock";
import type { Tower } from "../Tower";
import type { Crowd } from "../Crowd";
import type { SpawnFloors } from "./person";
import { visibleOccupants } from "./person";
import { add } from "./trips";
import {
  SCHOOL_RUN_DEPART_START,
  SCHOOL_RUN_DEPART_END,
  SCHOOL_RUN_RETURN_START,
  SCHOOL_RUN_RETURN_END,
  SALES_CALL_START,
  SALES_CALL_END,
} from "../sim/constants";

/**
 * Demographic routines (condo-demographic-routines, #397): the statistical
 * spawn-mix biases the SimTower optimization thread describes. Occupied condos
 * emit a weekday-morning school-departure wave and a matching early-afternoon
 * return wave; occupied offices emit occasional midday sales-call round trips.
 * Both are Modern-only, resolved through {@link GameRules.demographicRoutines}
 * (the crowd never branches on the mode string): Classic reads zero weights
 * and {@link pushRoutineOptions} returns before its first RNG draw, so the
 * Classic seeded crowd stream stays byte-identical to before the feature.
 *
 * Purely statistical rates, exactly like the meal overlay this module is a
 * sibling of: no per-sim identity, nothing persisted about who is a child or
 * which worker is out selling. The trips ride the existing crowd/traffic
 * machinery (they organically add elevator load in their windows) and add no
 * income or satisfaction mechanics. Hour windows are structural constants in
 * `sim/constants.ts`; magnitudes are `ECON.demographicRoutineWeights`.
 */

/** The street door every routine leg passes through. */
const GROUND_LOBBY = 1;

/**
 * Contribute demographic-routine options to the shared weighted spawn pool,
 * additive over the commute branches and the meal/visit overlays exactly like
 * {@link pushMealOptions}. Each active routine contributes at most one option
 * per pass, gated by its weight the way the meal population weights are
 * (`weight >= 1` contributes without a draw). School runs are weekday-only
 * (there is no school on weekends); sales calls inherit weekday-only for free
 * from `staffedOffices` being empty on weekends. `MAX_PEOPLE` at the top of
 * `spawnTrips` bounds the whole pool, so the routines can never flood it.
 */
export function pushRoutineOptions(
  crowd: Crowd,
  tower: Tower,
  clock: Clock,
  floors: SpawnFloors,
  options: Array<() => void>,
): void {
  const weights = tower.rules.demographicRoutines();
  // The zero-draw gate: with every routine disabled (Classic), leave before
  // any RNG use so the seeded stream is untouched (golden-master invariant).
  if (weights.schoolRun <= 0 && weights.salesCall <= 0) return;
  const hour = clock.hour;
  if (weights.schoolRun > 0 && !clock.isWeekend && floors.householdFloors.length > 0) {
    if (hour >= SCHOOL_RUN_DEPART_START && hour < SCHOOL_RUN_DEPART_END && passes(crowd, weights.schoolRun)) {
      options.push(() => spawnSchoolDeparture(crowd, tower, floors));
    }
    if (hour >= SCHOOL_RUN_RETURN_START && hour < SCHOOL_RUN_RETURN_END && passes(crowd, weights.schoolRun)) {
      options.push(() => spawnSchoolReturn(crowd, tower, floors));
    }
  }
  if (
    weights.salesCall > 0 &&
    floors.staffedOffices.length > 0 &&
    hour >= SALES_CALL_START &&
    hour < SALES_CALL_END &&
    passes(crowd, weights.salesCall)
  ) {
    options.push(() => spawnSalesCall(crowd, tower, floors));
  }
}

/** Weight gate, the same shape the meal origin pools use: a weight of 1 or
 *  more contributes without an RNG draw. Only ever reached with weight > 0. */
function passes(crowd: Crowd, weight: number): boolean {
  return weight >= 1 || crowd.rng.chance(weight);
}

/**
 * One school-run departure: a child from an occupied condo (someone still
 * visibly in the room, the meal spawn's origin rule) rides down and leaves
 * through the ground lobby. A ONE-WAY leg: the matching return is its own
 * statistical wave hours later ({@link spawnSchoolReturn}), never a tracked
 * identity, because a round-trip dwell spanning the whole school day would
 * park a drawn figure in the lobby (and a `MAX_PEOPLE` slot) until 15:00.
 * `returning` is pre-set so the lobby arrival finishes instead of entering
 * the round-trip dwell; finish() then balances the `outForMeal` increment
 * taken here, so the condo visibly thins for the walk out the door and every
 * despawn path settles the accounting.
 */
export function spawnSchoolDeparture(crowd: Crowd, tower: Tower, floors: SpawnFloors): void {
  const floor = crowd.rng.pick(floors.householdFloors);
  const candidates = (floors.unitsByFloor.get(floor) ?? []).filter(
    (u) => (u.kind === "condo" || u.kind === "rentalApartment") && visibleOccupants(u) > 0,
  );
  if (candidates.length === 0) return;
  const origin = crowd.rng.pick(candidates);
  // Route from the condo's own tile (#647): a child never sets out from a stranded
  // run, and on a split floor the sprite spawns on the origin's run, not a sibling.
  const spawned = add(crowd, tower, floor, GROUND_LOBBY, origin.x);
  if (!spawned) return;
  spawned.routine = "schoolRun";
  spawned.originUnitId = origin.id;
  spawned.returning = true;
  origin.outForMeal = (origin.outForMeal ?? 0) + 1;
  tower.bumpMealOverlayRevision();
}

/** One school-run return: a child walks in the ground lobby and rides up to a
 *  condo floor. The statistical mirror of the morning wave; a plain one-way
 *  trip with no origin accounting (the child is arriving INTO the room, so
 *  there is no visible occupancy to thin). `condoFloors` bins only occupied
 *  condos, so an empty or unsold condo never draws a returning child. */
export function spawnSchoolReturn(crowd: Crowd, tower: Tower, floors: SpawnFloors): void {
  const floor = crowd.rng.pick(floors.householdFloors);
  const spawned = add(crowd, tower, GROUND_LOBBY, floor);
  if (spawned) spawned.routine = "schoolRun";
}

/**
 * One sales call: a worker from a staffed office (someone still visibly in the
 * room) heads down and out through the ground lobby, is away for a while, and
 * returns to the same office. A REAL round-tripper on the existing meal
 * machinery: with an `originUnitId` and no venue intent, the lobby arrival
 * enters the shared dwell uncounted (beginDwell's no-venue path, the meal-length
 * 30-60 game minutes standing in for the off-site meeting) and the return leg
 * self-schedules (transitionToReturn), so the whole call is out-and-back within
 * an hour or two and the office visibly thins for the duration. Every despawn
 * path balances the `outForMeal` increment through finish().
 */
export function spawnSalesCall(crowd: Crowd, tower: Tower, floors: SpawnFloors): void {
  const floor = crowd.rng.pick(floors.staffedOffices);
  const candidates = (floors.unitsByFloor.get(floor) ?? []).filter(
    (u) => u.kind === "office" && visibleOccupants(u) > 0,
  );
  if (candidates.length === 0) return;
  const origin = crowd.rng.pick(candidates);
  // Route from the office's own tile (#647): a stranded office never sends a rep,
  // and on a split floor the sprite leaves from the office's run, not a sibling.
  const spawned = add(crowd, tower, floor, GROUND_LOBBY, origin.x);
  if (!spawned) return;
  spawned.routine = "salesCall";
  spawned.originUnitId = origin.id;
  origin.outForMeal = (origin.outForMeal ?? 0) + 1;
  tower.bumpMealOverlayRevision();
}
