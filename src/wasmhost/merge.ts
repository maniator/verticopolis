import type { Simulation } from "../engine/Simulation";
import type { Tower } from "../engine/Tower";
import type { Transport, Unit } from "../engine/types";
import { forgetRoomUnits, roomUnits } from "../engine/tower/rooms";

/**
 * Bring a live read model up to a fresh deserialization of the engine's
 * save, in place: the `Simulation`, `Tower`, unit and transport objects the
 * renderer and panels hold keep their identity, and only their contents
 * change. Everything the save carries is adopted from `fresh`; what the
 * save does not carry (the crowd, the per-frame fields, the dispatch and
 * housekeeping memos) is left to the frame sync or stays as it is. Between
 * merges the fields the frame does not carry (the memos, `satisfaction`,
 * the instance's `rng`) keep their last merged value; backlog #868 lists
 * what the read model still owes.
 */

/** Simulation fields the merge never copies from the fresh instance: the
 *  ones merged in place, the ones the frame sync owns, the ones bound to
 *  this instance, and the ones the save does not carry. */
const KEEP: ReadonlySet<string> = new Set([
  "tower", "crowd", "clock", "events", "economy", "elevators", "rules", "mode", "modernCalendar", "founder",
  "weather", "santaFxSeq", "explosionFx", "thiefFx", "treasureFx", "vipFxSeq", "onHourRuns",
  "elevatorUtil", "elevatorHourly", "elevatorOrigins",
  // The log is appended from the engine's `logSince` as entries arrive, and
  // `logSeq` stays the instance's own monotonic cursor (the UI's log view
  // keys on it); a copy from the save would replay the ring every merge.
  "log", "logSeq",
]);

/** Tower fields merged by hand rather than copied. */
const TOWER_BY_HAND: ReadonlySet<string> = new Set(["rules", "units", "transports", "byId", "transportsById", "revision", "mealOverlayRevision"]);

export interface MergeMarks {
  revision: number;
  mealOverlayRevision: number;
}

export function mergeSimulation(target: Simulation, fresh: Simulation, marks: MergeMarks): void {
  adoptSimulationFields(target, fresh);
  mergeTower(target.tower, fresh.tower, marks);
  // The fires, read from the merged rooms (a floor or lobby tile cannot
  // burn) through the revision-keyed room list: after a merge that kept the
  // revision it is warm, and after one that moved it the build is the one
  // pass the read model's own queries would make next.
  target.events.restore(roomUnits(target.tower).filter((u) => u.state === "fire").map((u) => u.id));
}

/** What an hourly delta carries (#1045), read and coerced: `rest` is a
 *  fresh deserialization of the save's top-level keys with no units and no
 *  transports, `units` the changed unit records (every id already in the
 *  read model), and `transports` every transport record, in save order. */
export interface DeltaRecords {
  rest: Simulation;
  units: Unit[];
  transports: Transport[];
}

/**
 * Patch the read model with an hourly delta, in place, to the engine's
 * saved state, as a full merge would give it: the Simulation fields as
 * `mergeSimulation` adopts them, the changed unit records written over the
 * objects the read model holds (the rest are untouched, which is the
 * saving), the transports merged by id as the engine saved them, and the
 * tower's own saved fields. The load-time transport passes (the overlap
 * filter, the express lobby-stop lock) are not run again: the engine's own
 * placement keeps both, and a full merge's would change nothing.
 * The sets `deserialize` derives from the units (construction, fires) are
 * left to {@link rebuildUnitSets}, once the reply's frame has set every
 * unit's state. The tower's caches stay:
 * the revision did not move (a delta is only sent when it did not), and
 * every revision-keyed cache reads layout, never unit state.
 */
export function mergeSimulationDelta(target: Simulation, d: DeltaRecords, marks: MergeMarks): void {
  const tower = target.tower;
  // Every unit named is checked before the first write, so a throw leaves
  // the read model as it was.
  const held = d.units.map((record) => {
    const unit = tower.byId.get(record.id);
    if (!unit) throw new Error(`delta: unit ${record.id} is not in the read model`);
    return unit;
  });
  adoptSimulationFields(target, d.rest, true);
  d.units.forEach((record, i) => assignRecord(held[i], record));
  mergeById(tower.transports, d.transports, tower.transportsById);
  tower.setNextId(d.rest.tower.getNextId());
  tower.towerName = d.rest.tower.towerName;
  tower.builtWeddingHall = d.rest.tower.builtWeddingHall;
  tower.revision = marks.revision;
  tower.mealOverlayRevision = marks.mealOverlayRevision;
}

