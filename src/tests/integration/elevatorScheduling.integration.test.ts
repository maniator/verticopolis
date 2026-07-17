import { describe, it, expect } from "vitest";
import { Tower } from "../../engine/Tower";
import { ElevatorDispatch, type DispatchClock } from "../../engine/ElevatorDispatch";
import type { ElevatorCalls } from "../../engine/Crowd";
import type { ElevatorSchedule } from "../../engine/elevatorSchedule";

/**
 * Elevator schedule dispatch integration (elevator-scheduling, #305, Phase 2). The
 * schedule shapes SUPPLY and POSITIONING, never routing: on-shift car counts, where
 * idle cars home, the per-shaft dwell (Standard Floor Departure), and the parked-car
 * hold (Waiting Car Response). These drive the dispatcher directly against a bare
 * tower and observe the cars. The invariants under test are the GDD's: an absent
 * schedule is unchanged (pinned by the golden master elsewhere), a scheduled shaft
 * pre-positions its fleet, and a starved shaft still counts as serving its floors.
 */

/** A tower spanning floors 1..top with 40-wide plates and one standard elevator.
 *  Every placement the scenarios depend on is asserted (AGENTS.md), so a silent
 *  placement failure surfaces here instead of quietly exercising a different tower. */
function towerWithElevator(top: number): Tower {
  const tower = new Tower();
  for (let x = 0; x < 40; x++) expect(tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= top; f++) for (let x = 0; x < 40; x++) expect(tower.place("floor", f, x).ok).toBe(true);
  const ev = tower.placeTransport("elevatorStandard", 4, 1, top);
  expect(ev.ok, ev.reason).toBe(true);
  return tower;
}

/** A persistent hall call on each named floor (the drawn-crowd channel). */
function hallCalls(shaftId: number, floors: number[]): ElevatorCalls {
  return { hall: new Map([[shaftId, new Map(floors.map((f) => [f, 1]))]]), cab: new Map() };
}

const WEEKDAY: DispatchClock = { hour: 17, isWeekend: false };
const WEEKEND: DispatchClock = { hour: 17, isWeekend: true };

/** A 24-hour row that is `value` at every hour (so any clock hour selects it). */
function flatRow(value: number): number[] {
  return Array(24).fill(value);
}

