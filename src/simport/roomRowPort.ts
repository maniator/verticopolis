// The engine port's row of rooms (Modern, #646, `engine-rs/src/wasm_port_room_row.rs`):
// one drag along a floor places the same room as many times as fits, as one
// command. Part of `EnginePort` (`enginePort.ts`).
import type { PortRecord } from "./enginePort";

/** The row of rooms' command and its dry run. */
export interface EnginePortRoomRow {
  /** Place the rooms of `kind` a drag along `floor` from the room at `from` to
   *  the room at `to` (left tiles) names, every one or none. Its own slot is
   *  `placed`; the delta is the row's price. */
  buildRoomRow(kind: number, floor: number, from: number, to: number): PortRecord;
  /** The dry run: `[ok, cost, rooms]`, then each room's left tile in the order
   *  a drag places them, from the press toward the pointer. The cost is the
   *  row's full price, set even when the money does not cover it. A refusal's
   *  text is `lastReason()`. */
  quoteRoomRow(kind: number, floor: number, from: number, to: number): PortRecord;
}
