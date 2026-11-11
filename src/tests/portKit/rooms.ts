import { facilityFloors } from "../../engine/facilities";
import type { FacilityKind } from "../../shared/types";
import { ViewReader } from "../../simport/viewReader";
import type { PortSim } from "./portSim";

/** One room's live visit counters, which no save carries. */
export interface RoomTallies {
  readonly id: number;
  readonly kind: FacilityKind;
  readonly floor: number;
  readonly x: number;
  readonly customersIn: number;
  readonly hotelCustomersIn: number;
  readonly outForMeal: number;
}

/** Every room's counters, from the engine's frame through the host's view
 *  reader, so both engines answer through the path the game reads. Each call
 *  reads a full frame with a new reader, so a counter write that skipped the
 *  frame's change marks still shows. An absent counter reads 0, as the tests
 *  that compare tallies count it.
 *
 *  `customersIn` is read raw from the unit card instead (NaN there is absent),
 *  so a tally that went below 0 shows as itself. The frame sends an absent
 *  counter as -1, so a negative `hotelCustomersIn` or `outForMeal` reads 0
 *  here: a check against these two cannot see a dip below 0. */
export function roomTallies(sim: PortSim): RoomTallies[] {
  return new ViewReader(sim.port, facilityFloors).rooms.map((r) => ({
    id: r.id,
    kind: r.kind,
    floor: r.floor,
    x: r.x,
    customersIn: rawCustomersIn(sim, r.id),
    hotelCustomersIn: r.hotelCustomersIn ?? 0,
    outForMeal: r.outForMeal ?? 0,
  }));
}

/** A unit's `customersIn` as the unit card sends it, with absent (NaN) as 0. */
function rawCustomersIn(sim: PortSim, id: number): number {
  const raw = sim.unitCard(id).customersIn;
  if (raw === undefined) {
    throw new Error(`roomTallies: the engine has no unit card for room #${id}`);
  }
  return Number.isNaN(raw) ? 0 : raw;
}
