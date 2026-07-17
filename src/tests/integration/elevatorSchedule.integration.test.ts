import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { SAVE_VERSION, migrateSave } from "../../engine/saveMigration";
import { SCHEDULE_HOURS } from "../../engine/elevatorSchedule";
import type { ElevatorSchedule } from "../../engine/elevatorSchedule";

/**
 * Elevator schedule persistence (elevator-scheduling, #305, Phase 1). The
 * schedule is authored state on a `Transport`; Phase 1 adds only the model plus
 * its save round-trip and the v6->v7 hop, no dispatch effect. These pin that an
 * authored schedule survives serialize/deserialize (hardened), an absent schedule
 * stays absent, and a pre-schedule save migrates cleanly.
 */

/** A minimal tower with one standard elevator spanning floors 1..8. */
function towerWithElevator(): Simulation {
  const sim = new Simulation(2024, "modern", "realWorld");
  sim.money = 10_000_000;
  const W = 24;
  for (let x = 0; x < W; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= 8; f++) {
    for (let x = 0; x < W; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
  }
  const ev = sim.tower.placeTransport("elevatorStandard", 0, 1, 8);
  expect(ev.ok, ev.reason).toBe(true);
  return sim;
}

function roundTrip(sim: Simulation): Simulation {
  return Simulation.deserialize(sim.serialize());
}

describe("elevator schedule persistence (#305 Phase 1)", () => {
  it("stamps the current save version", () => {
    expect(SAVE_VERSION).toBe(7);
    expect(towerWithElevator().serialize().version).toBe(7);
  });

  it("round-trips an authored schedule intact", () => {
    const sim = towerWithElevator();
    const shaft = sim.tower.transports[0];
    expect(sim.tower.setCars(shaft.id, 4)).toBe(true); // a known car count for the per-car home floors
    const cars = shaft.cars;
    expect(cars).toBe(4);
    // Every value in range so coercion is a no-op and equality is meaningful.
    const weekday = Array.from({ length: SCHEDULE_HOURS }, (_, h) => (h >= 8 && h < 18 ? cars : 1));
    const schedule: ElevatorSchedule = {
      activeCars: { weekday, weekend: Array(SCHEDULE_HOURS).fill(1) },
      waitingCarResponse: 5,
      standardFloorDeparture: 12,
      homeFloors: [1, 1, 8, 8],
    };
    shaft.schedule = schedule;

    const back = roundTrip(sim).tower.transports[0];
    expect(back.schedule).toEqual(schedule);
  });

  it("round-trips a schedule authored through Tower.setSchedule (the dialog's write path, Phase 3)", () => {
    const sim = towerWithElevator();
    const shaft = sim.tower.transports[0];
    expect(sim.tower.setCars(shaft.id, 4)).toBe(true);
    const before = sim.tower.revision;
    // The dialog hands a fully-populated working copy; setSchedule hardens it.
    expect(
      sim.tower.setSchedule(shaft.id, {
        activeCars: { weekday: Array(SCHEDULE_HOURS).fill(2), weekend: Array(SCHEDULE_HOURS).fill(1) },
        waitingCarResponse: 6,
        standardFloorDeparture: 40,
        homeFloors: [1, 1, 8, 8],
      }),
    ).toBe(true);
    expect(sim.tower.revision).toBeGreaterThan(before); // routing/stop caches invalidate
    const back = roundTrip(sim).tower.transports[0];
    expect(back.schedule).toEqual(shaft.schedule);
    expect(back.schedule!.waitingCarResponse).toBe(6);
    expect(back.schedule!.homeFloors).toEqual([1, 1, 8, 8]);
  });

  it("snaps an orphaned home floor to the nearest stop when a stop is edited away (#467)", () => {
    const sim = towerWithElevator();
    const shaft = sim.tower.transports[0];
    expect(shaft.cars).toBe(2); // the fixture default; homes below are per-car
    expect(
      sim.tower.setSchedule(shaft.id, { homeFloors: [5, 1], waitingCarResponse: 3 }),
    ).toBe(true);
    // Skip floor 5: car 1's home is orphaned and must snap to the nearest stop (4).
    expect(sim.tower.setStop(shaft.id, 5, false)).toBe(true);
    expect(shaft.schedule!.homeFloors).toEqual([4, 1]);
    // Re-serving the floor does not move homes back (the snap is one-way, authored state).
    expect(sim.tower.setStop(shaft.id, 5, true)).toBe(true);
    expect(shaft.schedule!.homeFloors).toEqual([4, 1]);
    // The rest of the schedule is untouched by the snap.
    expect(shaft.schedule!.waitingCarResponse).toBe(3);
  });

  it("snaps homes on the express lobby-only lock and on a resize skip resync (#467)", () => {
    const sim = towerWithElevator();
    const shaft = sim.tower.transports[0];
    // Author a home mid-shaft, then lock to lobbies: home snaps to a stop.
    expect(sim.tower.setSchedule(shaft.id, { homeFloors: [5, 1] })).toBe(true);
    expect(sim.tower.setExpressStops(shaft.id)).toBe(true); // lobby (1) + endpoints (1, 8) stop
    expect(shaft.schedule!.homeFloors).toEqual([8, 1]); // 5 snaps to the nearer endpoint 8
    // Tie-break: equidistant stops resolve toward the LOWER floor.
    expect(sim.tower.clearStops(shaft.id)).toBe(true);
    expect(sim.tower.setSchedule(shaft.id, { homeFloors: [4, 1] })).toBe(true);
    expect(sim.tower.setStop(shaft.id, 4, false)).toBe(true); // 3 and 5 both one away
    expect(shaft.schedule!.homeFloors).toEqual([3, 1]);
  });

  it("snaps against fresh stops even when the stopsOf cache is warm (#467)", () => {
    // Dispatch reads tower.stopsOf every tick, so in a live game the
    // per-revision stops cache is always warm when a stop edit lands. The edit
    // must bump the revision BEFORE snapping homes, or the snap reads the
    // stale cached list and leaves the orphaned home in place.
    const sim = towerWithElevator();
    const shaft = sim.tower.transports[0];
    expect(sim.tower.setSchedule(shaft.id, { homeFloors: [5, 1] })).toBe(true);
    expect(sim.tower.stopsOf(shaft)).toContain(5); // warm the cache at the current revision
    expect(sim.tower.setStop(shaft.id, 5, false)).toBe(true);
    expect(shaft.schedule!.homeFloors).toEqual([4, 1]); // snapped against the fresh list
  });

  it("leaves a shaft with no schedule absent (sparse save, today's behavior)", () => {
    const sim = towerWithElevator();
    expect(sim.tower.transports[0].schedule).toBeUndefined();
    const serialized = sim.serialize();
    // Not written when absent (sparse save).
    expect((serialized.transports[0] as { schedule?: unknown }).schedule).toBeUndefined();
    expect(roundTrip(sim).tower.transports[0].schedule).toBeUndefined();
  });

  it("adds nothing but the version stamp to the wire for a schedule-less tower", () => {
    // The golden-master re-pin rests on "only the version field changed 6 -> 7".
    // Prove the wire half here: a schedule-less tower's serialized form carries no
    // `schedule` key anywhere, so this feature added nothing to the saved bytes
    // besides the version bump.
    const serialized = towerWithElevator().serialize();
    expect(serialized.version).toBe(7);
    expect(JSON.stringify(serialized)).not.toContain('"schedule"');
  });

  it("never persists a forged schedule on a non-elevator transport (stairs)", () => {
    const sim = towerWithElevator();
    const stairs = sim.tower.placeTransport("stairs", 22, 1, 2);
    expect(stairs.ok, stairs.reason).toBe(true);
    const serialized = sim.serialize();
    const stairEntry = serialized.transports.find((t) => t.kind === "stairs") as { schedule?: unknown };
    expect(stairEntry).toBeDefined();
    // Forge a schedule onto the car-less stairs, as a tampered save would.
    stairEntry.schedule = { waitingCarResponse: 4, activeCars: { weekday: [1, 2, 3] } };
    const back = Simulation.deserialize(serialized);
    const stairsBack = back.tower.transports.find((t) => t.kind === "stairs")!;
    expect(stairsBack.schedule).toBeUndefined(); // dropped: a car-less transport has no schedule
  });

  it("hardens a forged schedule at the load boundary", () => {
    const sim = towerWithElevator();
    const serialized = sim.serialize();
    // Forge an out-of-range schedule directly onto the serialized shaft, as a
    // tampered save would carry.
    (serialized.transports[0] as { schedule?: unknown }).schedule = {
      activeCars: { weekday: [-9, 999, Number.NaN] },
      waitingCarResponse: 10_000,
      standardFloorDeparture: -50,
      homeFloors: [0, 9999, 4],
    };
    const cars = sim.tower.transports[0].cars;
    const back = Simulation.deserialize(serialized).tower.transports[0];
    const s = back.schedule!;
    expect(s.activeCars?.weekday).toHaveLength(SCHEDULE_HOURS);
    expect(Math.max(...(s.activeCars!.weekday as number[]))).toBeLessThanOrEqual(cars);
    expect(Math.min(...(s.activeCars!.weekday as number[]))).toBeGreaterThanOrEqual(0);
    expect(s.waitingCarResponse!).toBeLessThanOrEqual(30);
    expect(s.standardFloorDeparture).toBe(0);
    for (const f of s.homeFloors!) {
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(8);
    }
  });

  it("migrates a pre-schedule (v6) save cleanly to the current version with no schedule", () => {
    const sim = towerWithElevator();
    const serialized = sim.serialize();
    // Simulate an older save: stamp v6 and strip any schedule field.
    const legacy = {
      ...serialized,
      version: 6,
      transports: serialized.transports.map((t) => {
        const { schedule: _drop, ...rest } = t as { schedule?: unknown };
        return rest;
      }),
    };
    // Assert the migration ladder itself lifts v6 -> current (serialize() would
    // re-stamp the version unconditionally, so check migrateSave directly).
    expect(migrateSave(legacy as typeof serialized).version).toBe(SAVE_VERSION);
    const back = Simulation.deserialize(legacy as typeof serialized);
    expect(back.serialize().version).toBe(SAVE_VERSION);
    expect(back.tower.transports[0].schedule).toBeUndefined();
  });
});
