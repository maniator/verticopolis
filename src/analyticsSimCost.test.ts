import { describe, expect, it } from "vitest";
import { SimCostTally } from "./analyticsSimCost";

const TOWER = 7;

describe("SimCostTally", () => {
  it("charges each step's time to the game minutes it moved the clock", () => {
    const t = new SimCostTally();
    t.note(1, 600, 15, 100, TOWER); // anchor: counts no time
    t.note(2, 615, 15, 100, TOWER);
    t.note(4, 645, 15, 120, TOWER);
    expect(t.summary()).toEqual({ msPerGameHour: (6 * 60) / 45, gameHours: 0.75, population: 120, speed: 15 });
    expect(t.peakPopulation).toBe(120);
  });

  it("leaves out a paused frame, a backward clock and a jump bigger than a frame can step", () => {
    const t = new SimCostTally();
    t.note(0, 600, 15, 0, TOWER);
    t.note(5, 600, 0, 0, TOWER); // paused: the clock stood still
    t.note(5, 30, 15, 0, TOWER); // the clock went backward
    t.note(5, 900, 15, 0, TOWER); // a jump of 870 minutes
    t.note(3, 915, 15, 0, TOWER); // a real step of 15 minutes
    expect(t.summary()).toMatchObject({ gameHours: 0.25, msPerGameHour: 12 });
  });

  it("re-anchors on a tower change, so another tower's clock moving forward or back is not a step", () => {
    const t = new SimCostTally();
    t.note(0, 600, 15, 0, TOWER);
    t.note(2, 615, 15, 0, TOWER); // 15 real minutes
    t.note(0, 660, 15, 0, TOWER + 1); // opened a tower 45 minutes ahead: anchor only
    t.note(1, 675, 15, 0, TOWER + 1); // 15 real minutes on it
    t.note(0, 500, 15, 0, TOWER + 2); // undo to an earlier clock: anchor only
    t.note(1, 515, 15, 0, TOWER + 2); // 15 real minutes
    expect(t.summary()).toMatchObject({ gameHours: 0.75, msPerGameHour: (4 * 60) / 45 });
  });

  it("re-anchors after a hidden stretch instead of counting the gap", () => {
    const t = new SimCostTally();
    t.note(0, 600, 15, 0, TOWER);
    t.note(2, 610, 15, 0, TOWER);
    t.reanchor();
    t.note(9, 640, 15, 0, TOWER); // first frame back: anchor only
    t.note(2, 650, 15, 0, TOWER);
    expect(t.summary()).toMatchObject({ gameHours: 20 / 60, msPerGameHour: 12 });
  });

  it("reports the tower size the most game time was stepped at, never blending a big tower into a small one's cost", () => {
    const t = new SimCostTally();
    let clock = 0;
    t.note(0, clock, 15, 200, TOWER);
    for (let i = 0; i < 8; i++) t.note(1, (clock += 15), 15, 200, TOWER); // 2 hours at 200 people, 4 ms an hour
    t.note(0, 0, 15, 12_000, TOWER + 1);
    for (let i = 0; i < 2; i++) t.note(50, 15 * (i + 1), 15, 12_000, TOWER + 1); // 30 minutes at 12,000 people
    expect(t.summary()).toEqual({ msPerGameHour: 4, gameHours: 2, population: 200, speed: 15 });
    expect(t.peakPopulation).toBe(12_000); // the fps label still names the biggest tower drawn
  });

  it("labels the fps with the population of running frames, never a big tower only seen paused", () => {
    const t = new SimCostTally();
    let clock = 0;
    t.note(0, clock, 15, 300, TOWER);
    for (let i = 0; i < 120; i++) t.note(1, (clock += 1), 15, 300, TOWER); // played at 300 people
    for (let i = 0; i < 120; i++) t.note(0, 0, 0, 12_000, TOWER + 1); // opened a big tower and left it paused
    expect(t.peakPopulation).toBe(300);
    expect(t.mainSpeed()).toBe(15);
  });

  it("names the speed by game time stepped for the cost, and by running frames for the fps", () => {
    const t = new SimCostTally();
    let clock = 0;
    t.note(0, clock, 3, 100, TOWER);
    for (let i = 0; i < 20; i++) t.note(1, (clock += 0.05), 3, 100, TOWER); // 20 frames, 1 game minute
    for (let i = 0; i < 4; i++) t.note(1, (clock += 15), 50, 100, TOWER); // 4 frames, 60 game minutes
    for (let i = 0; i < 30; i++) t.note(0, clock, 0, 100, TOWER); // paused: never a speed
    expect(t.summary()?.speed).toBe(50);
    expect(t.mainSpeed()).toBe(3);
    expect(new SimCostTally().mainSpeed()).toBe(0);
    expect(new SimCostTally().summary()).toBeNull();
  });
});
