import { describe, it, expect } from "vitest";
import { Tower } from "../Tower";
import { Crowd } from "../Crowd";
import { CAR_CAPACITY, STRESS_WAIT } from "./person";
import type { Person } from "./person";
import type { FacilityKind } from "../types";

/**
 * The read-only elevator queue + car-fill projection (E6 engine seam). It is a
 * VIEW of already-tracked crowd state: per shaft landing the waiter count and a
 * bounded wait-tier, and per car the boarded count read from the drawn
 * `crowd.carRiders` occupancy. The projection itself does no boarding or
 * capacity math. These tests pin what it surfaces (waiter order and count, wait
 * tier, staff-only shafts, express skip floors, and the (step, revision) memo).
 * The reconciliation itself (`boarded = min(queue, remaining capacity)` and the
 * leftover being the same individuals) is a property of the crowd step, driven
 * here through `crowd.advance(...)`: both halves count ONE population, the drawn
 * crowd, so a waiter boarding moves the same figure from a landing into a car.
 */
describe("Crowd.queueView: read-only elevator queue projection", () => {
  /** A tower with a ground lobby and plain floors 2..top across the whole lot. */
  function baseTower(top = 10): Tower {
    const tower = new Tower();
    const must = (kind: FacilityKind, f: number, x: number) => {
      const r = tower.place(kind, f, x);
      if (!r.ok) throw new Error(`fixture place ${kind} @ floor ${f}, x ${x} failed`);
    };
    for (let x = 0; x < 40; x++) must("lobby", 1, x);
    for (let f = 2; f <= top; f++) for (let x = 0; x < 40; x++) must("floor", f, x);
    return tower;
  }

  function placeShaft(tower: Tower, kind: FacilityKind, x: number, bottom: number, top: number): number {
    const res = tower.placeTransport(kind, x, bottom, top);
    if (!res.ok || res.transportId == null) throw new Error(`placeTransport failed: ${res.reason}`);
    return res.transportId;
  }

  /** A person parked in the `waiting` state at a shaft landing. */
  function waiter(id: number, shaftId: number, floor: number, opts: Partial<Person> = {}): Person {
    return {
      id,
      seed: id,
      state: "waiting",
      floor,
      fy: floor,
      x: 5,
      floors: [floor, floor + 1],
      shafts: [shaftId],
      leg: 0,
      shaftId,
      carIndex: null,
      destX: 20,
      wait: 0,
      age: 0,
      linger: 0,
      ...opts,
    };
  }

  it("projects the waiter count and the max wait-tier per shaft floor", () => {
    const tower = baseTower();
    const s = placeShaft(tower, "elevatorStandard", 4, 1, 10);
    const crowd = new Crowd();
    crowd.people.push(
      waiter(1, s, 3, { wait: 0 }), // tier 0 (below STRESS_WAIT / 2)
      waiter(2, s, 3, { wait: STRESS_WAIT / 2 }), // tier 1 (>= STRESS_WAIT / 2)
      waiter(3, s, 3, { wait: STRESS_WAIT }), // tier 2 (>= STRESS_WAIT)
      waiter(4, s, 5), // a different landing
      waiter(5, s, 3, { state: "toShaft" }), // not waiting yet: excluded
      waiter(6, s, 3, { state: "riding", carIndex: 0 }), // aboard: excluded
      waiter(7, s, 3, { shaftId: null, shafts: [] }), // no shaft assigned: excluded
    );

    const view = crowd.queueView(tower);
    const floor3 = view.landings.get(s)?.get(3);
    expect(floor3).toEqual({ count: 3, tier: 2 }); // three real waiters, worst is fed up
    expect(view.landings.get(s)?.get(5)).toEqual({ count: 1, tier: 0 });
  });

  it("surfaces each car's boarded count from the drawn carRiders", () => {
    const tower = baseTower();
    const s = placeShaft(tower, "elevatorStandard", 4, 1, 10);
    const crowd = new Crowd();
    // carRiders is the drawn per-car occupancy the motion step maintains; set it
    // directly here to pin the per-car plumbing. A routed-boarding reconciliation
    // (real people actually boarding) lives in the "same individuals" test below.
    crowd.carRiders.set(`${s}:0`, 5);
    crowd.carRiders.set(`${s}:1`, 2);
    // A stale statistical carLoad must not leak into the view: boarded is the
    // drawn occupancy, so this value is ignored.
    tower.getTransport(s)!.carLoad = [99, 99];

    const view = crowd.queueView(tower);
    expect(view.boarded.get(s)?.get(0)).toBe(5);
    expect(view.boarded.get(s)?.get(1)).toBe(2);
  });

  it("queues only staff on a staff-only shaft, and tenants on a passenger shaft", () => {
    const tower = baseTower();
    const service = placeShaft(tower, "elevatorService", 4, 1, 10);
    const standard = placeShaft(tower, "elevatorStandard", 20, 1, 10);
    const crowd = new Crowd();
    crowd.people.push(
      waiter(1, service, 3, { staff: true }), // real staff caller: shown
      waiter(2, service, 3, { staff: false }), // a stray tenant on a staff shaft: hidden
      waiter(3, standard, 3, { staff: false }), // tenant on the passenger shaft: shown
    );

    const view = crowd.queueView(tower);
    expect(view.landings.get(service)?.get(3)).toEqual({ count: 1, tier: 0 });
    expect(view.landings.get(standard)?.get(3)).toEqual({ count: 1, tier: 0 });
  });

  it("draws no queue on an express skip floor", () => {
    const tower = baseTower();
    const s = placeShaft(tower, "elevatorExpress", 4, 1, 10);
    tower.getTransport(s)!.skipFloors = [5]; // floor 5 skipped, floor 6 a real stop
    const crowd = new Crowd();
    crowd.people.push(waiter(1, s, 5), waiter(2, s, 6));

    const view = crowd.queueView(tower);
    expect(view.landings.get(s)?.get(5)).toBeUndefined();
    expect(view.landings.get(s)?.get(6)).toEqual({ count: 1, tier: 0 });
  });

  it("reconciles a full car: boarded = remaining capacity, the leftover are the same individuals in order", () => {
    const tower = baseTower();
    const s = placeShaft(tower, "elevatorStandard", 4, 1, 10);
    const shaft = tower.getTransport(s)!;
    shaft.carPositions[0] = 3; // park car 0 at the queued floor (car 1 stays clear)
    const crowd = new Crowd();
    // More waiters than a car holds, in a known order.
    const n = CAR_CAPACITY + 3;
    for (let id = 1; id <= n; id++) crowd.people.push(waiter(id, s, 3));

    // One crowd step boards riders in order up to capacity; the rest stay put.
    crowd.advance(0.5, tower);

    const aboardCar0 = crowd.people.filter((p) => p.state === "riding" && p.carIndex === 0).length;
    expect(aboardCar0).toBe(CAR_CAPACITY); // min(queue = n, remaining capacity = CAR_CAPACITY)
    const leftover = crowd.people.filter((p) => p.state === "waiting").map((p) => p.id);
    expect(leftover).toEqual([CAR_CAPACITY + 1, CAR_CAPACITY + 2, CAR_CAPACITY + 3]);

    // boarded reads the DRAWN per-car occupancy (crowd.carRiders), which the
    // motion step above filled aboard car 0. Assert the view against the
    // INDEPENDENT count of drawn riders on that car (not against carRiders, the
    // read's own source), so this proves the same-individuals tie rather than a
    // passthrough. No hand-written carLoad standing in for the dispatch.
    crowd.beginStep();
    const view = crowd.queueView(tower);
    expect(view.boarded.get(s)?.get(0)).toBe(aboardCar0);
    expect(view.landings.get(s)?.get(3)).toEqual({ count: 3, tier: 0 });
  });

  it("reconciles a short queue: everyone boards and the landing empties", () => {
    const tower = baseTower();
    const s = placeShaft(tower, "elevatorStandard", 4, 1, 10);
    const shaft = tower.getTransport(s)!;
    shaft.carPositions[0] = 3;
    const crowd = new Crowd();
    for (let id = 1; id <= 4; id++) crowd.people.push(waiter(id, s, 3)); // fewer than capacity

    crowd.advance(0.5, tower);

    const aboardCar0 = crowd.people.filter((p) => p.state === "riding" && p.carIndex === 0).length;
    expect(aboardCar0).toBe(4); // min(queue = 4, remaining capacity = CAR_CAPACITY)
    expect(crowd.people.some((p) => p.state === "waiting")).toBe(false);

    crowd.beginStep();
    const view = crowd.queueView(tower);
    // View surfaces the INDEPENDENT count of drawn riders on car 0.
    expect(view.boarded.get(s)?.get(0)).toBe(aboardCar0);
    expect(view.landings.get(s)?.get(3)).toBeUndefined(); // nobody left waiting
  });

  it("boarded counts the SAME drawn individuals as the queue, never the statistical carLoad", () => {
    // The E6-S7 same-individuals reconciliation (GH #314). Real routed figures
    // board through the motion step; boarded must read that drawn occupancy
    // (crowd.carRiders), not a hand-written / dispatch carLoad.
    const tower = baseTower();
    const s = placeShaft(tower, "elevatorStandard", 4, 1, 10);
    const shaft = tower.getTransport(s)!;
    shaft.carPositions[0] = 3; // car 0 waits at the queued floor
    // Poison the statistical carLoad with a value that matches NOTHING about the
    // drawn crowd. If boarded still read carLoad, it would surface this number;
    // the assertions below prove it reads crowd.carRiders instead.
    shaft.carLoad = [999, 999];

    const crowd = new Crowd();
    const n = CAR_CAPACITY + 5;
    for (let id = 1; id <= n; id++) crowd.people.push(waiter(id, s, 3));

    crowd.advance(0.5, tower); // real boarding: motion moves figures into car 0

    // The drawn truth: who is actually aboard car 0, and who is still queued.
    const aboardCar0 = crowd.people.filter((p) => p.state === "riding" && p.carIndex === 0).length;
    const stillWaiting = crowd.people.filter((p) => p.state === "waiting").length;
    expect(aboardCar0).toBe(CAR_CAPACITY);
    expect(stillWaiting).toBe(n - CAR_CAPACITY);
    // Every figure is either aboard or queued: one population, conserved.
    expect(aboardCar0 + stillWaiting).toBe(n);

    crowd.beginStep();
    const view = crowd.queueView(tower);
    // boarded surfaces the drawn occupancy (the independently counted riders on
    // car 0), NOT the poisoned statistical carLoad.
    expect(view.boarded.get(s)?.get(0)).toBe(aboardCar0);
    expect(view.boarded.get(s)?.get(0)).not.toBe(999);
    // The leftover line is the same individuals, now shorter.
    expect(view.landings.get(s)?.get(3)?.count).toBe(stillWaiting);
  });

  it("boarded falls as drawn riders alight: it tracks the whole ride, not just the boarding instant", () => {
    // Guards the full lifecycle of the carRiders read: boarded must drop when
    // riders step off, not just rise when they board.
    const tower = baseTower();
    const s = placeShaft(tower, "elevatorStandard", 4, 1, 10);
    const shaft = tower.getTransport(s)!;
    shaft.carPositions[0] = 3; // car 0 at the queued floor
    const crowd = new Crowd();
    // waiter() routes floor 3 -> 4 (floors [floor, floor + 1]).
    for (let id = 1; id <= 4; id++) crowd.people.push(waiter(id, s, 3));

    crowd.advance(0.5, tower); // board onto car 0
    crowd.beginStep();
    expect(crowd.queueView(tower).boarded.get(s)?.get(0)).toBe(4);

    // Carry car 0 up to the riders' destination floor and step again: the motion
    // step alights them (releaseSeat decrements carRiders), so the drawn
    // occupancy empties and boarded must follow it back to zero.
    shaft.carPositions[0] = 4;
    crowd.advance(0.5, tower);
    expect(crowd.people.some((p) => p.state === "riding")).toBe(false);
    crowd.beginStep();
    expect(crowd.queueView(tower).boarded.get(s)?.get(0)).toBe(0);
  });

  it("memoizes once per step and recomputes only after beginStep", () => {
    const tower = baseTower();
    const s = placeShaft(tower, "elevatorStandard", 4, 1, 10);
    const crowd = new Crowd();
    crowd.people.push(waiter(1, s, 3));

    const first = crowd.queueView(tower);
    expect(crowd.queueView(tower)).toBe(first); // same snapshot within a step

    // A change mid-step is deliberately NOT observed: the render reads a stable
    // per-step snapshot, never a per-frame re-scan.
    crowd.people.push(waiter(2, s, 3));
    expect(crowd.queueView(tower).landings.get(s)?.get(3)?.count).toBe(1);

    crowd.beginStep();
    expect(crowd.queueView(tower).landings.get(s)?.get(3)?.count).toBe(2); // fresh next step
  });
});
