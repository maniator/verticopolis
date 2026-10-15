import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import type { UnitRecord } from "../../wasmhost/frameView";
import { quantile } from "../perfCompare/stats";

/**
 * The read model's shape (docs/architecture/read-model-deltas.md): what the
 * full save the hosts merge is made of, and how much of it one merge
 * actually changes. Measured in Node on the TypeScript engine, over the
 * hosted rows' window (a fresh load of the scenario save, then their steps
 * in their batches), with the worker host's own merge rule (a merge
 * whenever the hour-pass counter or the tower revision moved since the
 * last one; the merges a host forces after a stale reply or for a settle
 * are left out). It counts and sizes, with no timing, so one pass per
 * scenario is exact and repeats byte for byte. Sizes are JSON characters,
 * the length of each value's `JSON.stringify`.
 */

/** One slice of the save: a top-level key, or the units of one kind. */
export interface Slice {
  name: string;
  /** Records in it: units for a kind, 1 for a top-level key. */
  count: number;
  chars: number;
  /** Its share of the whole save, 0 to 1. */
  share: number;
}

export interface Composition {
  totalChars: number;
  units: number;
  /** Top-level keys, largest first. */
  keys: Slice[];
  /** Units grouped by `kind`, largest first; the shares are of the whole
   *  save, so they sum to the `units` key's share less its brackets and
   *  commas. */
  unitKinds: Slice[];
}

/** One merge compared with the one before it. */
export interface Churn {
  /** Units present in both saves with at least one field that differs
   *  (key order alone is no change). */
  changed: number;
  added: number;
  removed: number;
  /** Units in the later save. */
  total: number;
  /** Changed units with at least one differing field outside the frame
   *  view's unit record (`FRAME_UNIT_FIELDS`): units only a merge brings
   *  fully up to date. */
  outsideFrame: number;
  /** The unit fields that differed on a changed unit, sorted. */
  unitKeys: string[];
  /** The top-level keys whose values differed, `units` included, sorted. */
  topKeys: string[];
}

export interface MergePass extends Churn {
  /** After which step (1-based) the merge ran. */
  step: number;
  reason: "hour" | "revision" | "both";
}

/** A per-merge figure over a run's merges. */
export interface Spread {
  median: number;
  mean: number;
  max: number;
}

export interface ReadModelShape {
  scenario: string;
  steps: number;
  dt: number;
  batch: number;
  /** The loaded save, re-serialized: the first merge's baseline. */
  composition: Composition;
  merges: MergePass[];
  /** Over `merges`: the units changed per merge as a share of the units
   *  then present (0 to 1). Null with no merge. */
  changedShare: Spread | null;
  /** Over `merges`: units changed, added or removed per merge. */
  touched: Spread | null;
  /** Over `merges`: units changed per merge, as counts. */
  changedCount: Spread | null;
  /** Over `merges`: changed units with a field the frame view does not
   *  carry. */
  outsideFrame: Spread | null;
}

/** The fields of the frame view's per-unit record besides its id
 *  (`UnitRecord`, `src/wasmhost/frameView.ts`); the record type makes the
 *  list exhaustive. A save writes only `state` and `occupants` of them
 *  (`serializeUnit` drops the three visit counters as transient), so those
 *  two are the ones a save comparison can see. */
const FRAME_FIELDS: Record<Exclude<keyof UnitRecord, "id">, true> = { state: true, occupants: true, customersIn: true, hotelCustomersIn: true, outForMeal: true };
export const FRAME_UNIT_FIELDS: readonly string[] = Object.keys(FRAME_FIELDS);

const size = (v: unknown): number => JSON.stringify(v)?.length ?? 0;
const sortBySize = (a: Slice, b: Slice): number => b.chars - a.chars || a.name.localeCompare(b.name);

