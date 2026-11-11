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
   *  views (#879), one number per named slot of {@link FX_SLOTS}. The record
   *  also holds what the Rust runner wrote to a file, so its keys are checked
   *  when it is compared (`recordProblem`); the writer in this repository (the
   *  WASM adapter) returns `Record<FxSlot, number>`, so the compiler holds it
   *  to the list. */
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

/** A WebAssembly trap (an unreachable, an out-of-bounds access, an exhausted
 *  stack or memory) rather than the JavaScript error the binding throws for a
 *  refused command. The binding is poisoned after one, so it is a finding of its
 *  own, not a value that differs. */
export function isWasmTrap(e: unknown): boolean {
  if (e instanceof WebAssembly.RuntimeError) return true;
  return e instanceof RangeError && /WebAssembly|Maximum call stack/i.test(e.message);
}

/** The detail record could not be built: a harness problem, not a finding. */
export class DetailError extends Error {}

/** The detail of an engine that provides it, or a `DetailError` naming the gap. */
export function requireDetail(e: { detail?(): Omit<CheckpointDetail, "label"> }): Omit<CheckpointDetail, "label"> {
  try {
    if (!e.detail) throw new Error("this engine does not provide the checkpoint detail");
    return e.detail();
  } catch (err) {
    // A trap while the record is built (it serializes the whole tower) is a finding in
    // the engine, not a harness failure.
    if (isWasmTrap(err)) throw err;
    throw err instanceof DetailError ? err : new DetailError((err as Error).message);
  }
}
