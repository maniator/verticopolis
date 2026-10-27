import type { Simulation } from "../engine/Simulation";
import type { Tower } from "../engine/Tower";
import { forgetUnitLists, markRoom } from "../engine/tower/rooms";
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
  // Set the billed rooms outright as well, so a fresh instance without the
  // key still clears a list whose treatment the engine landed. A copy, as
  // the save writer takes one.
  target.exterminationRoomIds = fresh.exterminationRoomIds && [...fresh.exterminationRoomIds];
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
  // The unit array keeps its identity and the revision becomes the engine's,
  // which counts from its own load, so a revision can come back with other
  // units behind it. The per-revision lists go when the revision moves or the
  // units do, and stay over an hourly merge that changed neither (#1253).
  // Lists that go take the HUD's room counts with them (a new rooms list is
  // counted afresh); lists that stay keep them, so the rooms whose counted
  // fields this merge rewrites are marked instead.
  const changed: Unit[] = [];
  const moved = target.revision !== marks.revision || unitsMoved(target.units, fresh.units, changed);
  mergeById(target.units, fresh.units, target.byId);
  mergeById(target.transports, fresh.transports, target.transportsById);
  target.revision = marks.revision;
  if (moved) forgetUnitLists(target);
  else for (const u of changed) markRoom(target, u);
  target.mealOverlayRevision = marks.mealOverlayRevision;
}

/** Whether `fresh` lists other units than `live`, or the same ones in
 *  another order, of another kind or in another place: what the
 *  per-revision room list and structure runs are built from. While they
 *  match, also collect into `changed` the live units whose fields the room
 *  counts read (`roomCounts`) differ from the fresh record's. */
function unitsMoved(live: readonly Unit[], fresh: readonly Unit[], changed: Unit[]): boolean {
  if (live.length !== fresh.length) return true;
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    const b = fresh[i];
    if (a.id !== b.id || a.kind !== b.kind || a.floor !== b.floor || a.x !== b.x || a.width !== b.width) return true;
    if (a.state !== b.state || a.noRate !== b.noRate || a.everOccupied !== b.everOccupied || a.residents !== b.residents || a.customersIn !== b.customersIn) {
      changed.push(a);
    }
  }
  return false;
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
