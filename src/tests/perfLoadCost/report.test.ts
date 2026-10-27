import { describe, expect, it } from "vitest";
import { conditionTable, decisionLine, reportMarkdown, type Row } from "./report";
import type { Arm } from "./report";
import type { Condition, LoadSample } from "./sample";

const sample = (readyMs: number, steps = 5): LoadSample => ({ readyMs, wasmFetchMs: 20, stepsMs: [steps, steps * 3, steps * 20], longTasks: 2, longestTaskMs: 80, controlled: true });
const rows = (n: number, before: (i: number) => number, after: (i: number) => number, condition: Condition = "L2", throttle = 1): Row[] => {
  const out: Row[] = [];
  for (let rep = 1; rep <= n; rep++) {
    out.push({ arm: "before" as Arm, condition, throttle, rep, sample: sample(before(rep)) });
    out.push({ arm: "after" as Arm, condition, throttle, rep, sample: sample(after(rep)) });
  }
  return out;
};

describe("conditionTable", () => {
  it("pairs the arms by repetition and reports the median difference", () => {
    const t = conditionTable(rows(10, (i) => 300 + i, (i) => 340 + i), "L2", 1).join("\n");
    expect(t).toContain("### L2, repeat boot from the precache, 1x CPU");
    expect(t).toMatch(/\| engine ready \(ms\) \| 305\.5 \| 345\.5 \| 40\.0 \(40\.0 to 40\.0\) \| 10 \|/);
  });

  it("leaves a metric blank when an arm has no values for it", () => {
    const r = rows(10, () => 300, () => 300);
    for (const x of r) x.sample.wasmFetchMs = null;
    expect(conditionTable(r, "L2", 1).join("\n")).toMatch(/\| wasm fetch \(resource timing\) \(ms\) \| - \| - \| - \| 0 \|/);
  });
});

describe("decisionLine", () => {
  it("names the branch by the engine-ready difference and the throttle", () => {
    expect(decisionLine(rows(10, () => 300, () => 420), 1)).toContain("at or above 100 ms: bring the two mitigations to the owner");
    expect(decisionLine(rows(10, () => 300, () => 330), 1)).toContain("under 100 ms: compare it with the calibrated noise floor");
    expect(decisionLine(rows(10, () => 900, () => 1200, "L2", 4), 4)).toContain("under 400 ms");
    expect(decisionLine(rows(10, () => 900, () => 1400, "L2", 4), 4)).toContain("at or above 400 ms");
  });

  it("says when there are too few pairs", () => {
    expect(decisionLine([], 1)).toContain("no paired difference");
  });
});

describe("reportMarkdown", () => {
  const header = { window: "2026-10-27 to 2026-10-28", before: "dist-a", after: "dist-b", machine: "pc", reps: 10, command: "node scripts/perf-load-cost.ts" };

  it("states the window before any figure, and lists refused runs", () => {
    const md = reportMarkdown(rows(10, () => 300, () => 310), [{ arm: "after", condition: "L2", throttle: 1, rep: 3, error: "not controlled" }], header, [1], ["L2"]);
    expect(md.indexOf("Window: 2026-10-27 to 2026-10-28")).toBeLessThan(md.indexOf("### L2"));
    expect(md).toContain("- after L2 1x rep 3: not controlled");
  });

  it("says none when nothing was refused", () => {
    expect(reportMarkdown([], [], header, [1], ["L2"])).toMatch(/## Refused runs\n\nNone\./);
  });
});
