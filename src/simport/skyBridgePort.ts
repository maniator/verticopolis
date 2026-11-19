// The engine port's Sky Bridge tool (Modern, `engine-rs/src/wasm_port_skybridge.rs`):
// one click on the open air between two sky lobbies lays the whole bridge, or
// nothing, and a click on a bridge changes its look. Part of `EnginePort`
// (`enginePort.ts`).
import type { PortRecord } from "./enginePort";

/** The Sky Bridge tool's command and its dry run. */
export interface EnginePortSkyBridge {
  /** Lay the whole bridge a click at the cell names: every missing tile of the
   *  gap between two sky lobbies, or nothing. Its own slot is `tiles`, the tiles
   *  laid; the delta is the price. It wears look `look`, an index into the
   *  catalog's `rules.skyBridge.looks`. */
  buildSkyBridge(floor: number, x: number, look: number): PortRecord;
  /** Dress the whole bridge at the cell in look `look`, an index into the
   *  catalog's `rules.skyBridge.looks`. Free; no slot of its own. */
  restyleSkyBridge(floor: number, x: number, look: number): PortRecord;
  /** Every bridge as `[floor, from, to, look]`, four numbers each, by floor
   *  and then column. One walk over the tower: read it once per layout change. */
  skyBridgeLooks(): Float64Array;
  /** The dry run: `[ok, cost, from, to]`, the tiles `from` to `to` (exclusive)
   *  a click would lay, empty when no gap between two sky lobbies is found, and
   *  their full price, set even when the money does not cover it. A refusal's
   *  text is `lastReason()`. */
  quoteSkyBridge(floor: number, x: number): PortRecord;
}
