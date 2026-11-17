import type { ElevatorSchedule } from "../shared/engineTypes";

/**
 * An elevator schedule as the `scheduleShaft` slots (contract section 4): a
 * weekday flag and its 24 hours, the same for the weekend, the two timings
 * (NaN when unset), the home-floor count and up to 8 floors, then the Auto flag
 * (1 on, 0 off). The count of
 * slots is the layout's `scheduleSlots`. `shaftSchedule` answers the same
 * slots, which {@link scheduleFromSlots} reads back.
 */

/** The hours of the day a schedule covers: one per hour, in the port's slots
 *  and in each day's origin ring. */
export const SCHEDULE_HOURS = 24;
const HOMES = 8;
/** An hour the schedule leaves out: the engine clamps every hour to the
 *  shaft's cars on read, so the most cars a shaft can have means all cars run. */
const ALL_CARS = 8;
const AUTO_SLOT = 2 * (1 + SCHEDULE_HOURS) + 2 + 1 + HOMES;
const LEN = AUTO_SLOT + 1;
/** The Auto flag's slot values. */
const AUTO_ON = 1;
const AUTO_OFF = 0;

export function scheduleSlots(schedule: ElevatorSchedule): Float64Array {
  const row = (hours: number[] | undefined): number[] =>
    hours ? [1, ...Array.from({ length: SCHEDULE_HOURS }, (_, h) => hours[h] ?? ALL_CARS)] : Array<number>(1 + SCHEDULE_HOURS).fill(0);
  const homes = (schedule.homeFloors ?? []).slice(0, HOMES);
  return Float64Array.from([
    ...row(schedule.activeCars?.weekday),
    ...row(schedule.activeCars?.weekend),
    schedule.waitingCarResponse ?? NaN,
    schedule.standardFloorDeparture ?? NaN,
    homes.length,
    ...homes,
    ...Array<number>(HOMES - homes.length).fill(0),
    schedule.autoTune ? AUTO_ON : AUTO_OFF,
  ]);
}

/** The slots as a schedule, or undefined when they break the input classes:
 *  the Rust engine's `schedule_json`. Row flags 0 or 1, a set row's hours and
 *  the home floors safe integers, the home count a safe integer up to 8, each
 *  timing finite or NaN for unset, the Auto flag 0 or 1. The ranges stay with the engine's setter,
 *  which clamps them. */
export function scheduleFromSlots(slots: Float64Array): ElevatorSchedule | undefined {
  if (slots.length !== LEN) return undefined;
  const ints = (from: number, n: number): number[] | undefined => {
    const xs = Array.from(slots.subarray(from, from + n));
    return xs.every((x) => Number.isSafeInteger(x)) ? xs : undefined;
  };
  const activeCars: Record<string, number[]> = {};
  for (const [name, at] of [["weekday", 0], ["weekend", 1 + SCHEDULE_HOURS]] as const) {
    if (slots[at] === 1) {
      const hours = ints(at + 1, SCHEDULE_HOURS);
      if (!hours) return undefined;
      activeCars[name] = hours;
    } else if (slots[at] !== 0) {
      return undefined;
    }
  }
  const v: ElevatorSchedule & Record<string, unknown> = { activeCars };
  const timing = 2 * (1 + SCHEDULE_HOURS);
  for (const [i, name] of ["waitingCarResponse", "standardFloorDeparture"].entries()) {
    const t = slots[timing + i];
    if (Number.isFinite(t)) v[name] = t;
    else if (!Number.isNaN(t)) return undefined;
  }
  const homes = timing + 2;
  const n = slots[homes];
  if (!Number.isSafeInteger(n) || n < 0 || n > HOMES) return undefined;
  if (n > 0) {
    const floors = ints(homes + 1, n);
    if (!floors) return undefined;
    v.homeFloors = floors;
  }
  const auto = slots[AUTO_SLOT];
  if (auto === AUTO_ON) v.autoTune = true;
  else if (auto !== AUTO_OFF) return undefined;
  return v;
}
