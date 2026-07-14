import { describe, it, expect } from "vitest";
import { Tower } from "../Tower";
import { Crowd } from "../Crowd";
import { Clock } from "../Clock";
import type { FacilityKind } from "../types";
import type { Person } from "./person";
import { METRO_DWELL_MIN, METRO_DWELL_MAX } from "./person";
import { spawnFloors, spawnTrips } from "./spawn";

/**
 * Routed metro commuters: the station as a second street door. Arrivals step
 * off the train onto the platform and ride up; departures ride down and wait
 * at the platform edge on a `dwell`. Gated on an operational metro, so a
 * tower without one pushes the exact spawn options it always did (the golden
 * master's fixture has none and stays byte-stable). Party hall, cinema, and
 * wedding attendance are covered by the visits flow and its own tests.
 */

/** A weekday clock parked inside the given hour. (A bare `new Clock()` starts
 *  at 07:00; passing explicit minutes anchors the hour exactly.) */
function clockAt(hour: number): Clock {
  return new Clock(hour * 60);
}

const must = (tower: Tower, kind: FacilityKind, f: number, x: number): number => {
  const r = tower.place(kind, f, x);
  if (!r.ok || r.unitId == null) throw new Error(`fixture place ${kind} @ floor ${f}, x ${x} failed: ${r.reason}`);
  return r.unitId;
};

/** Ground lobby + offices and condos upstairs, so every window has trip
 *  origins and destinations besides the venue under test. The metro spans the
 *  WHOLE 375-tile lot on three basement stories, so `withBasement` lays a
 *  full-lot ground line and digs B1..B4 across it (basements hang off the
 *  level above, exactly the screenshot builder's recipe). */
function baseTower(withBasement = false): Tower {
  const tower = new Tower();
  const groundW = withBasement ? 375 : 40;
  for (let x = 0; x < groundW; x++) must(tower, "lobby", 1, x);
  if (withBasement) for (const f of [0, -1, -2, -3]) for (let x = 0; x < 375; x++) must(tower, "floor", f, x);
  for (const f of [2, 3, 4, 5]) for (let x = 0; x < 40; x++) must(tower, "floor", f, x);
  for (const x of [0, 9]) {
    const id = must(tower, "office", 2, x);
    const u = tower.getUnit(id)!;
    u.state = "occupied";
    u.occupants = 4;
  }
  for (const x of [0, 16]) {
    const id = must(tower, "condo", 3, x);
    tower.getUnit(id)!.state = "occupied";
  }
  return tower;
}

/** Add an operational metro (stories -3..-1, platform on -2) with a shaft
 *  from the platform up through the tower. */
function withMetro(tower: Tower): { stationFloor: number; platform: number } {
  const id = must(tower, "metro", -3, 0);
  tower.getUnit(id)!.state = "occupied";
  const res = tower.placeTransport("elevatorStandard", 4, -2, 4);
  if (!res.ok) throw new Error(`metro shaft failed: ${res.reason}`);
  return { stationFloor: -3, platform: -2 };
}

/** Drive spawnTrips enough times that every option in the pool fires. */
function churn(crowd: Crowd, tower: Tower, clock: Clock, rounds = 60): Person[] {
  const floors = spawnFloors(tower, clock);
  for (let i = 0; i < rounds; i++) spawnTrips(crowd, tower, clock, floors);
  return crowd.people;
}

describe("spawnFloors venue bins", () => {
  it("bins an operational metro, and drops a broken one", () => {
    const tower = baseTower(true);
    withMetro(tower);

    const evening = spawnFloors(tower, clockAt(18));
    expect(evening.metroStations.map((u) => u.kind)).toEqual(["metro"]);

    // The metro never closes.
    expect(spawnFloors(tower, clockAt(3)).metroStations).toHaveLength(1);

    // A station on fire moves no trains.
    tower.units.find((u) => u.kind === "metro")!.state = "fire";
    expect(spawnFloors(tower, clockAt(18)).metroStations).toEqual([]);
  });
});

describe("metro commuter trips", () => {
  it("morning arrivals spawn ON the platform, inside the station footprint", () => {
    const tower = baseTower(true);
    const { platform } = withMetro(tower);
    const station = tower.units.find((u) => u.kind === "metro")!;
    const people = churn(new Crowd(7), tower, clockAt(8));
    const arrivals = people.filter((p) => p.floors[0] === platform);
    expect(arrivals.length).toBeGreaterThan(0);
    for (const p of arrivals) {
      expect(p.x).toBeGreaterThanOrEqual(station.x + 2);
      expect(p.x).toBeLessThanOrEqual(station.x + station.width - 3);
      expect(p.floors[p.floors.length - 1]).not.toBe(platform);
    }
  });

  it("departures head DOWN to the platform and wait there for their train", () => {
    const tower = baseTower(true);
    const { platform } = withMetro(tower);
    const station = tower.units.find((u) => u.kind === "metro")!;
    const people = churn(new Crowd(7), tower, clockAt(18));
    const departures = people.filter((p) => p.floors[p.floors.length - 1] === platform);
    expect(departures.length).toBeGreaterThan(0);
    for (const p of departures) {
      expect(p.destX).toBeGreaterThanOrEqual(station.x + 2);
      expect(p.destX).toBeLessThanOrEqual(station.x + station.width - 3);
      expect(p.dwell).toBeGreaterThanOrEqual(METRO_DWELL_MIN);
      expect(p.dwell).toBeLessThanOrEqual(METRO_DWELL_MAX);
    }
  });

  it("an unreachable platform spawns no commuters (no transport runs that deep)", () => {
    const tower = baseTower(true);
    must(tower, "metro", -3, 0);
    tower.units.find((u) => u.kind === "metro")!.state = "occupied";
    // No shaft to the platform: options fire but every route is null.
    const people = churn(new Crowd(7), tower, clockAt(8));
    expect(people.filter((p) => p.floors.includes(-2))).toHaveLength(0);
  });
});

describe("the dwell timer", () => {
  /** A person already standing at their destination spot. */
  function arrived(dwell?: number): Person {
    return {
      id: 1,
      seed: 1,
      state: "toDest",
      floor: 2,
      fy: 2,
      x: 20,
      floors: [2],
      shafts: [],
      leg: 0,
      shaftId: null,
      carIndex: null,
      destX: 20,
      wait: 0,
      age: 0,
      linger: 0,
      dwell,
    };
  }

  it("holds a dwelling commuter in place, then releases them", () => {
    const tower = baseTower();
    const crowd = new Crowd(3);
    crowd.people.push(arrived(10));
    for (let i = 0; i < 12; i++) crowd.advance(0.5, tower); // 6s: still waiting for the train
    expect(crowd.people).toHaveLength(1);
    expect(crowd.people[0].x).toBe(20);
    for (let i = 0; i < 12; i++) crowd.advance(0.5, tower); // 12s total: the train came
    expect(crowd.people).toHaveLength(0);
  });

  it("keeps the default two-second linger for ordinary trips", () => {
    const tower = baseTower();
    const crowd = new Crowd(3);
    crowd.people.push(arrived());
    for (let i = 0; i < 6; i++) crowd.advance(0.5, tower); // 3s > the default 2s
    expect(crowd.people).toHaveLength(0);
  });
});
