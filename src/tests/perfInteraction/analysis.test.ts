import { describe, expect, it } from "vitest";
import { activityTable, compareArms, comparisonTable, phaseMetrics, type ArmRun, type PhaseMetrics } from "./analysis";
import { armOrder, parseArgs } from "./main";
import type { PhaseRecord } from "./pageRecorder";

const record = (over: Partial<PhaseRecord> = {}): PhaseRecord => ({
  frames: Array.from({ length: 100 }, (_, i) => (i === 99 ? 100 : 16)),
  longTasks: [60, 120],
  loafs: [{ dur: 120, blocking: 70 }, { dur: 80, blocking: 30 }],
  events: [
    { name: "pointerdown", dur: 24, delay: 4, proc: 10 },
    { name: "click", dur: 40, delay: 18, proc: 12 },
  ],
  inputToFrame: Array.from({ length: 100 }, (_, i) => i + 1),
  parts: { "view decode": { n: 3, ms: 9, max: 5 } },
  simMinutes: 240,
  windowMs: 20000,
  minuteOfDayStart: 450,
  ...over,
});

describe("one phase's metrics", () => {
  it("reads frames, blocking and slow input from the page's record", () => {
    const m = phaseMetrics(record(), true, { actions: 20, effective: 7 });
    expect(m.frames).toBe(100);
    expect(m.frameP50Ms).toBe(16);
    // The slowest 1% is the one 100 ms frame.
    expect(m.onePercentLowFps).toBe(10);
    expect(m.longTaskCount).toBe(2);
    expect(m.longTaskTotalMs).toBe(180);
    // Over a 20 s window.
    expect(m.longTaskMsPerSecond).toBe(9);
    expect(m.loafBlockingMsPerSecond).toBe(5);
    expect(m.slowInteractionsPerMinute).toBe(6);
    expect(m.longTaskMaxMs).toBe(120);
    expect(m.loafBlockingTotalMs).toBe(100);
    expect(m.loafBlockingMaxMs).toBe(70);
    expect(m.slowEventCount).toBe(2);
    expect(m.eventP75Ms).toBe(36);
    expect(m.eventMaxDelayMs).toBe(18);
    expect(m.inputCount).toBe(100);
    expect(m.inputToFrameP95Ms).toBeCloseTo(95.05);
    expect(m.simMinutes).toBe(240);
    expect(m).toMatchObject({ actions: 20, effective: 7 });
    expect(m.parts["view decode"].max).toBe(5);
  });

  it("reads no slow input as 0 and no LoAF support as no value", () => {
    const m = phaseMetrics(record({ events: [], longTasks: [], inputToFrame: [] }), false);
    expect(m.eventP98Ms).toBe(0);
    expect(m.inputToFrameP99Ms).toBe(0);
    expect(m).toMatchObject({ actions: 0, effective: null });
    expect(m.longTaskMaxMs).toBe(0);
    expect(m.loafBlockingTotalMs).toBeNull();
    expect(m.loafBlockingMsPerSecond).toBeNull();
  });

  it("reads totals over the window's length, so a window held open longer is not charged more", () => {
    const long = phaseMetrics(record({ longTasks: [60, 120, 180], windowMs: 30000 }), true);
    expect(long.longTaskMsPerSecond).toBe(12);
  });

  it("refuses a phase that drew no frames", () => {
    expect(() => phaseMetrics(record({ frames: [] }), true)).toThrow(/no frames/);
  });
});

function run(arm: "A" | "B", rep: number, m: Partial<PhaseMetrics>): ArmRun {
  const base = phaseMetrics(record(), true);
  return { arm, rep, throttle: 1, phases: { pan: { ...base, ...m } } };
}

