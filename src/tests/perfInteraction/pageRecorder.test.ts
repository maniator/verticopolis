import { afterEach, describe, expect, it } from "vitest";
import { collectRecord, type PhaseWindow } from "./pageRecorder";

// `collectRecord` runs in the page; here it runs against a stubbed recorder,
// so the attribution of entries to phase windows is checked like the statistics.
const win = (name: string, start: number, end: number): PhaseWindow => ({ name, start, end, simMinutesStart: 100, simMinutesEnd: 160, minuteOfDayStart: 450 });

function stub(over: Record<string, unknown>): void {
  (window as any).__interaction = {
    windows: [win("idle", 1000, 2000), win("pan", 3000, 4000)],
    frames: [],
    longTasks: [],
    loafs: [],
    events: [],
    inputs: [],
    calls: [],
    observers: [],
    loafSupported: true,
    frameErrors: 0,
    ...over,
  };
}

afterEach(() => {
  delete (window as any).__interaction;
});

describe("collecting the page's record", () => {
  it("gives each entry to the window holding its start, and drops entries between windows", () => {
    stub({
      frames: [[999, 16], [1000, 17], [1999, 18], [2000, 19], [2500, 20], [3500, 21]],
      longTasks: [[1500, 60], [2500, 90]],
      inputs: [[3999, 5], [4000, 7]],
      calls: [[1200, "view decode", 3], [1300, "view decode", 5], [2600, "view decode", 50]],
    });
    const r = collectRecord();
    expect(r.phases.idle.frames).toEqual([17, 18]);
    expect(r.phases.pan.frames).toEqual([21]);
    expect(r.phases.idle.longTasks).toEqual([60]);
    expect(r.phases.pan.inputToFrame).toEqual([5]);
    expect(r.phases.idle.parts["view decode"]).toEqual({ n: 2, ms: 8, max: 5 });
    expect(r.phases.pan.parts["view decode"]).toBeUndefined();
    expect(r.phases.idle).toMatchObject({ simMinutes: 60, windowMs: 1000, minuteOfDayStart: 450 });
  });

  it("keeps one slow entry per interaction, the longest with the largest delay, and leaves out entries with no interaction", () => {
    stub({
      events: [
        [1100, "pointerdown", 30, 20, 10, 7],
        [1105, "mousedown", 30, 4, 10, 7],
        [1110, "click", 48, 2, 12, 7],
        [1500, "keydown", 24, 2, 8, 9],
        [1600, "pointerover", 40, 0, 30, 0],
      ],
    });
    const events = collectRecord().phases.idle.events;
    expect(events).toHaveLength(2);
    expect(events).toContainEqual({ name: "click", dur: 48, delay: 20, proc: 12 });
    expect(events).toContainEqual({ name: "keydown", dur: 24, delay: 2, proc: 8 });
  });

  it("gives an interaction to the window of its first entry", () => {
    stub({ events: [[1999, "pointerdown", 20, 1, 5, 3], [3000, "click", 60, 30, 9, 3]] });
    const r = collectRecord();
    expect(r.phases.idle.events).toEqual([{ name: "click", dur: 60, delay: 30, proc: 9 }]);
    expect(r.phases.pan.events).toEqual([]);
  });

  it("takes pending observer entries first, and reports the run's frame error count", () => {
    const pending = [{ startTime: 3200, duration: 70 }];
    stub({ frameErrors: 2 });
    const rec = (window as any).__interaction;
    rec.observers = [[{ takeRecords: () => pending }, (e: any) => rec.longTasks.push([e.startTime, e.duration])]];
    const r = collectRecord();
    expect(r.phases.pan.longTasks).toEqual([70]);
    expect(r.frameErrors).toBe(2);
  });
});