/** Rebuild the sets `deserialize` derives from the unit states (the units
 *  under construction and the fires) from the read model's units. After a
 *  delta they are run once the reply's frame records are applied, so they
 *  read the engine's states at the reply, as a full merge's fresh units do:
 *  a unit whose save form did not move is not in the delta, and its state
 *  before the frame is the last frame's. */
export function rebuildUnitSets(target: Simulation): void {
  const fires: number[] = [];
  target.constructing.clear();
  // Structural floor/lobby tiles cannot be under construction or on fire.
  // The revision-keyed room index preserves the unit ordering and live states.
  for (const u of roomUnits(target.tower)) {
    if (u.state === "construction") target.constructing.add(u.id);
    else if (u.state === "fire") fires.push(u.id);
  }
  target.events.restore(fires);
}

/** The Simulation-level half of a merge: every field the save carries,
 *  from `fresh`, and the clock, events state and bookings. */
function adoptSimulationFields(target: Simulation, fresh: Simulation, keepUnitSets = false): void {
  const t = target as unknown as Record<string, unknown>;
  const f = fresh as unknown as Record<string, unknown>;
  for (const key of Object.keys(f)) {
    if (KEEP.has(key) || typeof f[key] === "function") continue;
    // A delta's `fresh` has no units, so the set derived from them is empty:
    // the read model keeps its own until `rebuildUnitSets` runs.
    if (keepUnitSets && key === "constructing") continue;
    t[key] = f[key];
  }
  target.clock.minutes = fresh.clock.minutes;
  // Set the billed rooms outright as well, so a fresh instance without the
  // key still clears a list whose treatment the engine landed. A copy, as
  // the save writer takes one.
  target.exterminationRoomIds = fresh.exterminationRoomIds && [...fresh.exterminationRoomIds];
  target.events.loadState(fresh.events.saveState());
  target.economy.restoreBlockbusters(fresh.economy.blockbusterIds);
}

function mergeTower(target: Tower, fresh: Tower, marks: MergeMarks): void {
  const t = target as unknown as Record<string, unknown>;
  const f = fresh as unknown as Record<string, unknown>;
  for (const key of Object.keys(f)) {
    if (TOWER_BY_HAND.has(key) || typeof f[key] === "function") continue;
    const tv = t[key];
    const fv = f[key];
    // A map keeps its identity (a holder sees the new contents); anything
    // else is replaced, which also resets the revision-keyed caches.
    if (tv instanceof Map && fv instanceof Map) {
      tv.clear();
      for (const [k, v] of fv) tv.set(k, v);
    } else {
      t[key] = fv;
    }
  }
  if (mergeById(target.units, fresh.units, target.byId)) forgetRoomUnits(target);
  mergeById(target.transports, fresh.transports, target.transportsById);
  target.revision = marks.revision;
  target.mealOverlayRevision = marks.mealOverlayRevision;
}

/** Rewrite `live` to hold `fresh`'s records in `fresh`'s order, keeping the
 *  object a record's id already had and making its fields the fresh ones
 *  (an optional field the fresh record lacks, a finished construction's
 *  `completeAt`, goes too), and rebuild the id index to match. True when a
 *  record had no object yet. */
function mergeById<T extends Unit | Transport>(live: T[], fresh: T[], index: Map<number, T>): boolean {
  let added = false;
  const next: T[] = fresh.map((record) => {
    const held = index.get(record.id);
    if (!held) {
      added = true;
      return record;
    }
    assignRecord(held, record);
    return held;
  });
  live.splice(0, live.length, ...next);
  index.clear();
  for (const record of next) index.set(record.id, record);
  return added;
}

/** Make `held`'s fields `record`'s, keeping the object: an optional field
 *  the record lacks goes too. */
function assignRecord<T extends Unit | Transport>(held: T, record: T): void {
  for (const key of Object.keys(held)) {
    if (!(key in record)) delete (held as unknown as Record<string, unknown>)[key];
  }
  Object.assign(held, record);
}
