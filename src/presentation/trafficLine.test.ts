import { describe, it, expect } from "vitest";
import { LINE_WAIT, linePressure, nextTrafficTier, TRAFFIC_BOUNDS, TRAFFIC_HOLD, trafficTier, worstLine, type LandingLines, type LineWaitTier } from "./traffic";

/**
 * The readout's line rules (owner, 2026-11-17): how much a waiting line
 * presses, which tier a pressure reads as, how the shown tier holds near an
 * edge, and which line of a queue projection is the worst.
 */

/** A projection from `[shaft, floor, count, tier]` rows, in listed order. */
function lines(...rows: [number, number, number, LineWaitTier][]): LandingLines {
  const m = new Map<number, Map<number, { count: number; tier: LineWaitTier }>>();
  for (const [shaft, floor, count, tier] of rows) {
    if (!m.has(shaft)) m.set(shaft, new Map());
    m.get(shaft)!.set(floor, { count, tier });
  }
  return m;
}

describe("linePressure", () => {
  it("counts content riders as a twentieth, impatient ones as a quarter and fed-up ones whole", () => {
    const tiers = [LINE_WAIT.content, LINE_WAIT.impatient, LINE_WAIT.fedUp];
    expect(tiers.map((tier) => linePressure({ count: 40, tier }))).toEqual([2, 10, 40]);
  });

  it("reads a huge line that has only just formed, and climbs as its front grows impatient", () => {
    // 300 people who have just walked up: Busy at once, not Smooth.
    const fresh = [LINE_WAIT.content, LINE_WAIT.impatient, LINE_WAIT.fedUp].map((tier) => trafficTier(linePressure({ count: 300, tier })));
    expect(fresh).toEqual([1, 2, 3]);
    // A car's worth that has just walked up is a car about to come: Smooth.
    expect(trafficTier(linePressure({ count: 21, tier: LINE_WAIT.content }))).toBe(0);
  });
});

describe("trafficTier", () => {
  it("reads each lower edge as its own tier and just under it as the one below", () => {
    expect(TRAFFIC_BOUNDS.map(trafficTier)).toEqual([1, 2, 3]);
    expect(TRAFFIC_BOUNDS.map((b) => trafficTier(b - 0.25))).toEqual([0, 1, 2]);
    expect(trafficTier(0)).toBe(0);
  });
});

describe("nextTrafficTier", () => {
  it("goes up at once, to the tier the pressure reads", () => {
    expect(nextTrafficTier(0, 80)).toBe(3);
    expect(nextTrafficTier(1, 20)).toBe(2);
  });

  it("holds the shown tier until the pressure is below its hold share of the edge", () => {
    const edge = TRAFFIC_BOUNDS[1]; // Backed up's lower edge
    expect(nextTrafficTier(2, edge * TRAFFIC_HOLD)).toBe(2);
    expect(nextTrafficTier(2, edge * TRAFFIC_HOLD - 0.25)).toBe(1);
    // Falls straight to Smooth when the line is gone.
    expect(nextTrafficTier(3, 0)).toBe(0);
  });
});

describe("worstLine", () => {
  it("picks the line with the most pressure, wherever it is listed", () => {
    // 288 fed-up riders at B4 beat 30 impatient ones at 25F (7.5).
    const worst = worstLine(lines([1139, 25, 30, 1], [7648, -4, 288, 2], [9280, 60, 6, 2]));
    expect(worst).toEqual({ shaft: 7648, floor: -4, count: 288, tier: 2 });
  });

  it("breaks a tie on more people, then the lower floor, then the first listed", () => {
    // 20 fed up and 80 impatient press the same: the longer line wins.
    expect(worstLine(lines([1, 30, 20, 2], [2, 40, 80, 1]))?.shaft).toBe(2);
    expect(worstLine(lines([1, 30, 20, 2], [2, 12, 20, 2]))?.floor).toBe(12);
    expect(worstLine(lines([1, 12, 20, 2], [2, 12, 20, 2]))?.shaft).toBe(1);
  });

  it("weighs a fresh crowd against a short impatient line, and names none when nobody waits", () => {
    // 300 just arrived (15) outweigh 40 impatient (10).
    expect(worstLine(lines([1, 1, 300, 0], [2, 9, 40, 1]))?.shaft).toBe(1);
    expect(worstLine(lines())).toBeNull();
  });
});
