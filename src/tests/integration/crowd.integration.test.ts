import { describe, it, expect } from "vitest";
import { Tower } from "../../engine/Tower";
import { Clock } from "../../engine/Clock";
import { Crowd } from "../../engine/Crowd";
import { ElevatorDispatch } from "../../engine/ElevatorDispatch";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";

/**
 * The Crowd is SimTower's signature: real people who route through the tower.
 * These tests cover the BFS over the transport network (the routing brain) and
 * a basic spawn/advance loop (people appear, move, and report stress in range).
 */
describe("Crowd: routing and movement", () => {
  /** A tower with a ground lobby, floors up to `top`, and one elevator. */
  function towerWithElevator(top: number): Tower {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let f = 2; f <= top; f++) for (let x = 0; x < 40; x++) tower.place("floor", f, x);
    tower.placeTransport("elevatorStandard", 4, 1, top);
    return tower;
  }

  it("routes between two floors over a single shaft", () => {
    const tower = towerWithElevator(10);
    const crowd = new Crowd();
    const r = crowd.route(tower, 1, 8);
    expect(r).not.toBeNull();
    expect(r!.floors[0]).toBe(1);
    expect(r!.floors[r!.floors.length - 1]).toBe(8);
    expect(r!.shafts.length).toBe(1);
  });

  it("re-routes after the transport network changes (adjacency cache invalidates)", () => {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let f = 2; f <= 8; f++) for (let x = 0; x < 40; x++) tower.place("floor", f, x);
    const crowd = new Crowd();
    expect(crowd.route(tower, 1, 6)).toBeNull(); // no elevator yet — caches an empty graph
    tower.placeTransport("elevatorStandard", 4, 1, 8); // bumps tower.revision
    expect(crowd.route(tower, 1, 6)).not.toBeNull(); // cache must have refreshed
  });

  it("returns a trivial route to the same floor and null when unreachable", () => {
    const tower = towerWithElevator(10);
    const crowd = new Crowd();
    expect(crowd.route(tower, 5, 5)).toEqual({ floors: [5], shafts: [] });
    // Floor 50 has no structure or shaft serving it.
    expect(crowd.route(tower, 1, 50)).toBeNull();
  });

  it("finds a multi-shaft transfer route through a sky lobby", () => {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let f = 2; f <= 30; f++) for (let x = 0; x < 40; x++) tower.place("floor", f, x);
    for (let x = 0; x < 40; x++) tower.place("lobby", 15, x); // sky lobby
    tower.placeTransport("elevatorStandard", 4, 1, 15); // lower bank
    tower.placeTransport("elevatorStandard", 10, 15, 30); // upper bank
    const crowd = new Crowd();
    const r = crowd.route(tower, 1, 30);
    expect(r).not.toBeNull();
    // Two rides, transferring at the floor-15 sky lobby.
    expect(r!.shafts.length).toBe(2);
    expect(r!.floors).toContain(15);
  });

  it("routes a short hop over stairs on foot (no car needed)", () => {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) tower.place("floor", 2, x);
    const s = tower.placeTransport("stairs", 4, 1, 2);
    const crowd = new Crowd();
    // Floor 2 is reachable on foot via the stairs — a single climbing leg.
    const r = crowd.route(tower, 1, 2);
    expect(r).not.toBeNull();
    expect(r!.floors).toEqual([1, 2]);
    expect(r!.shafts).toEqual([s.transportId]);
  });

  it("delivers a rider to a floor with zero statistical demand (calls carry destinations)", () => {
    // Regression: a picked-up rider's destination must be a live call, or the
    // dispatch — blind to riders — parks the car at the lobby with them aboard
    // until the give-up valve despawns them.
    const tower = towerWithElevator(10); // dead tower: the demand model sees nobody
    const crowd = new Crowd(1);
    const dispatch = new ElevatorDispatch();
    const clock = new Clock(12 * 60);
    const r = crowd.route(tower, 1, 7)!;
    crowd.people.push({
      id: 1, seed: 7, state: "toShaft", floor: 1, fy: 1, x: 5,
      floors: r.floors, shafts: r.shafts, leg: 0, shaftId: r.shafts[0],
      carIndex: null, destX: 30, wait: 0, age: 0, linger: 0,
    });
    let delivered = false;
    for (let i = 0; i < 400 && !delivered; i++) {
      // Browser-like stepping: 1 game-minute of cars, 2 crowd-seconds of crowd.
      dispatch.update(tower, 1, 1.0, crowd.elevatorCalls(tower));
      crowd.update(2, tower, clock);
      const p = crowd.people[0];
      if (!p) break; // despawned without arriving — fail below
      // Boarding must clear the wait: the call is served, so the ride can't
      // keep counting toward frustration (or leave the figure red-"!").
      if (p.state === "riding") expect(p.wait).toBe(0);
      delivered = p.floor === 7 && (p.state === "toDest" || p.state === "done");
    }
    expect(delivered).toBe(true);
  });

  it("spawns and advances commuters, reporting stress in [0,1]", () => {
    const tower = towerWithElevator(8);
    // An occupied office up top gives morning commuters a destination.
    const r = tower.place("office", 5, 0);
    const u = tower.units.find((uu) => uu.id === r.unitId)!;
    u.state = "occupied";
    const crowd = new Crowd();
    const clock = new Clock(8 * 60); // Monday 08:00 — the morning rush
    for (let i = 0; i < 600; i++) crowd.update(0.05, tower, clock);
    expect(crowd.people.length).toBeGreaterThan(0);
    expect(crowd.stress).toBeGreaterThanOrEqual(0);
    expect(crowd.stress).toBeLessThanOrEqual(1);
    // Everyone is heading to or from a real floor on a real route, and their
    // destination sits on built structure (tiles 0..39 here), not in midair.
    for (const p of crowd.people) {
      expect(p.floors.length).toBeGreaterThanOrEqual(2);
      expect(p.shafts.length).toBeGreaterThanOrEqual(1);
      expect(p.destX).toBeGreaterThanOrEqual(0);
      expect(p.destX).toBeLessThanOrEqual(39);
    }
  });

  it("only sends visitors to venues that are currently open", () => {
    const tower = towerWithElevator(8);
    const r = tower.place("fastFood", 5, 0);
    tower.units.find((uu) => uu.id === r.unitId)!.state = "occupied";
    const crowd = new Crowd();
    const small = new Clock(3 * 60); // 03:00 — fast food (07–22) is closed
    for (let i = 0; i < 400; i++) crowd.update(0.05, tower, small);
    expect(crowd.people.length).toBe(0);
  });

  it("does not send workers home from an unstaffed office in the evening", () => {
    const tower = towerWithElevator(8);
    const r = tower.place("office", 5, 0);
    const u = tower.units.find((uu) => uu.id === r.unitId)!;
    u.state = "occupied"; // leased…
    u.occupants = 0; // …but nobody is in today
    const crowd = new Crowd();
    const evening = new Clock(19 * 60); // 19:00 — past the 18:00 staffing window
    for (let i = 0; i < 400; i++) crowd.update(0.05, tower, evening);
    expect(crowd.people.length).toBe(0);
  });

  it("does not send commuters to unstaffed weekend offices", () => {
    const tower = towerWithElevator(8);
    const r = tower.place("office", 5, 0);
    tower.units.find((uu) => uu.id === r.unitId)!.state = "occupied";
    const crowd = new Crowd();
    const saturday = new Clock(5 * 1440 + 8 * 60); // Sat 08:00
    expect(saturday.isWeekend).toBe(true);
    for (let i = 0; i < 400; i++) crowd.update(0.05, tower, saturday);
    // With only an office (no homes/venues), weekends produce no trips.
    expect(crowd.people.length).toBe(0);
  });

  it("never strands a rider when their car is removed", () => {
    const tower = towerWithElevator(8);
    const r = tower.place("office", 5, 0);
    tower.units.find((uu) => uu.id === r.unitId)!.state = "occupied";
    const crowd = new Crowd();
    const clock = new Clock(8 * 60);
    // Advance until at least one commuter is aboard a car.
    let rider;
    for (let i = 0; i < 4000 && !rider; i++) {
      crowd.update(0.05, tower, clock);
      rider = crowd.people.find((p) => p.state === "riding" && p.carIndex != null);
    }
    expect(rider).toBeTruthy();
    const elevator = tower.transports[0];
    // Force the rider onto a high car index, then trim the elevator to one car
    // (Tower.setCars shrinks carPositions out from under them).
    rider!.shaftId = elevator.id;
    rider!.carIndex = elevator.carPositions.length; // now out of range after the trim
    rider!.state = "riding";
    tower.setCars(elevator.id, 1);
    crowd.update(0.05, tower, clock);
    // The guard must have stepped them off rather than riding a phantom car.
    expect(rider!.state).toBe("done");
    // And no surviving rider references a car index that no longer exists.
    for (const p of crowd.people) {
      if (p.state === "riding") expect(p.carIndex!).toBeLessThan(elevator.carPositions.length);
    }
  });

  it("fully resets — no carried spawn backlog after switching sims", () => {
    const tower = towerWithElevator(8);
    const r = tower.place("office", 5, 0);
    tower.units.find((uu) => uu.id === r.unitId)!.state = "occupied";
    const crowd = new Crowd();
    const clock = new Clock(8 * 60);
    for (let i = 0; i < 200; i++) crowd.update(0.05, tower, clock);
    crowd.reset();
    expect(crowd.people.length).toBe(0);
    expect(crowd.stress).toBe(0);
    // A single tiny step must not immediately spawn a backlog from a leftover
    // accumulator (the bug: spawnAcc surviving reset).
    crowd.update(0.001, tower, clock);
    expect(crowd.people.length).toBe(0);
  });
});

describe("Crowd: owned and advanced by the engine", () => {
  it("advances the crowd inside the deterministic tick — no renderer required", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1_000_000_000;
    const c = Math.floor(GRID.width / 2) - 15; // overlap the seeded centre lobby so the strip connects
    for (let x = c; x < c + 30; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 6; f++) for (let x = c; x < c + 30; x++) sim.tower.place("floor", f, x);
    const r = sim.tower.place("office", 5, c);
    const u = sim.tower.units.find((uu) => uu.id === r.unitId)!;
    u.state = "occupied";
    u.everOccupied = true;
    // Elevator on a column clear of the office footprint (c..c+8).
    sim.tower.placeTransport("elevatorStandard", c + 20, 1, 6);
    // Tick through a weekday morning (the world starts Mon 07:00) — workers
    // commute in purely through the engine's own tick.
    for (let i = 0; i < 120; i++) sim.tick(1);
    expect(sim.crowd.people.length).toBeGreaterThan(0);
    // Stress is read straight off the engine-owned crowd, not pushed in.
    expect(sim.crowdStress).toBe(sim.crowd.stress);
  });
});