/** What a save is made of: each top-level key's size and each unit kind's. */
export function composition(save: string): Composition {
  const game = JSON.parse(save) as Record<string, unknown> & { units?: { kind?: unknown }[] };
  const totalChars = save.length;
  const keys: Slice[] = Object.entries(game).map(([name, v]) => {
    const chars = size(v);
    return { name, count: 1, chars, share: chars / totalChars };
  });
  const byKind = new Map<string, { count: number; chars: number }>();
  for (const u of game.units ?? []) {
    const kind = typeof u.kind === "string" ? u.kind : "(no kind)";
    const k = byKind.get(kind) ?? { count: 0, chars: 0 };
    k.count++;
    k.chars += size(u);
    byKind.set(kind, k);
  }
  const unitKinds = [...byKind].map(([name, k]) => ({ name, count: k.count, chars: k.chars, share: k.chars / totalChars }));
  return { totalChars, units: game.units?.length ?? 0, keys: keys.sort(sortBySize), unitKinds: unitKinds.sort(sortBySize) };
}

/** Compare two saves unit by unit (matched by `id`) and key by key. */
export function churn(before: string, after: string): Churn {
  type Game = Record<string, unknown> & { units?: Record<string, unknown>[] };
  const a = JSON.parse(before) as Game;
  const b = JSON.parse(after) as Game;
  const index = (g: Game) => {
    const m = new Map<unknown, Record<string, unknown>>();
    for (const u of g.units ?? []) {
      if (m.has(u.id)) throw new Error(`unit id ${String(u.id)} appears twice in one save`);
      m.set(u.id, u);
    }
    return m;
  };
  const ua = index(a);
  const ub = index(b);
  let changed = 0;
  let added = 0;
  let outsideFrame = 0;
  const unitKeys = new Set<string>();
  for (const [id, u] of ub) {
    const prev = ua.get(id);
    if (!prev) {
      added++;
      continue;
    }
    const differs = [...new Set([...Object.keys(prev), ...Object.keys(u)])].filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(u[k]));
    if (differs.length === 0) continue;
    changed++;
    for (const k of differs) unitKeys.add(k);
    if (differs.some((k) => !FRAME_UNIT_FIELDS.includes(k))) outsideFrame++;
  }
  let removed = 0;
  for (const id of ua.keys()) if (!ub.has(id)) removed++;
  const topKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return { changed, added, removed, total: ub.size, outsideFrame, unitKeys: [...unitKeys].sort(), topKeys: topKeys.sort() };
}

/** Median, mean and max of a list, or null when it is empty. */
export function spread(xs: readonly number[]): Spread | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((x, y) => x - y);
  return { median: quantile(sorted, 0.5), mean: sorted.reduce((a, x) => a + x, 0) / sorted.length, max: sorted[sorted.length - 1] };
}

/** Summaries over a scenario's merges. */
export function summarizeMerges(merges: readonly MergePass[]): Pick<ReadModelShape, "changedShare" | "touched" | "changedCount" | "outsideFrame"> {
  return {
    changedShare: spread(merges.map((m) => (m.total ? m.changed / m.total : 0))),
    touched: spread(merges.map((m) => m.changed + m.added + m.removed)),
    changedCount: spread(merges.map((m) => m.changed)),
    outsideFrame: spread(merges.map((m) => m.outsideFrame)),
  };
}

/** Run one scenario on the TypeScript engine over the hosted rows' window
 *  (their warm-up runs on a throwaway load, so the timed run starts from
 *  a fresh load, as this one does) and compare each merge's save with the
 *  previous one. */
export function measureReadModel(scenario: { name: string; save: string }, opts: { steps: number; dt: number; batch: number }): ReadModelShape {
  const sim = Simulation.deserialize(JSON.parse(scenario.save) as SerializedGame);
  let last = JSON.stringify(sim.serialize());
  let hourRuns = sim.onHourRuns;
  let revision = sim.tower.revision;
  const base = composition(last);
  const merges: MergePass[] = [];
  for (let step = 1; step <= opts.steps; step++) {
    sim.tick(opts.dt);
    if (step % opts.batch !== 0 && step !== opts.steps) continue;
    const hour = sim.onHourRuns !== hourRuns;
    const rev = sim.tower.revision !== revision;
    if (!hour && !rev) continue;
    const save = JSON.stringify(sim.serialize());
    let reason: MergePass["reason"] = hour ? "hour" : "revision";
    if (hour && rev) reason = "both";
    merges.push({ step, reason, ...churn(last, save) });
    last = save;
    hourRuns = sim.onHourRuns;
    revision = sim.tower.revision;
  }
  return { scenario: scenario.name, steps: opts.steps, dt: opts.dt, batch: opts.batch, composition: base, merges, ...summarizeMerges(merges) };
}
