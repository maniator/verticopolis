import type { Simulation } from "../../engine/Simulation";
import { digest } from "./canonical";

/** What the seeded differential compares at a checkpoint beyond the hashes:
 *  the money, the log, and a digest of each top-level field of the full save.
 *  The Rust fuzzer writes the same record (`engine-rs/src/scenario_detail.rs`).
 *  Not part of the conformance lock. */
export interface CheckpointDetail {
  label: string;
  money: number;
  /** The log ring's last sequence number, its length and a digest of its entries. */
  log: { seq: number; count: number; digest: string };
  save: Record<string, string>;
}

export function tsCheckpointDetail(sim: Simulation): Omit<CheckpointDetail, "label"> {
  const save = sim.serialize() as unknown as Record<string, unknown>;
  return {
    money: sim.money,
    log: { seq: sim.logSeq, count: sim.log.length, digest: digest(sim.log.map((e) => ({ minute: e.minute, text: e.text, kind: e.kind }))) },
    save: Object.fromEntries(Object.entries(save).filter(([, v]) => v !== undefined).map(([k, v]) => [k, digest(v)])),
  };
}

/** The detail of an engine that provides it, or an error naming the gap. */
export function requireDetail(e: { detail?(): Omit<CheckpointDetail, "label"> }): Omit<CheckpointDetail, "label"> {
  if (!e.detail) throw new Error("this engine does not provide the checkpoint detail");
  return e.detail();
}
