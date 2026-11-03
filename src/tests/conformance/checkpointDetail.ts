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
  /** The cosmetic fx sequences and the emergency counters, outside the hashed
   *  views (#879), one number per named slot of {@link FX_SLOTS}. */
  fx: Record<string, number>;
}

/** The fx slots, in the order every runner writes them. The names are part of
 *  the record: the Rust writer (`engine-rs/src/scenario_detail.rs`) and the
 *  WASM adapter (`wasmEngine.ts`, which reads the frame header) use the same. */
export const FX_SLOTS = [
  "santaFxSeq",
  "explosionSeq", "explosionFloor", "explosionX",
  "thiefSeq", "thiefCaught", "thiefFloor",
  "treasureSeq", "treasureFloor", "treasureX",
  "vipFxSeq",
  "fires", "firesGutRooms", "bombs",
] as const;
export type FxSlot = (typeof FX_SLOTS)[number];

export function tsFxSlots(sim: Simulation): Record<FxSlot, number> {
  const counts = sim.events.counts;
  return {
    santaFxSeq: sim.santaFxSeq,
    explosionSeq: sim.explosionFx.seq, explosionFloor: sim.explosionFx.floor, explosionX: sim.explosionFx.x,
    thiefSeq: sim.thiefFx.seq, thiefCaught: sim.thiefFx.caught ? 1 : 0, thiefFloor: sim.thiefFx.floor,
    treasureSeq: sim.treasureFx.seq, treasureFloor: sim.treasureFx.floor, treasureX: sim.treasureFx.x,
    vipFxSeq: sim.vipFxSeq,
    fires: counts.fires, firesGutRooms: counts.firesGutRooms, bombs: counts.bombs,
  };
}

export function tsCheckpointDetail(sim: Simulation): Omit<CheckpointDetail, "label"> {
  const save = sim.serialize() as unknown as Record<string, unknown>;
  return {
    money: sim.money,
    log: { seq: sim.logSeq, count: sim.log.length, digest: digest(sim.log.map((e) => ({ minute: e.minute, text: e.text, kind: e.kind }))) },
    save: Object.fromEntries(Object.entries(save).filter(([, v]) => v !== undefined).map(([k, v]) => [k, digest(v)])),
    fx: tsFxSlots(sim),
  };
}

/** The detail record could not be built: a harness problem, not a finding. */
export class DetailError extends Error {}

/** The detail of an engine that provides it, or a `DetailError` naming the gap. */
export function requireDetail(e: { detail?(): Omit<CheckpointDetail, "label"> }): Omit<CheckpointDetail, "label"> {
  try {
    if (!e.detail) throw new Error("this engine does not provide the checkpoint detail");
    return e.detail();
  } catch (err) {
    throw err instanceof DetailError ? err : new DetailError((err as Error).message);
  }
}
