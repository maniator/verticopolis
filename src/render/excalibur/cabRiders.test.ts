import { describe, expect, it } from "vitest";
import { CAST, castIndex } from "../pixelSprites/people";
import { cabLoad, cabRidersOf, countCabRiders, loadFigures, riderFigure, ridersAboard, type RiderLook } from "./cabRiders";
import { personFigure } from "./crowdFigure";
import { figureKey, figureOf, newGlide, newStepClock, waitMood } from "./crowdLook";

/** Classic's figures: flat, fed up past 100 minutes. */
const FLAT: RiderLook = { fedUpWait: 100, lit: false };

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
    const out = countCabRiders(people, [a, b], new Map(), FLAT);
    expect(ridersAboard(out, 1, 0)).toBe(2);
    expect(ridersAboard(out, 1, 1)).toBe(1);
    expect(ridersAboard(out, 2, 0)).toBe(1);
    expect(ridersAboard(out, 3, 0)).toBe(0);
  });

  it("tells apart two shafts stacked in one column by their spans", () => {
    const low = shaft(1, 10, -5, 15, [10]);
    const high = shaft(2, 10, 15, 30, [20]);
    const out = countCabRiders([person(1, "riding", 12, 10), person(2, "riding", 12, 22)], [low, high], new Map(), FLAT);
    expect(ridersAboard(out, 1, 0)).toBe(1);
    expect(ridersAboard(out, 2, 0)).toBe(1);
  });

  it("gives a rider on the floor two stacked shafts share to the shaft whose car is there", () => {
    const low = shaft(1, 10, 1, 15, [4]);
    const high = shaft(2, 10, 15, 30, [15]);
    const out = countCabRiders([person(1, "riding", 12, 15)], [low, high], new Map(), FLAT);
    expect(ridersAboard(out, 1, 0)).toBe(0);
    expect(ridersAboard(out, 2, 0)).toBe(1);
  });

  it("forgets a shaft that left a column", () => {
    const a = shaft(1, 10, 1, 30, [3]);
    countCabRiders([person(1, "riding", 12, 3)], [a], new Map(), FLAT);
    const out = countCabRiders([person(1, "riding", 12, 3)], [], new Map(), FLAT);
    expect(ridersAboard(out, 1, 0)).toBe(0);
  });

  it("drops the cars of a shaft that was torn down from the counts it reuses", () => {
    const a = shaft(1, 10, 1, 30, [3]);
    const b = shaft(2, 30, 1, 30, [3]);
    const out = countCabRiders([person(1, "riding", 12, 3)], [a, b], new Map(), FLAT);
    expect([...out.keys()].sort()).toEqual([1, 2]);
    countCabRiders([], [b], out, FLAT);
    expect([...out.keys()]).toEqual([2]);
  });

  it("starts every recount from zero", () => {
    const a = shaft(1, 10, 1, 30, [3]);
    const out = countCabRiders([person(1, "riding", 12, 3)], [a], new Map(), FLAT);
    expect(ridersAboard(out, 1, 0)).toBe(1);
    countCabRiders([], [a], out, FLAT);
    expect(ridersAboard(out, 1, 0)).toBe(0);
  });
});

describe("cabRidersOf", () => {
  it("recounts on a sim step or a new crowd, and reuses the counts between", () => {
    const a = shaft(1, 10, 1, 30, [3]);
    const people: any[] = [person(1, "riding", 12, 3)];
    const engine = { sim: { crowd: { people }, tower: { transports: [a] } } };
    expect(ridersAboard(cabRidersOf(engine, false, FLAT), 1, 0)).toBe(1);
    people.push(person(2, "riding", 12, 3)); // the same array, mid-step
    expect(ridersAboard(cabRidersOf(engine, false, FLAT), 1, 0)).toBe(1);
    expect(ridersAboard(cabRidersOf(engine, true, FLAT), 1, 0)).toBe(2);
    engine.sim.crowd = { people: [] }; // a new crowd (a load) counts at once
    expect(ridersAboard(cabRidersOf(engine, false, FLAT), 1, 0)).toBe(0);
  });
});