describe("elevator schedule dispatch (#305 Phase 2)", () => {
  it("homes idle cars at their authored floor instead of collapsing to the lobby", () => {
    // No demand: the only thing deciding where cars rest is the home floor.
    const scheduled = towerWithElevator(20);
    scheduled.setCars(scheduled.transports[0].id, 3);
    scheduled.transports[0].schedule = { homeFloors: [18, 18, 18] };
    const baseline = towerWithElevator(20);
    baseline.setCars(baseline.transports[0].id, 3); // no schedule: today's lobby idle

    const dispatch = new ElevatorDispatch();
    const other = new ElevatorDispatch();
    for (let i = 0; i < 200; i++) {
      dispatch.moveCars(scheduled, 1, undefined, WEEKDAY);
      other.moveCars(baseline, 1, undefined, WEEKDAY);
    }

    const st = scheduled.transports[0];
    expect(st.carPositions.every((p) => Math.abs(p - 18) < 0.05)).toBe(true); // staged up-tower
    expect(st.carDir.every((d) => d === 0)).toBe(true); // parked, not pacing
    const bt = baseline.transports[0];
    expect(bt.carPositions.every((p) => Math.abs(p - bt.bottom) < 0.5)).toBe(true); // lobby, as before
  });

  it("ignores the schedule entirely when no clock is supplied (pre-schedule behavior)", () => {
    // The clock gates every schedule read: a caller that omits it (a test, future
    // tooling) gets today's behavior even on a scheduled shaft, so authored home
    // floors do not silently take effect off the live loop.
    const tower = towerWithElevator(20);
    tower.setCars(tower.transports[0].id, 3);
    const t = tower.transports[0];
    t.schedule = { homeFloors: [18, 18, 18], activeCars: { weekday: flatRow(1) } };
    const dispatch = new ElevatorDispatch();
    for (let i = 0; i < 200; i++) dispatch.moveCars(tower, 1, undefined); // no clock
    // Cars idle at the derived lobby, not the authored home floor, and all three run
    // (the 1-active row is ignored), exactly as before the schedule existed.
    expect(t.carPositions.every((p) => Math.abs(p - t.bottom) < 0.5)).toBe(true);
  });

  it("parks a shaft's cars for a 0-active hour without stranding its floors", () => {
    const tower = towerWithElevator(20);
    tower.setCars(tower.transports[0].id, 3);
    const t = tower.transports[0];
    // The whole fleet is off shift this hour (canon: a graveyard-shift shutdown).
    t.schedule = { activeCars: { weekday: flatRow(0) } };
    const calls = hallCalls(t.id, [14]); // a real caller waits high up

    const dispatch = new ElevatorDispatch();
    for (let i = 0; i < 300; i++) dispatch.moveCars(tower, 1, calls, WEEKDAY);

    // No car climbs to serve the call: the schedule cut supply this hour.
    expect(t.carPositions.every((p) => p < 3)).toBe(true);
    expect(t.carDir.every((d) => d === 0)).toBe(true);
    // But the floor is NOT stranded: it still counts as served for routing (the
    // rider waits, the graph is unchanged). Invariant GDD 6.3.
    expect(tower.servedFloors().has(14)).toBe(true);

    // Flip the same hour to a full fleet and a car now serves it: proof the parking
    // was the schedule, not a broken tower.
    t.schedule = { activeCars: { weekday: flatRow(3) } };
    const live = new ElevatorDispatch();
    let served = false;
    for (let i = 0; i < 300 && !served; i++) {
      live.moveCars(tower, 1, calls, WEEKDAY);
      served = t.carPositions.some((p) => Math.abs(p - 14) < 0.5);
    }
    expect(served).toBe(true);
  });

  it("runs the weekday row on a weekday and the weekend row on a weekend", () => {
    // Home the whole fleet in the lobby so an off-shift car is unmistakably parked
    // at floor 1, and put demand on three separate floors so up to three cars work.
    const schedule: ElevatorSchedule = {
      activeCars: { weekday: flatRow(1), weekend: flatRow(3) },
      homeFloors: [1, 1, 1],
    };
    const demand = [8, 13, 18];

    function activeCarsAway(clock: DispatchClock): number {
      const tower = towerWithElevator(20);
      tower.setCars(tower.transports[0].id, 3);
      const t = tower.transports[0];
      t.schedule = schedule;
      const dispatch = new ElevatorDispatch();
      const calls = hallCalls(t.id, demand);
      for (let i = 0; i < 250; i++) dispatch.moveCars(tower, 1, calls, clock);
      // Cars that left the lobby to serve demand (an off-shift car stays parked at 1).
      return t.carPositions.filter((p) => p > 3).length;
    }

    expect(activeCarsAway(WEEKDAY)).toBe(1); // one car on shift, two parked in the lobby
    expect(activeCarsAway(WEEKEND)).toBeGreaterThan(1); // the fuller weekend fleet spreads out
  });

  it("holds a longer Standard Floor Departure at a served floor", () => {
    // One car ferrying between two persistent calls. A longer per-shaft dwell keeps
    // it stationary at a stop for more ticks; a zero dwell never lingers.
    function dwellTicksAtStops(standardFloorDeparture: number): number {
      const tower = towerWithElevator(20);
      tower.setCars(tower.transports[0].id, 1);
      const t = tower.transports[0];
      t.schedule = { standardFloorDeparture };
      const calls = hallCalls(t.id, [6, 14]);
      const dispatch = new ElevatorDispatch();
      let held = 0;
      let prev = t.carPositions[0];
      for (let i = 0; i < 200; i++) {
        dispatch.moveCars(tower, 1, calls, WEEKDAY);
        const pos = t.carPositions[0];
        const atStop = Math.abs(pos - 6) < 0.05 || Math.abs(pos - 14) < 0.05;
        if (atStop && Math.abs(pos - prev) < 0.01) held++; // stationary at a stop = dwelling
        prev = pos;
      }
      return held;
    }

    const longDwell = dwellTicksAtStops(60); // the max, 1.0 game-minute hold
    const noDwell = dwellTicksAtStops(0); // never holds
    expect(longDwell).toBeGreaterThan(noDwell);
  });

  it("makes a parked car hold for a far call under a high Waiting Car Response", () => {
    // Two cars homed mid-tower; once parked there, a distant call tests the hold.
    function serviced(waitingCarResponse: number | undefined): boolean {
      const tower = towerWithElevator(20);
      tower.setCars(tower.transports[0].id, 2);
      const t = tower.transports[0];
      const schedule: ElevatorSchedule = { homeFloors: [10, 10] };
      if (waitingCarResponse !== undefined) schedule.waitingCarResponse = waitingCarResponse;
      t.schedule = schedule;
      const dispatch = new ElevatorDispatch();
      // Let the cars travel to their home floor and park (no calls yet).
      for (let i = 0; i < 60; i++) dispatch.moveCars(tower, 1, undefined, WEEKDAY);
      expect(t.carPositions.every((p) => Math.abs(p - 10) < 0.05)).toBe(true);
      // Now a call appears far below the staged cars (distance 8, span 19).
      const calls = hallCalls(t.id, [2]);
      let reached = false;
      for (let i = 0; i < 200 && !reached; i++) {
        dispatch.moveCars(tower, 1, calls, WEEKDAY);
        reached = t.carPositions.some((p) => Math.abs(p - 2) < 0.5);
      }
      return reached;
    }

    // High response (reach = span 19 - 15 = 4 < distance 8): the staged cars hold.
    expect(serviced(15)).toBe(false);
    // No response set: the dispatcher answers the call as it does today.
    expect(serviced(undefined)).toBe(true);
  });

  it("still answers a within-reach call in the other direction when a far call is held", () => {
    // A parked car scans up first; a far up-call must not mask a near down-call that
    // is inside the response reach (the gate is applied per scan direction).
    const tower = towerWithElevator(20);
    tower.setCars(tower.transports[0].id, 1);
    const t = tower.transports[0];
    t.schedule = { homeFloors: [10], waitingCarResponse: 15 }; // reach = span 19 - 15 = 4
    const dispatch = new ElevatorDispatch();
    for (let i = 0; i < 60; i++) dispatch.moveCars(tower, 1, undefined, WEEKDAY); // park at home 10
    expect(Math.abs(t.carPositions[0] - 10) < 0.05).toBe(true);
    // Floor 15 is above (distance 5, held); floor 8 is below (distance 2, in reach).
    const calls = hallCalls(t.id, [15, 8]);
    let reachedNear = false;
    for (let i = 0; i < 200 && !reachedNear; i++) {
      dispatch.moveCars(tower, 1, calls, WEEKDAY);
      reachedNear = Math.abs(t.carPositions[0] - 8) < 0.5;
    }
    expect(reachedNear).toBe(true); // the near, in-reach caller is served, not starved
  });

  it("parks a car cleanly even when an authored home floor is off the shaft", () => {
    // A stale home floor above the shaft top (a resize can leave one behind) must
    // still let the car settle and park, not pin it in perpetual motion.
    const tower = towerWithElevator(20);
    tower.setCars(tower.transports[0].id, 1);
    const t = tower.transports[0];
    t.schedule = { homeFloors: [100] }; // way above top = 20
    const dispatch = new ElevatorDispatch();
    for (let i = 0; i < 200; i++) dispatch.moveCars(tower, 1, undefined, WEEKDAY);
    expect(Math.abs(t.carPositions[0] - t.top) < 0.05).toBe(true); // clamped to the ceiling
    expect(t.carDir[0]).toBe(0); // and actually parked, not frozen mid-motion
  });

  it("is deterministic: a scheduled tower reproduces run-to-run", () => {
    const schedule: ElevatorSchedule = {
      activeCars: { weekday: flatRow(2), weekend: flatRow(1) },
      homeFloors: [12, 12, 3],
      waitingCarResponse: 4,
      standardFloorDeparture: 20,
    };
    function run(): { pos: number[]; dir: number[]; load: number[] } {
      const tower = towerWithElevator(20);
      tower.setCars(tower.transports[0].id, 3);
      const t = tower.transports[0];
      t.schedule = { ...schedule, homeFloors: [...schedule.homeFloors!] };
      const dispatch = new ElevatorDispatch();
      const calls = hallCalls(t.id, [6, 14, 18]);
      for (let i = 0; i < 150; i++) dispatch.moveCars(tower, 1, calls, WEEKDAY);
      return { pos: [...t.carPositions], dir: [...t.carDir], load: [...(t.carLoad ?? [])] };
    }
    const a = run();
    const b = run();
    expect(b).toEqual(a); // no RNG anywhere in the schedule read
  });
});
