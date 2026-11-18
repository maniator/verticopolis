import { describe, expect, it } from "vitest";
import { SimCostTally } from "./analyticsSimCost";

describe("SimCostTally", () => {
  it("charges each step's time to the game minutes it moved the clock", () => {
    const t = new SimCostTally();
    t.note(1, 600, 15, 100); // anchor: counts no time
    t.note(2, 615, 15, 100);
    t.note(4, 645, 15, 120);
    expect(t.gameHours).toBeCloseTo(0.75);
    expect(t.msPerGameHour).toBeCloseTo((6 * 60) / 45);
    expect(t.peakPopulation).toBe(120);
  });

  it("leaves out a paused frame, a backward clock and a jump bigger than a frame can step", () => {
    const t = new SimCostTally();
    t.note(0, 600, 15, 0);
    t.note(5, 600, 0, 0); // paused: the clock stood still
    t.note(5, 30, 15, 0); // a loaded tower's clock: backward
    t.note(5, 900, 15, 0); // a jump of 870 minutes
    t.note(3, 915, 15, 0); // a real step of 15 minutes
    expect(t.gameHours).toBeCloseTo(0.25);
    expect(t.msPerGameHour).toBeCloseTo(12);
  });

  it("re-anchors after a hidden stretch instead of counting the gap", () => {
    const t = new SimCostTally();
    t.note(0, 600, 15, 0);
    t.note(2, 610, 15, 0);
    t.reanchor();
    t.note(9, 640, 15, 0); // first frame back: anchor only
    t.note(2, 650, 15, 0);
    expect(t.gameHours).toBeCloseTo(20 / 60);
    expect(t.msPerGameHour).toBeCloseTo(12);
  });

  it("names the speed most frames ran at, with or without the paused ones", () => {
    const t = new SimCostTally();
    for (let i = 0; i < 5; i++) t.note(0, 0, 0, 0);
    for (let i = 0; i < 3; i++) t.note(0, 0, 50, 0);
    t.note(0, 0, 15, 0);
    expect(t.mainSpeed(false)).toBe(0);
    expect(t.mainSpeed(true)).toBe(50);
    expect(new SimCostTally().mainSpeed(true)).toBe(0);
    expect(new SimCostTally().msPerGameHour).toBe(0);
  });
});
