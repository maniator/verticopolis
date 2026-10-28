import type { ElevatorSchedule } from "../engine/elevatorSchedule";

/**
 * An elevator schedule as the `scheduleShaft` slots (contract section 4): a
 * weekday flag and its 24 hours, the same for the weekend, the two timings
 * (NaN when unset), then the home-floor count and up to 8 floors. The count of
 * slots is the layout's `scheduleSlots`.
 */

const HOURS = 24;
const HOMES = 8;
/** An hour the schedule leaves out: the engine clamps every hour to the
 *  shaft's cars on read, so the most cars a shaft can have means all cars run. */
const ALL_CARS = 8;

export function scheduleSlots(schedule: ElevatorSchedule): Float64Array {
  const row = (hours: number[] | undefined): number[] =>
    hours ? [1, ...Array.from({ length: HOURS }, (_, h) => hours[h] ?? ALL_CARS)] : Array<number>(1 + HOURS).fill(0);
  const homes = (schedule.homeFloors ?? []).slice(0, HOMES);
  return Float64Array.from([
    ...row(schedule.activeCars?.weekday),
    ...row(schedule.activeCars?.weekend),
    schedule.waitingCarResponse ?? NaN,
    schedule.standardFloorDeparture ?? NaN,
    homes.length,
    ...homes,
    ...Array<number>(HOMES - homes.length).fill(0),
  ]);
}
