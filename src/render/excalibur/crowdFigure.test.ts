import { describe, expect, it } from "vitest";
import type { PersonView, TransportView } from "../../simport/view";
import { personFigure, waitFacesLeft, waitShaftMid, type CrowdLook } from "./crowdFigure";
import { figureOf, newGlide, newStepClock } from "./crowdLook";

/**
 * Which way a person waiting for an elevator faces (#2097): toward the shaft
 * they wait at, whichever way they walked to their place in the line.
 */

const shaft = (x: number, over: Partial<TransportView> = {}): TransportView => ({
  id: x, kind: "elevatorStandard", x, width: 4, bottom: 0, top: 10, cars: 1, carPositions: [0], carDir: [0], ...over,
});
const waiter = (x: number, floor = 1): PersonView => ({ id: 1, seed: 5, state: "waiting", x, floor, fy: floor, wait: 0 });
const look: CrowdLook = { lit: false, fedUpWait: 60, progress: 1, clock: newStepClock(0) };

describe("waitShaftMid", () => {
  it("takes the shaft the person stands in when the wait starts, even with another one nearer the line", () => {
    // The express at 102 (middle 105) and a standard at 132 (middle 134).
    const shafts = [shaft(102, { kind: "elevatorExpress", width: 6 }), shaft(132)];
    expect(waitShaftMid(shafts, waiter(105))).toBe(105);
    expect(waitShaftMid(shafts, waiter(134))).toBe(134);
  });

  it("falls back to the nearest elevator that stops on the floor, and says so when there is none", () => {
    expect(waitShaftMid([shaft(10), shaft(30)], waiter(27))).toBe(32);
    expect(waitShaftMid([shaft(10, { bottom: 3 }), shaft(40)], waiter(15))).toBe(42);
    expect(waitShaftMid([shaft(10, { kind: "stairs" })], waiter(15))).toBeNull();
    expect(waitShaftMid([], waiter(15))).toBeNull();
  });
});

describe("waitFacesLeft", () => {
  it("faces the shaft from either side, and keeps the way they came while in it or with no shaft", () => {
    expect(waitFacesLeft(120, 105, false)).toBe(true);
    expect(waitFacesLeft(90, 105, true)).toBe(false);
    expect(waitFacesLeft(105, 105, true)).toBe(true);
    expect(waitFacesLeft(105, null, false)).toBe(false);
  });
});

describe("personFigure while waiting", () => {
  it("faces the shaft when standing in line, even after walking the other way to get there", () => {
    const g = newGlide(15, 1, false); // walked right, out of the shaft to the line
    expect(figureOf(personFigure(waiter(15), g, look, undefined, 12)).left).toBe(true);
    expect(figureOf(personFigure(waiter(15), newGlide(9, 1, true), look, undefined, 12)).left).toBe(false);
    // With no shaft to face, they keep the way they came.
    expect(figureOf(personFigure(waiter(15), g, look)).left).toBe(false);
  });
});
