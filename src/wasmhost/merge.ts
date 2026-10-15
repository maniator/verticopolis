import type { Simulation } from "../engine/Simulation";
import type { Tower } from "../engine/Tower";
import type { Transport, Unit } from "../engine/types";

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
  const t = target as unknown as Record<string, unknown>;
  const f = fresh as unknown as Record<string, unknown>;
  for (const key of Object.keys(f)) {
    if (KEEP.has(key) || typeof f[key] === "function") continue;
    t[key] = f[key];
  }
  target.clock.minutes = fresh.clock.minutes;
  // A transient the instance set on a command and the save never carries;
  // the engine resolves it in its own tick, so it must not stick here.
  delete target.exterminationRoomIds;
  target.events.loadState(fresh.events.saveState());
  target.events.restore(fresh.tower.units.filter((u) => u.state === "fire").map((u) => u.id));
  target.economy.restoreBlockbusters(fresh.economy.blockbusterIds);
  mergeTower(target.tower, fresh.tower, marks);
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
  mergeById(target.units, fresh.units, target.byId);
  mergeById(target.transports, fresh.transports, target.transportsById);
  target.revision = marks.revision;
  target.mealOverlayRevision = marks.mealOverlayRevision;
}

/** Rewrite `live` to hold `fresh`'s records in `fresh`'s order, keeping the
 *  object a record's id already had and making its fields the fresh ones
 *  (an optional field the fresh record lacks, a finished construction's
 *  `completeAt`, goes too), and rebuild the id index to match. */
function mergeById<T extends Unit | Transport>(live: T[], fresh: T[], index: Map<number, T>): void {
  const next: T[] = fresh.map((record) => {
    const held = index.get(record.id);
    if (!held) return record;
    for (const key of Object.keys(held)) {
      if (!(key in record)) delete (held as unknown as Record<string, unknown>)[key];
    }
    Object.assign(held, record);
    return held;
  });
  live.splice(0, live.length, ...next);
  index.clear();
  for (const record of next) index.set(record.id, record);
}
