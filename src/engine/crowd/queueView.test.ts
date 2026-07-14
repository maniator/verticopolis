import { describe, it, expect } from "vitest";
import { Tower } from "../Tower";
import { Crowd } from "../Crowd";
import { CAR_CAPACITY, STRESS_WAIT } from "./person";
import type { Person } from "./person";
import type { FacilityKind } from "../types";

/**
 * The read-only elevator queue + car-fill projection (E6 engine seam). It is a
 * VIEW of already-tracked crowd state: per shaft landing the waiter count and a
 * bounded wait-tier, and per car the boarded count read straight from `carLoad`.
 * The projection itself does no boarding or capacity math. These tests pin what
 * it surfaces (waiter order and count, wait tier, staff-only shafts, express
 * skip floors, and the (step, revision) memo). The reconciliation itself
 * (`boarded = min(queue, remaining capacity)` and the leftover being the same
 * individuals) is a property of the crowd step, driven here through
 * `crowd.advance(...)`, after which the surfaced `carLoad` is shown to match.
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

  it("surfaces each car's boarded count straight from carLoad", () => {
    const tower = baseTower();
    const s = placeShaft(tower, "elevatorStandard", 4, 1, 10);
    tower.getTransport(s)!.carLoad = [5, 2];
    const crowd = new Crowd();

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

    const boarded = crowd.people.filter((p) => p.state === "riding").length;
    expect(boarded).toBe(CAR_CAPACITY); // min(queue = n, remaining capacity = CAR_CAPACITY)
    const leftover = crowd.people.filter((p) => p.state === "waiting").map((p) => p.id);
    expect(leftover).toEqual([CAR_CAPACITY + 1, CAR_CAPACITY + 2, CAR_CAPACITY + 3]);

    // The cab fill is engine truth (carLoad); mirror the boarded count onto it
    // the way the dispatch does, then confirm the projection surfaces both the
    // boarded car and the now-shorter leftover queue. NOTE: carLoad is the
    // dispatch's statistical count, a different population from the drawn
    // crowd.people this queue counts, so it is hand-written here as a stand-in.
    // Tying boarded to the drawn crowd is deferred to E6-S7 (see backlog).
    shaft.carLoad = [boarded, 0];
    crowd.beginStep();
    const view = crowd.queueView(tower);
    expect(view.boarded.get(s)?.get(0)).toBe(CAR_CAPACITY);
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

    const boarded = crowd.people.filter((p) => p.state === "riding").length;
    expect(boarded).toBe(4); // min(queue = 4, remaining capacity = CAR_CAPACITY)
    expect(crowd.people.some((p) => p.state === "waiting")).toBe(false);

    shaft.carLoad = [boarded, 0];
    crowd.beginStep();
    const view = crowd.queueView(tower);
    expect(view.boarded.get(s)?.get(0)).toBe(4);
    expect(view.landings.get(s)?.get(3)).toBeUndefined(); // nobody left waiting
  });

  it("lines waiters up beside the shaft instead of stacking them on the car", () => {
    const tower = baseTower();
    const s = placeShaft(tower, "elevatorStandard", 4, 1, 10); // hugs the left wall, so the line forms on its right
    const crowd = new Crowd();
    // Three waiters at one landing, and no car parked here, so none board and
    // they settle into their slots.
    for (let id = 1; id <= 3; id++) crowd.people.push(waiter(id, s, 3));
    for (let i = 0; i < 8; i++) crowd.advance(0.5, tower);

    expect(crowd.people.every((p) => p.state === "waiting")).toBe(true);
    const xs = crowd.people.map((p) => p.x);
    const carCenter = 4 + 4 / 2; // shaft.x + width / 2, the column the car occupies
    // Nobody stands on the car's column, and the three occupy distinct spots.
    for (const x of xs) expect(Math.abs(x - carCenter)).toBeGreaterThan(1);
    expect(new Set(xs.map((x) => Math.round(x * 100))).size).toBe(3);
    // FIFO order: the first waiter stands nearest the doors, each next one further out.
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
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
