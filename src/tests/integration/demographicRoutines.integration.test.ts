import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { Clock } from "../../engine/Clock";
import { CROWD_SECONDS_PER_MINUTE } from "../../engine/Crowd";
import { ECON } from "../../engine/econConfig";
import { FACILITIES } from "../../engine/facilities";
import type { FacilityKind, Unit } from "../../engine/types";
import type { Person } from "../../engine/crowd/person";
import {
  SCHOOL_RUN_DEPART_START,
  SCHOOL_RUN_DEPART_END,
  SCHOOL_RUN_RETURN_START,
  SCHOOL_RUN_RETURN_END,
  SALES_CALL_START,
  SALES_CALL_END,
} from "../../engine/sim/constants";

/**
 * Demographic routines (condo-demographic-routines, #397): the statistical
 * school-run and sales-call spawn biases on the crowd layer. Modern-only via
 * `GameRules.demographicRoutines`; Classic reads zero weights and the spawn
 * overlay returns before any RNG draw (the Classic golden-master hash in
 * `goldenMaster.integration.test.ts` is the byte-level proof the stream is
 * unperturbed; this file adds the behavioral half). Everything here is
 * seeded and deterministic (fixed seed, pinned clock, asserted fixture), so
 * the statistical assertions are stable run-to-run.
 */

/** Place a room and assert its construction (surfacing `reason` on failure),
 *  then return the live unit, so a fixture-critical placement can never
 *  silently build a different tower (AGENTS.md fixture-assertion rule). */
function placeUnit(sim: Simulation, kind: FacilityKind, floor: number, x: number): Unit {
  const r = sim.tower.place(kind, floor, x);
  expect(r.ok, `place(${kind}, ${floor}, ${x}) failed: ${r.reason ?? "unknown"}`).toBe(true);
  const u = sim.tower.units.find((cand) => cand.id === r.unitId);
  if (!u) throw new Error(`place(${kind}, ${floor}, ${x}) returned no unit id`);
  return u;
}

/** Lay a 40-tile structure strip (x 0..39), asserting every tile lands. */
function layStrip(sim: Simulation, kind: "lobby" | "floor", floor: number): void {
  for (let x = 0; x < 40; x++) {
    const r = sim.tower.place(kind, floor, x);
    expect(r.ok, `place(${kind}, ${floor}, ${x}) failed: ${r.reason ?? "unknown"}`).toBe(true);
  }
}

const CONDO_FLOORS = [3, 4];
const OFFICE_FLOOR = 2;

/**
 * The shared fixture: a 40-wide strip with a ground lobby, three occupied
 * offices on floor 2, and four occupied condos on floors 3-4, one elevator
 * serving 1..5. Deliberately NO food venues, so the meal overlay contributes
 * nothing in any window and every routine-tagged person in a test window is
 * attributable to this feature alone. Star 1 keeps random fires gated;
 * `occupy: false` leaves every room empty/unstaffed for the vacancy test.
 */
function routineTower(mode: "classic" | "modern", occupy = true): Simulation {
  const sim = new Simulation(2024, mode, "realWorld");
  sim.money = 1_000_000;
  sim.star = 1;
  layStrip(sim, "lobby", 1);
  for (let f = 2; f <= 5; f++) layStrip(sim, "floor", f);
  const ev = sim.tower.placeTransport("elevatorStandard", 4, 1, 5);
  expect(ev.ok, `elevator: ${ev.reason ?? "unknown"}`).toBe(true);
  const offices = [8, 18, 28].map((x) => placeUnit(sim, "office", OFFICE_FLOOR, x));
  const condos = CONDO_FLOORS.flatMap((f) => [placeUnit(sim, "condo", f, 8), placeUnit(sim, "condo", f, 24)]);
  if (occupy) {
    for (const o of offices) {
      o.state = "occupied";
      // Seed occupants directly: `updatePresence` runs on hour boundaries, so a
      // fixture that pins the clock to a specific hour would otherwise start
      // the first ticks at the Unit default of 0 (routines require
      // `visibleOccupants > 0`). The hourly presence pass then keeps writing
      // the same weekday-daytime values, so the seed never fights it.
      o.occupants = FACILITIES.office.population;
    }
    for (const c of condos) {
      c.state = "occupied";
      c.occupants = 1; // the weekday-daytime "one stays home"
    }
  }
  return sim;
}

/** Force the sim clock to a specific weekday hour (day 0 is a Monday under the
 *  real-world calendar). */
