import { describe, expect, it } from "vitest";
import { cabRidersOf, countCabRiders, ridersAboard } from "./cabRiders";

/** A shaft in the view's shape: `x` and `width` in tiles, one floor per car. */
function shaft(id: number, x: number, bottom: number, top: number, carPositions: number[]): any {
  return { id, kind: "elevatorStandard", x, width: 4, bottom, top, cars: carPositions.length, carPositions, carDir: carPositions.map(() => 0) };
}
function person(id: number, state: string, x: number, fy: number, staff = false): any {
  return { id, seed: id, state, x, floor: Math.round(fy), fy, wait: 0, ...(staff ? { staff } : {}) };
}

describe("countCabRiders", () => {
  it("counts each hidden rider in the car nearest their floor, in their own shaft", () => {
    const a = shaft(1, 10, 1, 30, [3, 20]);
    const b = shaft(2, 30, 1, 30, [3]);
    const people = [
      person(1, "riding", 12, 3), person(2, "riding", 12, 3.2), person(3, "riding", 12, 19.6),
      person(4, "riding", 32, 3),
      person(5, "waiting", 12, 3), // on the landing, not in a cab
      person(6, "riding", 12, 3, true), // staff ride visibly, so the cab does not draw them too
      person(7, "riding", 50, 3), // no shaft has its middle here
    ];
    const out = countCabRiders(people, [a, b], new Map());
    expect(ridersAboard(out, 1, 0)).toBe(2);
    expect(ridersAboard(out, 1, 1)).toBe(1);
    expect(ridersAboard(out, 2, 0)).toBe(1);
    expect(ridersAboard(out, 3, 0)).toBe(0);
  });

  it("tells apart two shafts stacked in one column by their spans", () => {
    const low = shaft(1, 10, -5, 15, [10]);
    const high = shaft(2, 10, 15, 30, [20]);
    const out = countCabRiders([person(1, "riding", 12, 10), person(2, "riding", 12, 22)], [low, high], new Map());
    expect(ridersAboard(out, 1, 0)).toBe(1);
    expect(ridersAboard(out, 2, 0)).toBe(1);
  });

  it("gives a rider on the floor two stacked shafts share to the shaft whose car is there", () => {
    const low = shaft(1, 10, 1, 15, [4]);
    const high = shaft(2, 10, 15, 30, [15]);
    const out = countCabRiders([person(1, "riding", 12, 15)], [low, high], new Map());
    expect(ridersAboard(out, 1, 0)).toBe(0);
    expect(ridersAboard(out, 2, 0)).toBe(1);
  });

  it("forgets a shaft that left a column", () => {
    const a = shaft(1, 10, 1, 30, [3]);
    countCabRiders([person(1, "riding", 12, 3)], [a], new Map());
    const out = countCabRiders([person(1, "riding", 12, 3)], [], new Map());
    expect(ridersAboard(out, 1, 0)).toBe(0);
  });

  it("starts every recount from zero", () => {
    const a = shaft(1, 10, 1, 30, [3]);
    const out = countCabRiders([person(1, "riding", 12, 3)], [a], new Map());
    expect(ridersAboard(out, 1, 0)).toBe(1);
    countCabRiders([], [a], out);
    expect(ridersAboard(out, 1, 0)).toBe(0);
  });
});

describe("cabRidersOf", () => {
  it("recounts on a sim step or a new crowd, and reuses the counts between", () => {
    const a = shaft(1, 10, 1, 30, [3]);
    const people: any[] = [person(1, "riding", 12, 3)];
    const engine = { sim: { crowd: { people }, tower: { transports: [a] } } };
    expect(ridersAboard(cabRidersOf(engine, false), 1, 0)).toBe(1);
    people.push(person(2, "riding", 12, 3)); // the same array, mid-step
    expect(ridersAboard(cabRidersOf(engine, false), 1, 0)).toBe(1);
    expect(ridersAboard(cabRidersOf(engine, true), 1, 0)).toBe(2);
    engine.sim.crowd = { people: [] }; // a new crowd (a load) counts at once
    expect(ridersAboard(cabRidersOf(engine, false), 1, 0)).toBe(0);
  });
});
