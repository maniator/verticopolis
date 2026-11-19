// The engine port's recycling reads (`engine-rs/src/wasm_port_render.rs`): the
// stats sheet's two numbers and the recycling card's one read. Part of
// `EnginePort` (`enginePort.ts`).
import type { PortRecord } from "./enginePort";

/** What the working recycling centers serve and process. */
export interface EnginePortRecycling {
  /** The population the working recycling centers can process. */
  recyclingCapacity(): number;
  /** Whether the working recycling centers can process the whole population. */
  recyclingDemandMet(): boolean;
  /** The recycling card from one read (#1745), as `recyclingCard` slots:
   *  the population the centers serve (the one the verdict uses), what they
   *  can process, the bins' fill from 0 to 1, and 1 when the demand is met
   *  or 0. */
  recyclingCard(): PortRecord;
}
