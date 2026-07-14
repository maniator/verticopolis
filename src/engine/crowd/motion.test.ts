import { describe, it, expect } from "vitest";
import { Tower } from "../Tower";
import { Crowd } from "../Crowd";
import type { Person } from "./person";
import type { FacilityKind } from "../types";

/**
 * Crowd motion placement: the elevator-landing queue. Waiting riders fan into a
 * line beside the shaft (on the side with the longer contiguous run of built
 * floor, clamped to that run) instead of stacking on the car's column; riders
 * still walking in (`toShaft`) head to the shaft face and only fan out once they
 * become `waiting`. Boarding is position-independent, so these pin the visual
 * placement, not the boarding math (that lives in queueView.test.ts, driven
 * through the same advance()).
 */
describe("Crowd landing queue: waiters line up beside the shaft", () => {
  /** A tower with a ground lobby and plain floors 2..top across tiles 0..39. */
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

  function placeShaft(tower: Tower, x: number, bottom: number, top: number): number {
    const res = tower.placeTransport("elevatorStandard", x, bottom, top);
    if (!res.ok || res.transportId == null) throw new Error(`placeTransport failed: ${res.reason}`);
    return res.transportId;
  }

  /** A person parked in the `waiting` state at a shaft landing on `floor`, having
   *  already waited `wait` seconds (so arrival order can be staged). */
  function waiter(id: number, shaftId: number, floor: number, wait = 0): Person {
    return {
      id,
      seed: id,
      state: "waiting",
      floor,
      fy: floor,
      x: 20,
      floors: [floor, floor + 1],
      shafts: [shaftId],
      leg: 0,
      shaftId,
      carIndex: null,
      destX: 20,
      wait,
      age: 0,
      linger: 0,
    };
  }

  /** The tile column the car occupies, derived from the placed shaft so the
   *  fixture survives a change to elevator geometry. */
  function carColumn(tower: Tower, shaftId: number): number {
    const shaft = tower.getTransport(shaftId)!;
    return shaft.x + shaft.width / 2;
  }

  /** Settle three equal-wait waiters (no car parked at their floor, so none
   *  board). With equal waits, the id tie-break orders them (id 1 at the front). */
  function settle(shaftX: number): { xs: number[]; carCenter: number } {
    const tower = baseTower();
    const s = placeShaft(tower, shaftX, 1, 10);
    const crowd = new Crowd();
    for (let id = 1; id <= 3; id++) crowd.people.push(waiter(id, s, 3));
    for (let i = 0; i < 8; i++) crowd.advance(0.5, tower);
    expect(crowd.people.every((p) => p.state === "waiting")).toBe(true);
    return { xs: crowd.people.map((p) => p.x), carCenter: carColumn(tower, s) };
  }

  it("forms the line to the RIGHT of a shaft at the floor's left end", () => {
    const { xs, carCenter } = settle(4); // more floor to the right, so the line runs right
    for (const x of xs) expect(Math.abs(x - carCenter)).toBeGreaterThan(1); // off the car column
    expect(new Set(xs.map((x) => Math.round(x * 100))).size).toBe(3); // distinct spots
    // Equal waits, so the id tie-break stands id 1 at the front (nearest doors).
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it("forms the line to the LEFT of a shaft at the floor's right end", () => {
    const { xs, carCenter } = settle(34); // more floor to the left, so the line runs left
    for (const x of xs) expect(Math.abs(x - carCenter)).toBeGreaterThan(1);
    expect(new Set(xs.map((x) => Math.round(x * 100))).size).toBe(3);
    // Equal waits: id 1 at the front, and the line extends left (decreasing x).
    expect(xs[0]).toBeGreaterThan(xs[1]);
    expect(xs[1]).toBeGreaterThan(xs[2]);
  });

  it("stands the longest-waiting rider at the front, ahead of fresher arrivals", () => {
    const tower = baseTower();
    const s = placeShaft(tower, 4, 1, 10); // queues right, so the front is the smallest x
    const crowd = new Crowd();
    // Distinct waits that do NOT match id order: id 2 has waited longest, id 1
    // the least, so ordering by wait (not id) is what the assertion pins.
    crowd.people.push(waiter(1, s, 3, 1), waiter(2, s, 3, 9), waiter(3, s, 3, 5));
    for (let i = 0; i < 8; i++) crowd.advance(0.5, tower);
    const x = new Map(crowd.people.map((p) => [p.id, p.x]));
    // Front (nearest the doors) is the longest-waiting rider, then next, then the
    // freshest, regardless of id.
    expect(x.get(2)!).toBeLessThan(x.get(3)!);
    expect(x.get(3)!).toBeLessThan(x.get(1)!);
  });

  it("keeps a long line on the built floor instead of trailing off the edge", () => {
    // A narrow landing floor (tiles 30..39) with the shaft at its right end, so
    // the leftward line has to clamp before it runs off the built structure.
    const tower = new Tower();
    const must = (kind: FacilityKind, f: number, x: number) => {
      const r = tower.place(kind, f, x);
      if (!r.ok) throw new Error(`fixture place ${kind} @ floor ${f}, x ${x} failed`);
    };
    for (let x = 0; x < 40; x++) must("lobby", 1, x);
    for (let x = 0; x < 40; x++) must("floor", 2, x);
    for (let x = 30; x < 40; x++) must("floor", 3, x); // narrow floor 3
    const s = placeShaft(tower, 36, 1, 3);
    const crowd = new Crowd();
    // More waiters than fit before the wall, so the clamp has to bite.
    for (let id = 1; id <= 20; id++) crowd.people.push(waiter(id, s, 3));
    for (let i = 0; i < 20; i++) crowd.advance(0.5, tower);
    for (const p of crowd.people) {
      expect(p.x).toBeGreaterThanOrEqual(30); // never left of the narrow floor
      expect(p.x).toBeLessThanOrEqual(39); // never right of it
    }
    // The clamp actually engaged: the tail reaches the left wall.
    expect(crowd.people.some((p) => p.x <= 30.5)).toBe(true);
  });

  it("compresses a jammed landing into a distributed line, not a wall stack", () => {
    // Narrow landing floor (tiles 30..39) with the shaft at its right end and
    // far more waiters than fit at the natural spacing, so the line must
    // compress. They should still hold distinct spots across the built floor
    // rather than piling the overflow onto a single wall tile.
    const tower = new Tower();
    const must = (kind: FacilityKind, f: number, x: number) => {
      const r = tower.place(kind, f, x);
      if (!r.ok) throw new Error(`fixture place ${kind} @ floor ${f}, x ${x} failed`);
    };
    for (let x = 0; x < 40; x++) must("lobby", 1, x);
    for (let x = 0; x < 40; x++) must("floor", 2, x);
    for (let x = 30; x < 40; x++) must("floor", 3, x);
    const s = placeShaft(tower, 36, 1, 3);
    const crowd = new Crowd();
    for (let id = 1; id <= 20; id++) crowd.people.push(waiter(id, s, 3));
    for (let i = 0; i < 20; i++) crowd.advance(0.5, tower);
    const xs = crowd.people.map((p) => p.x);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(30);
      expect(x).toBeLessThanOrEqual(39);
    }
    // Distributed, not stacked: nearly every waiter holds its own spot instead
    // of overlapping on the clamp tile.
    const distinct = new Set(xs.map((x) => Math.round(x * 10))).size;
    expect(distinct).toBeGreaterThanOrEqual(18);
  });
});
