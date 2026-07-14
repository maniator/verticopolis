import { describe, it, expect } from "vitest";
import { Tower } from "../../engine/Tower";
import { Clock } from "../../engine/Clock";
import { RNG } from "../../engine/rng";
import { ElevatorDispatch } from "../../engine/ElevatorDispatch";
import type { ElevatorCalls } from "../../engine/Crowd";
import { EconomySystem } from "../../engine/EconomySystem";
import { ECON } from "../../engine/econConfig";
import type { SimContext } from "../../engine/SimContext";
import type { FacilityKind } from "../../engine/types";

/**
 * The engine subsystems extracted from Simulation are exercised here in
 * isolation — proof that the decomposition actually bought testability: each
 * runs against a bare Tower (and, for the economy, a tiny hand-rolled
 * SimContext) with no need to stand up the whole game.
 */

function towerWithElevator(top: number): Tower {
  const tower = new Tower();
  for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
  for (let f = 2; f <= top; f++) for (let x = 0; x < 40; x++) tower.place("floor", f, x);
  tower.placeTransport("elevatorStandard", 4, 1, top);
  return tower;
}

describe("ElevatorDispatch", () => {
  it("sends a car up toward a floor with waiting passengers", () => {
    const tower = towerWithElevator(10);
    const r = tower.place("office", 8, 10);
    const u = tower.units.find((uu) => uu.id === r.unitId)!;
    u.state = "occupied";
    u.occupants = 6; // generates demand on floor 8
    const dispatch = new ElevatorDispatch();
    let maxPos = 1;
    for (let i = 0; i < 400; i++) {
      dispatch.update(tower, 1, 1.45);
      for (const p of tower.transports[0].carPositions) maxPos = Math.max(maxPos, p);
    }
    expect(maxPos).toBeGreaterThan(6); // a car climbed to serve the demand
    expect((tower.transports[0].carLoad ?? []).some((n) => n > 0)).toBe(true);
  });

  it("parks idle cars at the lobby with no demand", () => {
    const tower = towerWithElevator(10); // no occupied units → no passengers
    const dispatch = new ElevatorDispatch();
    for (let i = 0; i < 300; i++) dispatch.update(tower, 1, 1.45);
    const t = tower.transports[0];
    expect(t.carPositions.every((p) => Math.abs(p - t.bottom) < 0.5)).toBe(true);
    expect(t.carDir.every((d) => d === 0)).toBe(true);
  });

  it("sends a car to a real waiting person even with zero statistical demand", () => {
    const tower = towerWithElevator(10); // empty tower → the demand model sees nobody
    const dispatch = new ElevatorDispatch();
    const t = tower.transports[0];
    // A routed commuter stands waiting on floor 7 (Crowd.elevatorCalls shape).
    const calls: ElevatorCalls = { hall: new Map([[t.id, new Map([[7, 1]])]]), cab: new Map() };
    let served = false;
    for (let i = 0; i < 100 && !served; i++) {
      dispatch.update(tower, 1, 1.45, calls);
      served = t.carPositions.some((p) => Math.abs(p - 7) < 0.05);
    }
    expect(served).toBe(true);
  });

  it("a car's own rider destination (cab stop) is served even when other cars claim the floor", () => {
    const tower = towerWithElevator(10);
    tower.setCars(tower.transports[0].id, 2);
    const t = tower.transports[0];
    const dispatch = new ElevatorDispatch();
    // Car 1 carries a rider bound for floor 9; floor 9 is also a hall call that
    // car 0 (processed first each tick) would otherwise claim away every tick.
    const calls: ElevatorCalls = {
      hall: new Map([[t.id, new Map([[9, 1]])]]),
      cab: new Map([[t.id, new Map([[1, new Set([9])]])]]),
    };
    let delivered = false;
    for (let i = 0; i < 100 && !delivered; i++) {
      dispatch.update(tower, 1, 1.45, calls);
      delivered = Math.abs(t.carPositions[1] - 9) < 0.05;
    }
    expect(delivered).toBe(true);
  });
});

describe("EconomySystem", () => {
  /** A minimal SimContext over a real tower — no Simulation required. */
  function context(tower: Tower, star = 5): SimContext & { money: number } {
    return {
      tower,
      clock: new Clock(12 * 60),
      rng: new RNG(1),
      money: 0,
      star,
      emit: () => {},
      hasAny: (kind: FacilityKind) => tower.units.some((u) => u.kind === kind),
      hasOperational: (kind: FacilityKind) =>
        tower.units.some((u) => u.kind === kind && u.state !== "construction" && u.state !== "fire"),
      floorLabel: (floor: number) => (floor >= 1 ? `floor ${floor}` : `B${1 - floor}`),
    };
  }

  it("collects quarterly rent from occupied, reachable offices", () => {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) tower.place("floor", 2, x);
    tower.placeTransport("elevatorStandard", 4, 1, 2); // floor 2 is served
    for (let i = 0; i < 2; i++) {
      const r = tower.place("office", 2, i * 9);
      tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    }
    const ctx = context(tower);
    new EconomySystem(ctx).collectRent();
    expect(ctx.money).toBe(2 * ECON.rent.office.default);
  });

  it("collects the player-set office rent, not just the default", () => {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) tower.place("floor", 2, x);
    tower.placeTransport("elevatorStandard", 4, 1, 2);
    const r = tower.place("office", 2, 0);
    const u = tower.units.find((x) => x.id === r.unitId)!;
    u.state = "occupied";
    u.rent = 15_000; // raised above the $10k default
    const ctx = context(tower);
    new EconomySystem(ctx).collectRent();
    expect(ctx.money).toBe(15_000);
  });

  it("charges monthly maintenance for elevator cars and services", () => {
    const tower = towerWithElevator(4);
    tower.place("security", 2, 0); // a maintained service facility
    const ctx = context(tower);
    new EconomySystem(ctx).payMaintenance();
    const cars = tower.transports[0].cars;
    const expected = cars * ECON.maintenancePerCarMonthly + ECON.serviceMaintenanceMonthly.security;
    expect(ctx.money).toBe(-expected);
  });

  it("taxes unsold condos monthly but not sold ones", () => {
    const tower = new Tower();
    for (let x = 0; x < 40; x++) tower.place("lobby", 1, x);
    for (let x = 0; x < 40; x++) tower.place("floor", 2, x);
    const unsold = tower.place("condo", 2, 0);
    const sold = tower.place("condo", 2, 16);
    tower.units.find((u) => u.id === unsold.unitId)!.state = "empty";
    const soldU = tower.units.find((u) => u.id === sold.unitId)!;
    soldU.state = "occupied";
    soldU.everOccupied = true; // already sold — no carrying cost
    const ctx = context(tower);
    new EconomySystem(ctx).payMaintenance();
    // The unsold condo carries price-scaled tax AND flat operating overhead; the
    // sold condo is exempt from both (its income was a one-time sale already banked).
    const tax = Math.ceil(ECON.rent.condo.default * ECON.condoMonthlyTaxRate);
    expect(ctx.money).toBe(-(tax + ECON.overheadPerLeasableUnitMonthly));
  });
});
