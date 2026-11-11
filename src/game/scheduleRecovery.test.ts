import { describe, expect, it } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
import { SCHEDULE_HOURS, scheduleSlots } from "../simport/scheduleSlots";
import { LAYOUT } from "../tests/portKit/mockPort";
import type { ElevatorSchedule } from "../shared/engineTypes";
import {
  acknowledgementKey,
  isElevator,
  recoveredSchedule,
  shortFleets,
  type ShaftFacts,
} from "./scheduleRecovery";

/**
 * The schedule review's rules on hand-built shafts and schedules. The review
 * over the repository's saves on the Rust engine (which shafts of split-tower
 * it flags, and a key that survives a save and reload) is
 * `scheduleRecovery.integration.test.ts`.
 */

const shaft = (cars: number, over: Partial<ShaftFacts> = {}): ShaftFacts => ({
  id: 7,
  kind: "elevatorStandard",
  x: 10,
  bottom: 1,
  top: 9,
  cars,
  ...over,
});
const flat = (n: number) => Array<number>(24).fill(n);
const only = (s: ShaftFacts, activeCars: ElevatorSchedule["activeCars"]) => shortFleets([s], () => ({ activeCars }))[0];

describe("shortFleets keeps detection conservative", () => {
  it("offers the one-click recovery only to a flat, nonzero, short schedule on both day types", () => {
    expect(only(shaft(8), { weekday: flat(3), weekend: flat(3) })?.flatAt).toBe(3);
    // Different counts per day type, a staggered day, an off-duty hour or a missing day are all deliberate shapes.
    expect(only(shaft(8), { weekday: flat(3), weekend: flat(4) })?.flatAt).toBeNull();
    expect(
      only(shaft(8), {
        weekday: flat(3).map((n, h) => (h < 6 ? 1 : n)),
        weekend: flat(3),
      })?.flatAt,
    ).toBeNull();
    expect(
      only(shaft(8), {
        weekday: flat(3).map((n, h) => (h < 6 ? 0 : n)),
        weekend: flat(3),
      })?.flatAt,
    ).toBeNull();
    expect(only(shaft(8), { weekday: flat(3) })?.flatAt).toBeNull();
    expect(only(shaft(8), { weekday: flat(0), weekend: flat(0) })?.flatAt).toBeNull();
  });

  it("still lists a staggered or half-scheduled shaft for manual review", () => {
    const staggered = only(shaft(4), {
      weekday: flat(4).map((n, h) => (h < 8 ? 1 : n)),
      weekend: flat(4),
    });
    expect([staggered?.least, staggered?.most, staggered?.flatAt]).toEqual([1, 4, null]);
    const oneDay = only(shaft(4), { weekday: flat(2) });
    expect([oneDay?.least, oneDay?.most]).toEqual([2, 4]);
  });

  it("skips full fleets, unscheduled shafts and stairs", () => {
    expect(only(shaft(4), { weekday: flat(4), weekend: flat(4) })).toBeUndefined();
    expect(only(shaft(4), {})).toBeUndefined();
    expect(
      shortFleets([shaft(4, { kind: "stairs" })], () => ({
        activeCars: { weekday: flat(1), weekend: flat(1) },
      })),
    ).toEqual([]);
    expect(shortFleets([shaft(4)], () => undefined)).toEqual([]);
  });
});

describe("recoveredSchedule", () => {
  it("fills the on-shift hours, keeps off-duty hours and a missing day, and touches nothing else", () => {
    const schedule: ElevatorSchedule = {
      activeCars: { weekday: flat(3).map((n, h) => (h < 5 ? 0 : n)) },
      homeFloors: [1, 9, 1],
      waitingCarResponse: 4,
      standardFloorDeparture: 30,
    };
    const s = shaft(8);
    const out = recoveredSchedule({ shaft: s, schedule });
    expect(out.activeCars).toEqual({
      weekday: flat(8).map((n, h) => (h < 5 ? 0 : n)),
    });
    expect(out.homeFloors).toEqual([1, 9, 1]);
    expect([out.waitingCarResponse, out.standardFloorDeparture]).toEqual([4, 30]);
    expect(schedule.activeCars?.weekday?.[10]).toBe(3); // the input is not mutated
  });

  it("is idempotent", () => {
    const f = only(shaft(8), { weekday: flat(3), weekend: flat(3) })!;
    const once = recoveredSchedule(f);
    expect(recoveredSchedule({ shaft: f.shaft, schedule: once })).toEqual(once);
    expect(shortFleets([f.shaft], () => once)).toEqual([]);
  });
});

describe("acknowledgementKey", () => {
  it("differs between towers and between shafts, and ignores mutable span geometry", () => {
    const one = acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8));
    expect(acknowledgementKey({ seed: 2, mode: "classic" }, shaft(8))).not.toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "modern" }, shaft(8))).not.toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8, { id: 8 }))).not.toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8, { x: 11 }))).not.toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8, { bottom: 3 }))).toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8, { top: 12 }))).toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8, { cars: 3 }))).toBe(one); // buying a car is not a new shaft
  });
});

describe("the constants kept here instead of imported from the engine", () => {
  it("name the elevators the engine's catalog pools as elevators, and a row of the schedule's length", () => {
    for (const mode of ["classic", "modern"] as const) {
      const facilities = catalogFor(mode).facilities;
      expect(facilities.length).toBeGreaterThan(20);
      for (const f of facilities) expect(isElevator(f.key), `${mode} ${f.key}`).toBe(f.pool === "elevators");
    }
    expect(flat(1)).toHaveLength(SCHEDULE_HOURS);
    // The hours sit in the schedule record the engine's layout publishes.
    expect(scheduleSlots({ activeCars: { weekday: flat(1) } })).toHaveLength((LAYOUT as unknown as { scheduleSlots: number }).scheduleSlots);
  });
});
