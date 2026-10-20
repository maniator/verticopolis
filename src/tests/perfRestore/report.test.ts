import { describe, expect, it } from "vitest";
import type { PackageState } from "../perfCompare/env";
import { parseArgs, restorePackageErrors, stepsFor, throttleOrder, workloadOrder } from "./main";
import { markdown, problems, rows, type MeasuredRun, type ReportMeta } from "./report";

const run = (over: Partial<MeasuredRun> = {}): MeasuredRun => ({
  scenario: "small",
  workload: "plain",
  steps: 4,
  dt: 2,
  stepMs: [1, 2, 3, 4],
  planned: 0,
  commands: 0,
  accepted: 0,
  merges: 1,
  hostedSaves: 0,
  saves: 1,
  extraSaves: 0,
  saveMs: 3,
  pullCalls: 6,
  pullMs: 0.5,
  pointSaveMs: [3, 2, 4, 3, 3],
  pointChars: 2_500_000,
  restoreMs: [10, 12, 11],
  crossOriginIsolated: true,
  fault: null,
  rep: 0,
  throttle: 1,
  ...over,
});

const meta: ReportMeta = {
  date: "2026-10-20",
  commit: "abcdef0123456",
  dirty: false,
  quick: false,
  cpu: "Test CPU",
  os: "Test OS",
  browser: "Chromium 1",
  crossOriginIsolated: true,
  reps: 2,
  throttles: [1, 4],
  steps: { plain: 240, drag: 40, click: 240, edits: 40 },
  clickEvery: 20,
  dt: 2,
};

