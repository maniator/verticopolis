import { describe, expect, it } from "vitest";
import { crossErrors, crossMarkdown, crossRun, type CrossInput } from "./crossRun";
import type { Metric } from "./analysis";
import type { ModeName } from "./pageWorker";

const REPS = 10;
const reps = Array.from({ length: REPS }, (_, i) => i);

function metric(mode: ModeName, name: string, base: number, over: Partial<Metric> = {}): Metric {
  // A little spread across repetitions, the same in both runs, so the paired
  // ratios are exact while the values are not constant.
  const values = reps.map((i) => base * (1 + i / 200));
  return { group: "hosted", scenario: "large", throttle: "1", metric: name, unit: "ms", better: "lower", mode, values, reps, summary: null, ...over };
}

/** A run: controls at their base value, the worker's rows scaled by `worker`. */
function input(commit: string, mergeBase: string | null, worker: number, control = 1): CrossInput {
  const metrics: Metric[] = [];
  for (const mode of ["ts", "wasm", "wasm-frame"] as const) {
    metrics.push(metric(mode, "wall time, 720 steps", 1000 * control), metric(mode, "main-thread time, 720 steps", 800 * control));
  }
  metrics.push(metric("wasm-worker", "wall time, 720 steps", 1000 * worker), metric("wasm-worker", "main-thread time, 720 steps", 800 * worker));
  metrics.push(metric("wasm-worker", "full-save merges (frames)", 4, { group: "traffic", values: reps.map(() => 4 * worker) }));
  return {
    config: { reps: REPS, quick: false, scenarios: ["large"] } as unknown as CrossInput["config"],
    environment: { commit, dirty: false, mergeBase, cpuModel: "Ryzen", logicalCpus: 12, totalMemoryBytes: 32, os: "win", kernel: "26200", arch: "x64", node: "22", playwright: "1.5" } as unknown as CrossInput["environment"],
    browser: { version: "149", executable: "chrome.exe" },
    scenarios: [{ name: "large", sha256: "abc", population: 1, units: 1, transports: 1, saveBytes: 1 }],
    metrics,
    validation: { ok: true, errors: [], warnings: [] },
  };
}

const before = (control = 1, worker = 1) => input("aaa", "zzz", worker, control);
const after = (worker: number, control = 1) => input("bbb", "aaa", worker, control);

describe("perf:worker cross-run comparison", () => {
  it("pairs repetitions, divides after by before, and keeps the controls apart from the subject", () => {
    const r = crossRun(before(), after(0.5));
    expect(r.errors).toEqual([]);
    expect(r.voided).toEqual([]);
    const subject = r.rows.find((x) => x.mode === "wasm-worker" && x.metric.startsWith("wall time"))!;
    expect(subject.role).toBe("subject");
    expect(subject.ratio).toBeCloseTo(0.5, 9);
    expect(subject.n).toBe(REPS);
    expect(subject.verdict).toBe("lower");
    const control = r.rows.find((x) => x.mode === "wasm" && x.metric.startsWith("wall time"))!;
    expect(control.role).toBe("control");
    expect(control.ratio).toBeCloseTo(1, 9);
    expect(control.verdict).toBe("equivalent");
  });

  it("voids a scenario whose controls moved, even when the subject improved", () => {
    const r = crossRun(before(), after(0.5, 1.12));
    expect(r.errors).toEqual([]);
    expect(r.voided).toHaveLength(1);
    expect(r.voided[0]).toMatchObject({ scenario: "large", throttle: "1" });
    expect(r.voided[0].rows.some((x) => x.startsWith("ts:"))).toBe(true);
  });

  it("voids one control that moved among controls that held", () => {
    const a = after(1);
    const wasm = a.metrics.find((m) => m.mode === "wasm" && m.metric.startsWith("main-thread"))!;
    wasm.values = wasm.values.map((v) => v * 1.2);
    const r = crossRun(before(), a);
    expect(r.voided).toHaveLength(1);
    expect(r.voided[0].rows).toEqual([expect.stringContaining("wasm: main-thread time")]);
  });

  it("voids a scenario that has no control row", () => {
    const a = after(1);
    const b = before();
    const bare = (x: CrossInput) => ({ ...x, metrics: x.metrics.filter((m) => m.mode === "wasm-worker") });
    const r = crossRun(bare(b), bare(a));
    expect(r.voided[0].rows).toEqual(["no control row to vouch for this scenario and throttle"]);
  });

  it("drops a pair whose before value is zero, and pairs only repetitions both runs have", () => {
    const b = before();
    const a = after(1);
    const row = b.metrics.find((m) => m.mode === "wasm-worker" && m.metric.startsWith("full-save"))!;
    row.values[3] = 0;
    a.metrics.find((m) => m.mode === "wasm-worker" && m.metric.startsWith("full-save"))!.reps = reps.map((i) => i + (i === 9 ? 5 : 0));
    const r = crossRun(b, a);
    const out = r.rows.find((x) => x.metric.startsWith("full-save"))!;
    expect(out.zeroReference).toBe(1);
    expect(out.n).toBe(REPS - 2);
  });

  it("refuses a pair that differs in more than the commit", () => {
    const base = before();
    const mutate = (f: (x: CrossInput) => void): string[] => {
      const a = after(1);
      f(a);
      return crossErrors(base, a, REPS);
    };
    expect(crossErrors(base, after(1), REPS)).toEqual([]);
    expect(mutate((a) => { a.environment.dirty = true; })).toEqual(["the after run was on a dirty tree"]);
    expect(mutate((a) => { a.validation.ok = false; })).toEqual(["the after run failed its own validation"]);
    expect(mutate((a) => { a.config.quick = true; })[0]).toBe("the after run is a --quick smoke run");
    expect(mutate((a) => { a.config.reps = 5; })).toEqual(expect.arrayContaining(["the after run has 5 repetitions; 10 are needed", "the two runs used different configurations"]));
    expect(mutate((a) => { a.scenarios[0].sha256 = "other"; })).toEqual(["the two runs measured different towers"]);
    expect(mutate((a) => { a.browser.version = "150"; })).toEqual(["the two runs differ in browser, machine or toolchain"]);
    expect(mutate((a) => { a.environment.cpuModel = "other"; })).toEqual(["the two runs differ in browser, machine or toolchain"]);
    expect(mutate((a) => { a.environment.commit = "aaa"; })).toEqual(expect.arrayContaining(["both runs are the same commit"]));
    expect(mutate((a) => { a.environment.mergeBase = "elsewhere"; })[0]).toContain("is not the before run's commit");
    expect(mutate((a) => { a.environment.mergeBase = null; })[0]).toContain("unknown");
    expect(crossRun(base, Object.assign(after(1), { validation: { ok: false, errors: [], warnings: [] } })).rows).toEqual([]);
  });

  it("writes the verdict, the void and the refusal into the report", () => {
    const b = before();
    const ok = after(0.5);
    expect(crossMarkdown(b, ok, crossRun(b, ok))).toContain("Every control row is equivalent within the band.");
    expect(crossMarkdown(b, ok, crossRun(b, ok))).toContain("| large | 1 | wall time, 720 steps | wasm-worker | subject | 0.500 |");
    const moved = after(0.5, 1.12);
    expect(crossMarkdown(b, moved, crossRun(b, moved))).toContain("**Void (a control moved):**");
    const dirty = after(1);
    dirty.environment.dirty = true;
    expect(crossMarkdown(b, dirty, crossRun(b, dirty))).toContain("**Not comparable:**");
  });
});
