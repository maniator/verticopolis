import { describe, expect, it } from "vitest";
import { RUN_FOOT_PX, RUN_HEAD_PX, climbDrawX, climbFlight, climbSpot, leaveFlight, type Climber } from "./climbPath";
import { FLOOR, TILE } from "./scale";
import { spiralRadius } from "./sprites/spiralStair";
import type { TransportView } from "../simport/view";

const flight = (kind: "stairs" | "escalator", bottom: number, top: number): TransportView => ({
  id: 1, kind, x: 100, width: 8, bottom, top, cars: 0, carPositions: [], carDir: [],
});
const FOOT = 100 + RUN_FOOT_PX / TILE;
const HEAD = 108 - RUN_HEAD_PX / TILE;

describe("a climber's place on a flight", () => {
  it("climbs along the run from its lower landing to its upper one, not up the middle", () => {
    const t = flight("escalator", 4, 5);
    expect(climbSpot(t, 4).x).toBeCloseTo(FOOT, 9);
    expect(climbSpot(t, 4.5).x).toBeCloseTo((FOOT + HEAD) / 2, 9);
    expect(climbSpot(t, 5).x).toBeCloseTo(HEAD, 9);
    // Each step up moves them sideways too: a slope, never straight up.
    expect(climbSpot(t, 4.25).x).toBeLessThan(climbSpot(t, 4.75).x);
  });

  it("turns back each story on a tall lobby's escalator switchback", () => {
    const t = flight("escalator", 1, 4);
    expect(climbSpot(t, 1.5)).toMatchObject({ rightward: true });
    expect(climbSpot(t, 2.25)).toMatchObject({ rightward: false });
    expect(climbSpot(t, 2.25).x).toBeCloseTo(HEAD - (HEAD - FOOT) * 0.25, 9);
    expect(climbSpot(t, 3.5)).toMatchObject({ rightward: true });
    // The top of the last run is its upper landing, never past it.
    expect(climbSpot(t, 4).x).toBeCloseTo(climbSpot(t, 3.999999).x, 4);
  });

  it("winds around the newel pole on a tall lobby's spiral stair", () => {
    const t = flight("stairs", 1, 4);
    const mid = 100 + 8 / 2;
    const r = spiralRadius(8 * TILE) / TILE;
    // The foot is at the front left, as the spiral is drawn.
    expect(climbSpot(t, 1).x).toBeCloseTo(mid - r, 9);
    // A quarter turn up it passes the pole on the near side...
    expect(climbSpot(t, 1 + 3 / 14).x).toBeCloseTo(mid, 9);
    // ...and a half turn up it is at the far right.
    expect(climbSpot(t, 1 + 3 / 7).x).toBeCloseTo(mid + r, 9);
    // The last half turn brings it to the landing on the right.
    expect(climbSpot(t, 4).x).toBeCloseTo(mid + r, 9);
    // Every point stays on the helix, never out past it.
    for (let fy = 1; fy <= 4; fy += 0.05) expect(Math.abs(climbSpot(t, fy).x - mid)).toBeLessThanOrEqual(r + 1e-9);
    // A one-story stair keeps its straight run.
    expect(climbSpot(flight("stairs", 4, 5), 4).x).toBeCloseTo(FOOT, 9);
  });

  it("finds the flight a climber stands in the middle of, and nothing else", () => {
    const stairs = flight("stairs", 4, 5);
    const lift: TransportView = { ...flight("stairs", 4, 5), id: 2, kind: "elevatorStandard" };
    expect(climbFlight([lift, stairs], 104, 4)).toBe(stairs);
    expect(climbFlight([stairs], 104, 7)).toBeUndefined();
    expect(climbFlight([stairs], 103, 4)).toBeUndefined();
  });

  it("faces the way the climber goes along the run, up or down", () => {
    const t = flight("escalator", 4, 5);
    const up: Climber = {};
    expect(climbDrawX(up, [t], 104, 4, 4.5, false)).toBeCloseTo((FOOT + HEAD) / 2, 9);
    expect(up.climbLeft).toBe(false);
    const down: Climber = {};
    climbDrawX(down, [t], 104, 5, 4.5, true);
    expect(down.climbLeft).toBe(true);
    // The drawn point matches the run the sprite draws.
    expect(climbDrawX(up, [t], 104, 4, 4.25, false)).toBeCloseTo(climbSpot(t, 4.25).x, 9);
  });

  it("starts the walk off the flight from the landing it reached", () => {
    const t = flight("stairs", 4, 5);
    const c: Climber = {};
    climbDrawX(c, [t], 104, 4, 5, false);
    expect(leaveFlight(c)).toBeCloseTo(HEAD, 9);
    expect(leaveFlight(c)).toBeUndefined();
    expect(c.flight).toBeUndefined();
  });

  // Beside a venue in Modern (venueFlights.ts) a one-story flight winds.
  it("winds once and a half around the pole on a one-story spiral beside a venue", () => {
    const t = flight("stairs", 4, 5);
    const mid = 100 + 8 / 2;
    const r = spiralRadius(8 * TILE) / TILE;
    expect(climbSpot(t, 4, true).x).toBeCloseTo(mid - r, 9);
    // A third of the way up is half a turn round, at the far right.
    expect(climbSpot(t, 4 + 1 / 3, true).x).toBeCloseTo(mid + r, 9);
    // The last half turn lands it on the right, as the sprite draws.
    expect(climbSpot(t, 5, true).x).toBeCloseTo(mid + r, 9);
    for (let fy = 4; fy <= 5; fy += 0.05) expect(Math.abs(climbSpot(t, fy, true).x - mid)).toBeLessThanOrEqual(r + 1e-9);
  });

  it("turns back at the landing halfway up a one-story escalator beside a venue", () => {
    const t = flight("escalator", 4, 5);
    const turn = 4 + 23 / FLOOR; // the lower run climbs 23 of the story's 45 pixels
    expect(climbSpot(t, 4, true)).toMatchObject({ x: FOOT, rightward: true });
    expect(climbSpot(t, turn, true).x).toBeCloseTo(HEAD, 9);
    expect(climbSpot(t, (turn + 5) / 2, true)).toMatchObject({ rightward: false });
    expect(climbSpot(t, (turn + 5) / 2, true).x).toBeCloseTo((FOOT + HEAD) / 2, 9);
    // It arrives at the left of the deck above, where the upper run ends.
    expect(climbSpot(t, 5, true).x).toBeCloseTo(FOOT, 9);
    // The same flight not beside a venue keeps its straight run.
    expect(climbSpot(t, 5).x).toBeCloseTo(HEAD, 9);
  });

  it("reads whether the flight winds once, when the climb begins", () => {
    const t = flight("escalator", 4, 5);
    const c: Climber = {};
    expect(climbDrawX(c, [t], 104, 4, 5, false, new Set([1]))).toBeCloseTo(FOOT, 9);
    expect(c.flightWinds).toBe(true);
    // A venue bulldozed mid-climb does not jump the climber to the other run.
    expect(climbDrawX(c, [t], 104, 4, 5, false, new Set())).toBeCloseTo(FOOT, 9);
    leaveFlight(c);
    expect(c.flightWinds).toBeUndefined();
    expect(climbDrawX(c, [t], 104, 4, 5, false, new Set())).toBeCloseTo(HEAD, 9);
    // Without the set (no venues gathered yet) a flight draws straight.
    const plain: Climber = {};
    expect(climbDrawX(plain, [t], 104, 4, 5, false)).toBeCloseTo(HEAD, 9);
  });

  it("draws a climber with no matching flight where the engine puts them", () => {
    const c: Climber = {};
    expect(climbDrawX(c, [], 104, 4, 4.5, false)).toBeUndefined();
  });
});
