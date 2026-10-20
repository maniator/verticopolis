import type { Simulation } from "../../engine/Simulation";

/**
 * The parity setup's cheap change detector (story-engine-test-parity,
 * #878), split out of `wasmHostSetup.ts`.
 */

/** Simulation fields the fingerprint leaves out: the per-frame counters the
 *  engine owns (the frame sync writes them every tick), the weather (engine
 *  owned too: no save carries it, a load recomputes it from the day), and the
 *  memo keys a read refreshes. */
const SIM_UNPRINTED: ReadonlySet<string> = new Set(["weather", "onHourRuns", "santaFxSeq", "vipFxSeq", "logSeq", "noiseMemoRev", "demandMemoKey"]);

// The fingerprint is a 32-bit FNV-1a style hash, folded word by word, so a
// 13,000-unit fixture costs a few milliseconds where a joined string of
// every field costs tens.
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function mixWord(h: number, w: number): number {
  return Math.imul(h ^ w, 16777619) >>> 0;
}

function mixString(h: number, s: string): number {
  h = mixWord(h, s.length);
  for (let i = 0; i < s.length; i++) h = mixWord(h, s.charCodeAt(i));
  return h;
}

function mixValue(h: number, v: unknown, nested: boolean): number {
  switch (typeof v) {
    case "number":
      f64[0] = v;
      return mixWord(mixWord(h, u32[0]), u32[1]);
    case "string":
      return mixWord(mixWord(h, 1), stringHash(v));
    case "boolean":
      return mixWord(h, v ? 2 : 3);
    case "undefined":
      return mixWord(h, 4);
    case "object":
      if (v === null) return mixWord(h, 5);
      if (nested && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype)) return mixString(mixWord(h, 6), JSON.stringify(v));
      return h;
    default:
      return h;
  }
}

/** Each short string's own hash (a key, a kind, a state, a label), computed
 *  once; the cache is dropped when it grows past a bound. */
const stringHashes = new Map<string, number>();

function stringHash(s: string): number {
  let h = stringHashes.get(s);
  if (h === undefined) {
    h = mixString(2166136261, s);
    if (s.length <= 64) {
      if (stringHashes.size >= 50_000) stringHashes.clear();
      stringHashes.set(s, h);
    }
  }
  return h;
}

/** Fold one record's own enumerable fields: a primitive as itself, and (with
 *  `nested`) an array or a plain object (a `cars` array, a schedule) as its
 *  JSON. Each field hashes with its key, and the fields combine by a sum, so
 *  the key order does not matter (the same as folding them by sorted key). */
function foldRecord(h: number, record: object, nested: boolean, skip?: ReadonlySet<string>): number {
  const r = record as Record<string, unknown>;
  let sum = 0;
  for (const key of Object.keys(r)) {
    if (skip?.has(key)) continue;
    sum = (sum + mixValue(stringHash(key), r[key], nested)) >>> 0;
  }
  return mixWord(h, sum);
}

/** A cheap fingerprint of what a test can write straight onto the instance
 *  without moving the tower revision, taken after every sync: every unit's
 *  and every transport's own fields (primitives, and the JSON of their
 *  arrays and schedules), the Simulation's own primitive fields, the JSON of
 *  `events.pending`, and the clock. A change before the next tick means a
 *  direct write landed, and the full state-view compare runs even once the
 *  crowd exists. The people stay out of it (the frame owns them), as do the
 *  engine-owned counters and the weather (see {@link SIM_UNPRINTED}): a
 *  direct write to a person or to one of those is replaced by the next frame
 *  sync, and no error names it. */
export function fingerprint(sim: Simulation): number {
  let h = mixValue(2166136261, sim.clock.minutes, false);
  h = mixString(h, JSON.stringify(sim.events.pending));
  h = foldRecord(h, sim, false, SIM_UNPRINTED);
  for (const u of sim.tower.units) h = foldRecord(h, u, true);
  for (const t of sim.tower.transports) h = foldRecord(h, t, true);
  return h;
}