describe("the restore-point benchmark (#874)", () => {
  it("parses its options and refuses bad ones", () => {
    expect(parseArgs([])).toEqual({ reps: 10, throttles: [1, 4], scenarios: null, skipBuild: false, out: null, quick: false });
    expect(parseArgs(["--quick"]).reps).toBe(2);
    expect(parseArgs(["--quick", "--reps", "3", "--throttles", "4", "--scenarios", "small,large", "--skip-build", "--out", "x"])).toEqual({ reps: 3, throttles: [4], scenarios: ["small", "large"], skipBuild: true, out: "x", quick: true });
    expect(() => parseArgs(["--reps", "0"])).toThrow(/whole number/);
    expect(() => parseArgs(["--throttles", "0.5"])).toThrow(/at least 1/);
    expect(() => parseArgs(["--out"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--fast"])).toThrow(/unknown option/);
    expect(() => parseArgs(["--scenarios", "small,"])).toThrow(/needs names/);
    // A repeated rate or scenario would run twice and count twice.
    expect(parseArgs(["--throttles", "4,1,4", "--scenarios", "large,large"])).toMatchObject({ throttles: [4, 1], scenarios: ["large"] });
  });

  it("alternates the throttle order, rotates the workloads and shortens a quick run", () => {
    expect(throttleOrder([1, 4], 0)).toEqual([1, 4]);
    expect(throttleOrder([1, 4], 1)).toEqual([4, 1]);
    expect(workloadOrder(0)).toEqual(["plain", "drag", "click", "edits"]);
    expect(workloadOrder(1)).toEqual(["drag", "click", "edits", "plain"]);
    expect(workloadOrder(4)).toEqual(workloadOrder(0));
    expect(stepsFor(true)).toEqual({ plain: 60, drag: 10, click: 60, edits: 10 });
  });

  it("reads the package checks for dist-perf/ alone, and names a package that changed during the run", () => {
    const pkg: PackageState = { files: { "verticopolis_engine_bg.wasm": "a", "verticopolis_engine.js": "b" }, buildHash: "h1", buildProblem: null };
    expect(restorePackageErrors(pkg, "h1")).toEqual([]);
    const none: PackageState = { files: {}, buildHash: null, buildProblem: "has no BUILD.json" };
    const errs = restorePackageErrors(none, "h1");
    expect(errs.some((e) => e.startsWith("dist/ ") || e.includes("sizes build"))).toBe(false);
    expect(errs.join("\n")).toMatch(/dist-perf\/ serves no engine package/);
    expect(restorePackageErrors(pkg, "h1", { ...pkg, buildHash: "h0" }).join("\n")).toMatch(/changed during the run/);
  });

  it("takes each row's figures as medians over the clean repetitions and sums the counts", () => {
    const table = rows([
      run({ rep: 0, stepMs: [1, 1, 1, 1] }),
      run({ rep: 1, stepMs: [3, 3, 3, 3], extraSaves: 1, pointSaveMs: [8, 8, 8, 8, 8], restoreMs: [30, 1, 2] }),
      run({ rep: 2, stepMs: [100, 100, 100, 100], fault: "trap-tick: boom", extraSaves: 9 }),
      run({ rep: 0, workload: "edits", planned: 4, commands: 4, accepted: 4, merges: 4, hostedSaves: 4, saves: 8, saveMs: 40 }),
      run({ rep: 0, scenario: "large" }),
    ]);
    expect(table.map((r) => `${r.scenario} ${r.workload}`)).toEqual(["small plain", "small edits", "large plain"]);
    const plain = table[0];
    expect(plain.reps).toBe(2); // the faulted run counts in no figure
    expect(plain.stepMedianMs).toBe(2);
    expect(plain.stepMaxMs).toBe(3);
    expect(plain.extraSaves).toBe(1);
    expect(plain.merges).toBe(2);
    expect(plain.pullMsPerStep).toBe(0.125);
    expect(plain.pointSaveMs).toBe(5.5);
    expect(plain.extraSaveMsPerStep).toBe(1); // (0 + 8 / 4) / 2
    expect(plain.restoreMs).toBe(6.5); // the median of each run's median: 11 and 2
    expect(plain.pullShare).toBeCloseTo((0.5 / 4 + 0.5 / 12) / 2, 10);
    expect(plain.savesPerCommand).toBeNaN();
    expect(plain.pointChars).toBe(2_500_000);
    const edits = table[1];
    expect(edits.hostedSaves).toBe(4);
    expect(edits.savesPerCommand).toBe(2);
    expect(edits.saveMsPerCommand).toBe(10);
  });

  it("shows a row whose every run faulted as n/a rather than a number", () => {
    const [row] = rows([run({ fault: "trap-tick: boom" })]);
    expect(row.reps).toBe(0);
    expect(row.stepMedianMs).toBeNaN();
    expect(row.stepMaxMs).toBeNaN();
    expect(markdown(meta, [row], ["x"])).toMatch(/\| small \| plain \| 1x \| 0 \| n\/a \| n\/a \| n\/a \|/);
  });

  it("names every run that cannot stand as evidence", () => {
    expect(problems([run()], 1, { dirty: false })).toEqual([]);
    const issues = problems(
      [run({ fault: "trap-tick: boom" }), run({ workload: "drag", planned: 3, commands: 3, accepted: 0 }), run({ workload: "edits", planned: 40, commands: 12, accepted: 12, hostedSaves: 12 }), run({ workload: "click", extraSaves: 2 })],
      6,
      { dirty: true },
    );
    expect(issues).toHaveLength(6);
    expect(issues[0]).toMatch(/uncommitted changes/);
    expect(issues[1]).toMatch(/trap-tick: boom/);
    expect(issues[2]).toMatch(/refused 3 of 3 commands/);
    expect(issues[3]).toMatch(/issued 12 of the 40 commands/);
    // A save the restore points added is the cost the design rules out.
    expect(issues[4]).toMatch(/small click at 1x: 2 engine saves beyond the merges' and the hosted ones/);
    expect(issues[5]).toMatch(/2 of 6 runs are missing/);
  });

  it("names an edits run whose captures read too few saves, and save counts that do not add up", () => {
    expect(problems([run({ workload: "edits", planned: 40, commands: 40, accepted: 40, hostedSaves: 40 })], 1, { dirty: false })).toEqual([]);
    const issues = problems([run({ workload: "edits", planned: 40, commands: 40, accepted: 40, hostedSaves: 39 }), run({ workload: "drag", extraSaves: -1 })], 2, { dirty: false });
    expect(issues).toEqual([
      "rep 1, small edits at 1x: 39 hosted saves for 40 edits, so the edits' undo captures did not each read a save and the rapid-edit check did not run",
      "rep 1, small drag at 1x: the merges and hosted saves counted exceed the engine's saves by 1, so the save counts cannot be trusted",
    ]);
  });

  it("writes the snapshot header first and every row", () => {
    const text = markdown(meta, rows([run(), run({ throttle: 4 })]), []);
    const lines = text.split("\n");
    expect(lines[0]).toBe("# Restore-point overhead (#874)");
    expect(lines[2]).toMatch(/^> \*\*Snapshot of one run on 2026-10-20, commit `abcdef0`, not refreshing\.\*\*/);
    expect(lines[2]).toMatch(/src\/tests\/perfRestore\/report\.test\.ts/);
    expect(text).toMatch(/\| small \| plain \| 1x \| 1 \|/);
    expect(text).toMatch(/\| small \| plain \| 4x \| 1 \|/);
    expect(text).toMatch(/\| small \| plain \| 1x \| 0 \(0\) \| 1 \| 0 \| 0 \| n\/a \| n\/a \| 0\.000 \| 3\.0 \| 2\.50 \| 11\.0 \|/);
    expect(text).toMatch(/\*\*edits\*\*: 40 steps/);
    expect(text).not.toMatch(/not cross-origin isolated/);
    expect(markdown({ ...meta, crossOriginIsolated: false }, [], [])).toMatch(/not cross-origin isolated/);
    expect(text).toMatch(/## Problems\n\nNone\./);
    expect(markdown({ ...meta, quick: true }, [], ["x"])).toMatch(/never counts[\s\S]*does not stand as evidence\)\n\n- x/);
    expect(text).not.toMatch(/—/);
  });
});