describe("A against B", () => {
  const runs: ArmRun[] = [];
  for (let rep = 1; rep <= 6; rep++) {
    runs.push(run("A", rep, { frameP99Ms: 40, longTaskMsPerSecond: 300 + rep }));
    runs.push(run("B", rep, { frameP99Ms: 20, longTaskMsPerSecond: 100 + rep }));
  }
  const rows = compareArms(runs, ["pan"]);

  it("compares frame times as B over A, paired by repetition", () => {
    const p99 = rows.find((r) => r.metric === "frameP99Ms");
    expect(p99).toMatchObject({ kind: "ratio", medianA: 40, medianB: 20, value: 0.5, pairs: 6, ciLow: 0.5, ciHigh: 0.5 });
  });

  it("compares blocking as B minus A, so an arm at 0 still compares", () => {
    const total = rows.find((r) => r.metric === "longTaskMsPerSecond");
    expect(total).toMatchObject({ kind: "difference", value: -200, pairs: 6 });
    const zero = compareArms([run("A", 1, { longTaskMaxMs: 0 }), run("B", 1, { longTaskMaxMs: 0 })], ["pan"]).find((r) => r.metric === "longTaskMaxMs");
    expect(zero).toMatchObject({ value: 0, pairs: 1, ciLow: null });
  });

  it("drops a repetition missing from one arm, for ratios and for differences", () => {
    const rows5 = compareArms(runs.filter((r) => !(r.arm === "B" && r.rep === 1)), ["pan"]);
    const thin = rows5.find((r) => r.metric === "frameP99Ms");
    expect(thin?.pairs).toBe(5);
    expect(thin?.ciLow).toBeNull();
    // Pairs by repetition, not by position: rep 2's B (102) against rep 2's A (302), and so on.
    expect(rows5.find((r) => r.metric === "longTaskMsPerSecond")).toMatchObject({ value: -200, pairs: 5 });
  });

  it("lists what each run did, so a phase that did nothing shows", () => {
    const table = activityTable([run("A", 1, { actions: 12, effective: 0, simMinutes: 0 })], ["pan"]);
    expect(table).toContain("| 1x | 1 | A | pan | 07:30 | 20.0 | 12 | 0 | 0 | 100 |");
  });

  it("prints one row per metric with its interval", () => {
    const table = comparisonTable(rows);
    expect(table).toContain("| 1x | pan | frame p99 (ms) | 40.0 | 20.0 | x0.500 | 0.500 to 0.500 | 6 |");
    expect(table).toContain("| 1x | pan | long tasks (ms per s) | 303.5 | 103.5 | -200.0 |");
  });
});

describe("the command line", () => {
  it("needs both builds and takes the defaults of the PC run", () => {
    expect(() => parseArgs([])).toThrow(/--a and --b are both required/);
    const a = parseArgs(["--a", "x", "--b", "y"]);
    expect(a).toMatchObject({ reps: 6, throttles: [1, 4], phaseMs: 20000, scenario: "large", viewport: { width: 1920, height: 1080 }, allowSoftware: false });
  });

  it("reads the options and refuses mistakes", () => {
    expect(parseArgs(["--a", "x", "--b", "y", "--throttles", "1,6", "--viewport", "1280x720", "--reps", "3"])).toMatchObject({ throttles: [1, 6], viewport: { width: 1280, height: 720 }, reps: 3 });
    expect(parseArgs(["--a", "x", "--b", "y", "--quick"])).toMatchObject({ reps: 1, throttles: [1], phaseMs: 3000 });
    expect(() => parseArgs(["--a", "x", "--b", "y", "--reps", "0"])).toThrow(/positive whole number/);
    expect(() => parseArgs(["--a", "x", "--b", "y", "--scenario", "huge"])).toThrow(/unknown scenario/);
    expect(() => parseArgs(["--a", "x", "--b", "y", "--fast"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--a", "x", "--b", "y", "--throttles", "1,1"])).toThrow(/twice/);
    expect(() => parseArgs(["--a", "x", "--b", "y", "--allow-software"])).toThrow(/needs --out/);
    expect(parseArgs(["--a", "x", "--b", "y", "--allow-software", "--out", "/tmp/p"]).allowSoftware).toBe(true);
  });

  it("alternates which arm goes first", () => {
    expect(armOrder(1)).toEqual(["A", "B"]);
    expect(armOrder(2)).toEqual(["B", "A"]);
  });
});