describe("each rider rides as themselves", () => {
  // The bug: the cab drew its own made-up faces from the car's seed, so a
  // person who walked into an elevator came out of it looking like someone
  // else. A rider's figure is the crowd's own look for them now.
  function onFoot(p: any, look: RiderLook) {
    const clock = newStepClock(0);
    return figureOf(personFigure({ ...p, state: "walking" }, newGlide(p.x, p.fy, false), { lit: look.lit, fedUpWait: look.fedUpWait, progress: 1, clock }));
  }

  it("stands each rider up in the look, mood and shading they walk in with", () => {
    const a = shaft(1, 10, 1, 30, [3]);
    const people = [person(5, "riding", 12, 3), person(8, "riding", 12, 3), { ...person(9, "riding", 12, 3), wait: 150 }];
    for (const look of [FLAT, { fedUpWait: 100, lit: true }]) {
      const figures = loadFigures(cabLoad(countCabRiders(people, [a], new Map(), look), 1, 0)).map(figureOf);
      expect(figures).toHaveLength(3);
      people.forEach((p, i) => {
        const walking = onFoot(p, look);
        expect(figures[i].look).toBe(castIndex(p.seed));
        expect(figures[i].look).toBe(walking.look);
        expect(figures[i].mood).toBe(walking.mood);
        expect(figures[i].lit).toBe(look.lit);
      });
    }
    // Two different people really do look different, so the check has teeth.
    expect(castIndex(5)).not.toBe(castIndex(8));
    expect(figureOfMood(people[2])).toBe("fedUp");
  });

  function figureOfMood(p: any) {
    return figureOf(loadFigures(cabLoad(countCabRiders([p], [shaft(1, 10, 1, 30, [3])], new Map(), FLAT), 1, 0))[0]).mood;
  }

  it("gives every look, mood and shading the crowd's own standing figure", () => {
    for (const seed of [...CAST.keys(), -7, 2 ** 31 - 1]) {
      for (const wait of [0, 59.9, 60, 60.1, 99, 100, 100.5, 150]) {
        for (const lit of [false, true]) {
          const p = { ...person(1, "riding", 12, 3), seed, wait };
          expect(riderFigure(p, { fedUpWait: 100, lit })).toBe(figureKey(castIndex(seed), "stand", 1, waitMood(wait, 100), false, lit));
        }
      }
    }
  });

  it("keeps a car's cast while the same people ride and renames it when they change", () => {
    const a = shaft(1, 10, 1, 30, [3]);
    const out = countCabRiders([person(5, "riding", 12, 3)], [a], new Map(), FLAT);
    const first = cabLoad(out, 1, 0).cast;
    expect(first).not.toBe("");
    countCabRiders([person(5, "riding", 12, 3)], [a], out, FLAT);
    expect(cabLoad(out, 1, 0).cast).toBe(first);
    countCabRiders([person(5, "riding", 12, 3), person(8, "riding", 12, 3)], [a], out, FLAT);
    const second = cabLoad(out, 1, 0).cast;
    expect(second).not.toBe(first);
    countCabRiders([person(8, "riding", 12, 3), person(5, "riding", 12, 3)], [a], out, FLAT);
    expect(cabLoad(out, 1, 0).cast).not.toBe(second); // the same two, standing the other way round
    // Fewer riders than last time leave nobody stale behind them.
    countCabRiders([person(8, "riding", 12, 3)], [a], out, FLAT);
    countCabRiders([person(8, "riding", 12, 3)], [a], out, FLAT);
    expect(loadFigures(cabLoad(out, 1, 0)).map((f) => figureOf(f).look)).toEqual([castIndex(8)]);
    expect(cabLoad(out, 1, 0).cast.split(",")).toHaveLength(1);
    countCabRiders([], [a], out, FLAT);
    expect(cabLoad(out, 1, 0).cast).toBe("");
  });
});
