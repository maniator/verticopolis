import type { Simulation } from "../engine/Simulation";
import type { FrameHeader } from "./frameView";
import { mergeDelta, mergeSave, parseDelta, parseMerge, type ParsedDelta, type ParsedMerge } from "./workerApply";
import type { FrameReply } from "./workerProtocol";
import type { WorkerHostStats } from "./workerStats";

/**
 * The save half of a worker reply (#1045): a full save, merged whole, or an
 * hourly delta, patched onto the read model. Every full save and delta the
 * worker sends takes the next number in the tower's sync sequence, and a
 * delta names the one it was taken against; it applies only on top of that
 * one. Split from the host's message handling, which reads it before any
 * write and applies it with the rest of a fresh reply.
 */

const now = (): number => (globalThis.performance ? performance.now() : Date.now());

export type SaveSync =
  | { kind: "merge"; parsed: ParsedMerge; sync: number; parseMs: number }
  | { kind: "delta"; parsed: ParsedDelta; sync: number; parseMs: number; bytes: number };

const payloadBytes = (m: { telemetry: string; housekeeping: string | null }, body: string) => 2 * (body.length + m.telemetry.length + (m.housekeeping?.length ?? 0));

/** Count the bytes of the reply's save half received, at two bytes a
 *  character. A delta's own bytes are counted when it applies, so bytes per
 *  delta divides like by like. */
export function countSaveBytes(stats: WorkerHostStats, r: FrameReply): void {
  if (r.merge) {
    const bytes = payloadBytes(r.merge, r.merge.save);
    stats.mergeBytes += bytes;
    stats.bytesReceived += bytes;
  }
  if (r.delta) stats.bytesReceived += payloadBytes(r.delta, r.delta.delta);
}

/** Read the reply's save half in full, before any write. Throws on a
 *  payload that is not the engine's shape. Null when there is none, or
 *  when the reply's delta does not apply on top of `appliedSync` or does
 *  not fit the read model (the caller then asks for a full save). */
export function readSaveSync(sim: Simulation, r: FrameReply, appliedSync: number): SaveSync | null {
  const t = now();
  for (const n of [r.merge?.sync, r.delta?.base, r.delta?.sync]) {
    if (n !== undefined && !Number.isSafeInteger(n)) throw new Error(`save sync: bad sequence number ${String(n)}`);
  }
  if (r.merge) return { kind: "merge", parsed: parseMerge(r.merge), sync: r.merge.sync, parseMs: now() - t };
  if (!r.delta || r.delta.base !== appliedSync) return null;
  const parsed = parseDelta(sim, r.delta);
  return parsed ? { kind: "delta", parsed, sync: r.delta.sync, parseMs: now() - t, bytes: payloadBytes(r.delta, r.delta.delta) } : null;
}

/** Apply a read save half and count it. Returns the sync number the read
 *  model now holds. */
export function applySaveSync(sim: Simulation, s: SaveSync, h: FrameHeader, stats: WorkerHostStats): number {
  const t = now();
  if (s.kind === "merge") {
    mergeSave(sim, s.parsed, h);
    stats.merges++;
    stats.mergeMs += now() - t + s.parseMs;
  } else {
    mergeDelta(sim, s.parsed, h);
    stats.deltas++;
    stats.deltaBytes += s.bytes;
    stats.deltaUnits += s.parsed.records.units.length;
    stats.deltaMs += now() - t + s.parseMs;
  }
  return s.sync;
}
