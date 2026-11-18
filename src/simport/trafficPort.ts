// The engine port's traffic reads for a tap (`engine-rs/src/wasm_port_render.rs`):
// what one floor's congestion is, which transports set it, and how far one
// landing's waiting line runs. The first two build the spatial reading, a pass
// over the rooms, and the third walks the crowd once, so none is a per-frame
// read. Part of `EnginePort` (`enginePort.ts`).
import type { PortRecord } from "./enginePort";

/** One floor's congestion reading and its cause. */
export interface EnginePortTraffic {
  /** The raw congestion ratio of one floor: the value `hotspot` takes its peak
   *  from, 0 for a floor with no reading (empty, stranded, or not a whole
   *  number). For tests and tools that need the number itself; the overlay's
   *  severity ramp saturates. */
  floorCongestion(floor: number): number;
  /** The ids of the transports behind one floor's reading, in the tower's
   *  transport order: the shaft or flight with the highest estimate (every
   *  one tied for it), or every passenger elevator stopping there when the
   *  floor's real commute wait sets the reading. Empty for a floor with no
   *  reading or one that is not a whole number. Read when the player taps
   *  the Traffic readout. */
  congestionCause(floor: number): PortRecord;
  /** The stretch of floor the waiting line at elevator `shaft` on `floor`
   *  covers, `[from, to]` in tiles with `from <= to`: from the shaft face to
   *  the rider standing farthest from it. A line runs across any shaft beside its
   *  own, so this is how the Traffic readout's tap tells which riders stand
   *  in which line. Empty when nobody waits there. Read on a tap. */
  queueLine(shaft: number, floor: number): PortRecord;
}
