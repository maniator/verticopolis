import type { ElevatorQueueView } from "../crowd/person";
import type { Simulation } from "../Simulation";
import { whole } from "./record";

/**
 * `TsEngine`'s render queries (slice 7, PR 5b): what the renderer reads
 * beyond the view frame, slot for slot what the Rust engine answers
 * (`engine-rs/src/wasm_port_render.rs`). None answers a status.
 */

/** The encoded queue per projection: the crowd keeps one projection per step
 *  and revision, so a frame between steps copies the record out. */
const encoded = new WeakMap<ElevatorQueueView, Float64Array>();

/** `[landings, cars]`, then `(shaft, floor, count, tier)` per waiting line and
 *  `(shaft, car, riders)` per elevator car, in the projection's map order. */
export function queueView(sim: Simulation): Float64Array {
  const q = sim.crowd.queueView(sim.tower);
  let r = encoded.get(q);
  if (!r) {
    let landings = 0;
    let cars = 0;
    for (const floors of q.landings.values()) landings += floors.size;
    for (const riders of q.boarded.values()) cars += riders.size;
    r = new Float64Array(2 + landings * 4 + cars * 3);
    r[0] = landings;
    r[1] = cars;
    let at = 2;
    for (const [shaft, floors] of q.landings) {
      for (const [floor, l] of floors) {
        r.set([shaft, floor, l.count, l.tier], at);
        at += 4;
      }
    }
    for (const [shaft, riders] of q.boarded) {
      for (const [car, n] of riders) {
        r.set([shaft, car, n], at);
        at += 3;
      }
    }
    encoded.set(q, r);
  }
  return r.slice();
}

/** `[count, ids...]`: the working garage spaces, ascending. */
export function parkingSet(sim: Simulation): Float64Array {
  const ids = Float64Array.from(sim.tower.functionalParkingSet()).sort();
  const r = new Float64Array(1 + ids.length);
  r[0] = ids.length;
  r.set(ids, 1);
  return r;
}

/** The garage fill for `spots` working spaces; a negative or non-finite count
 *  reads as none. */
export function parkingUsage(sim: Simulation, spots: number): number {
  return Number.isFinite(spots) && spots > 0 ? sim.parkingUsage(spots) : 0;
}

/** Whether a walker can stand at `floor`, `x`; a position that is not a whole
 *  tile is not one. */
export function positionReachable(sim: Simulation, floor: number, x: number): boolean {
  return whole(floor, x) && sim.positionReachable(floor, x);
}