function setHour(sim: Simulation, hour: number): void {
  sim.clock = new Clock(hour * 60, sim.clock.calendar);
}

/** Force the sim clock to a weekend day (day 5 = Saturday under real-world). */
function setToWeekend(sim: Simulation, hour: number): void {
  sim.clock = new Clock(5 * 1440 + hour * 60, sim.clock.calendar);
}

/** Snapshot of one routine-tagged person, captured at spawn time. */
interface Tagged {
  routine: NonNullable<Person["routine"]>;
  origin: number;
  dest: number;
  originUnitId: number | undefined;
}

/**
 * Tick `minutes` one game-minute at a time, capturing every NEW routine-tagged
 * person at the tick it appears (people despawn in seconds of crowd time, so
 * per-minute sampling sees each spawn) plus two live observations the sales
 * call assertions read: whether any tagged person was seen mid-dwell or
 * mid-return, and whether any origin room was visibly thinned (outForMeal).
 */
function pump(sim: Simulation, minutes: number) {
  const tagged: Tagged[] = [];
  let dwellSeen = false;
  let returnSeen = false;
  let originThinned = false;
  const seen = new Set<number>();
  for (let m = 0; m < minutes; m++) {
    sim.tick(1);
    for (const p of sim.crowd.people) {
      if (p.routine === undefined) continue;
      if (!seen.has(p.id)) {
        seen.add(p.id);
        tagged.push({
          routine: p.routine,
          origin: p.floors[0],
          dest: p.floors[p.floors.length - 1],
          originUnitId: p.originUnitId,
        });
      }
      if (p.routine === "salesCall" && p.state === "dwelling") dwellSeen = true;
      if (p.routine === "salesCall" && p.returning) returnSeen = true;
    }
    if (sim.tower.units.some((u) => (u.outForMeal ?? 0) > 0)) originThinned = true;
  }
  return { tagged, dwellSeen, returnSeen, originThinned };
}

describe("routine windows and weights pinned", () => {
  it("pins the structural hour windows (sim/constants)", () => {
    expect(SCHOOL_RUN_DEPART_START).toBe(7);
    expect(SCHOOL_RUN_DEPART_END).toBe(8);
    expect(SCHOOL_RUN_RETURN_START).toBe(15);
    expect(SCHOOL_RUN_RETURN_END).toBe(16);
    expect(SALES_CALL_START).toBe(10);
    expect(SALES_CALL_END).toBe(15);
  });

  it("pins the Modern weights (ECON) as positive probabilities", () => {
    expect(ECON.demographicRoutineWeights.schoolRun).toBeGreaterThan(0);
    expect(ECON.demographicRoutineWeights.salesCall).toBeGreaterThan(0);
    expect(ECON.demographicRoutineWeights.salesCall).toBeLessThanOrEqual(1);
  });
});

describe("school run (Modern): condo departures in the morning window, returns in the afternoon", () => {
  it("emits condo -> lobby departures during the 7-8am window, attributed to occupied condos", () => {
    const sim = routineTower("modern");
    setHour(sim, SCHOOL_RUN_DEPART_START);
    const { tagged } = pump(sim, 60);
    const departures = tagged.filter((t) => t.routine === "schoolRun");
    expect(departures.length).toBeGreaterThan(0);
    for (const d of departures) {
      expect(CONDO_FLOORS).toContain(d.origin);
      expect(d.dest).toBe(1);
      // The wave rides the round-trip machinery's origin attribution: each
      // departure is keyed to a concrete occupied condo via originUnitId.
      const origin = sim.tower.units.find((u) => u.id === d.originUnitId);
      expect(origin?.kind).toBe("condo");
    }
  });

  it("emits lobby -> condo returns during the 15:00 window", () => {
    const sim = routineTower("modern");
    setHour(sim, SCHOOL_RUN_RETURN_START);
    const { tagged } = pump(sim, 60);
    const returns = tagged.filter((t) => t.routine === "schoolRun");
    expect(returns.length).toBeGreaterThan(0);
    for (const r of returns) {
      expect(r.origin).toBe(1);
      expect(CONDO_FLOORS).toContain(r.dest);
    }
  });

  it("emits NO school-run trips in a quiet window (12:00, between the waves)", () => {
    const sim = routineTower("modern");
    setHour(sim, 12);
    const { tagged } = pump(sim, 60);
    expect(tagged.filter((t) => t.routine === "schoolRun").length).toBe(0);
  });

  it("emits NO school-run trips on a weekend morning (no school on weekends)", () => {
    const sim = routineTower("modern");
    setToWeekend(sim, SCHOOL_RUN_DEPART_START);
    const { tagged } = pump(sim, 60);
    expect(tagged.filter((t) => t.routine === "schoolRun").length).toBe(0);
  });
});

describe("sales calls (Modern): occupied offices emit midday round trips", () => {
  it("emits office -> lobby departures in the midday window that dwell and return (a real round trip)", () => {
    const sim = routineTower("modern");
    setHour(sim, 12);
    // 150 game minutes: enough for a 12:xx departure to travel, sit out its
    // 30-60 game-minute dwell (the off-site meeting), and be observed on the
    // return leg, all inside the 10-15 window.
    const { tagged, dwellSeen, returnSeen, originThinned } = pump(sim, 150);
    const calls = tagged.filter((t) => t.routine === "salesCall");
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.origin).toBe(OFFICE_FLOOR);
      expect(c.dest).toBe(1);
      const origin = sim.tower.units.find((u) => u.id === c.originUnitId);
      expect(origin?.kind).toBe("office");
    }
    // The round trip is real: callers were observed mid-dwell and mid-return,
    // and their office visibly thinned while they were out (outForMeal).
    expect(dwellSeen).toBe(true);
    expect(returnSeen).toBe(true);
    expect(originThinned).toBe(true);
  });

  it("emits NO sales calls outside the window while offices are still staffed (16:00)", () => {
    const sim = routineTower("modern");
    setHour(sim, 16);
    const { tagged } = pump(sim, 60);
    expect(tagged.filter((t) => t.routine === "salesCall").length).toBe(0);
  });

  it("emits NO sales calls on a weekend, mid-window (weekday-only rides office staffing)", () => {
    // Sales calls carry no explicit weekday gate: the spawner draws from
    // staffed offices, and weekend office occupancy is zero, so the routine
    // goes silent for free. This pins that inherited invariant: if weekend
    // office staffing ever becomes a Modern feature, this test goes red and
    // the routine needs its own explicit weekday gate like the school run's.
    const sim = routineTower("modern");
    setToWeekend(sim, 12);
    const { tagged } = pump(sim, 60);
    expect(tagged.filter((t) => t.routine === "salesCall").length).toBe(0);
  });
});

describe("Classic: the identical tower and seed produces no routine trips at all", () => {
  it("spawns zero routine-tagged people across all three windows", () => {
    // The rule-set is the gate: Classic reads zero weights, so the overlay
    // returns before any RNG draw. The byte-level proof that the Classic
    // seeded stream is unperturbed is the UNCHANGED Classic golden-master
    // hash; this asserts the player-visible half.
    for (const hour of [SCHOOL_RUN_DEPART_START, 12, SCHOOL_RUN_RETURN_START]) {
      const sim = routineTower("classic");
      expect(sim.tower.rules.demographicRoutines()).toEqual({ schoolRun: 0, salesCall: 0 });
      setHour(sim, hour);
      const { tagged } = pump(sim, 60);
      expect(tagged.length, `classic tagged spawns at hour ${hour}`).toBe(0);
    }
  });
});

describe("empty rooms emit nothing: unsold condos and vacant offices are silent", () => {
  it("spawns zero routine-tagged people from an unoccupied tower (Modern)", () => {
    // Drive the crowd layer directly (spawn + motion, no economy loop): the
    // full sim's hourly move-in pass could legitimately sell a condo or lease
    // an office mid-pump, which would test a different tower than the vacant
    // one this case is about. The crowd sees exactly the vacant fixture.
    for (const hour of [SCHOOL_RUN_DEPART_START, 12, SCHOOL_RUN_RETURN_START]) {
      const sim = routineTower("modern", false);
      setHour(sim, hour);
      let taggedSeen = 0;
      for (let m = 0; m < 60; m++) {
        sim.crowd.update(CROWD_SECONDS_PER_MINUTE, sim.tower, sim.clock);
        sim.clock.advance(1);
        // Sample every minute (not just at the end), so a tagged person who
        // spawned and despawned mid-pump could not slip past the assertion.
        taggedSeen += sim.crowd.people.filter((p) => p.routine !== undefined).length;
      }
      expect(taggedSeen, `unoccupied tagged spawns at hour ${hour}`).toBe(0);
    }
  });
});
