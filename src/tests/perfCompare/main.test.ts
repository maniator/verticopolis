import { describe, expect, it } from "vitest";
import { CHECKPOINT_META, CHECKPOINT_RUNS, loadCheckpoint, makeConfig, outputDir, packageErrors, parseArgs, stampErrors } from "./main";
import { processRun } from "./fixtures";
import { engineOrder, frameSummary, stepSummary } from "./runner";

describe("parseArgs", () => {
  it("defaults to ten repetitions and both throttles", () => {
    const a = parseArgs([]);
    expect(a).toEqual({ reps: 10, quick: false, skipBuild: false, out: null, resume: null, scenarios: null, throttles: null });
    expect(makeConfig(a, ["small"])).toMatchObject({ reps: 10, steps: 720, dt: 2, throttles: [1, 4], speed: 3, quick: false });
  });
  it("reads every flag, and --quick lowers the default reps only", () => {
    expect(parseArgs(["--quick"]).reps).toBe(2);
    expect(parseArgs(["--quick", "--reps", "5"]).reps).toBe(5);
    const a = parseArgs(["--skip-build", "--out", "x", "--scenarios", "small,large", "--throttles", "1,6"]);
    expect(a).toMatchObject({ skipBuild: true, out: "x", scenarios: ["small", "large"], throttles: [1, 6] });
    expect(makeConfig(parseArgs(["--quick"]), []).steps).toBeLessThan(720);
  });
  it("refuses bad values and unknown flags", () => {
    expect(() => parseArgs(["--reps", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--reps"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--throttles", "0.5"])).toThrow(/from 1 to 20/);
    expect(() => parseArgs(["--fast"])).toThrow(/unknown argument --fast/);
    expect(() => parseArgs(["--throttles", "1,1"])).toThrow(/a rate twice/);
    expect(() => parseArgs(["--scenarios", "small,small"])).toThrow(/a scenario twice/);
    expect(() => parseArgs(["--scenarios", ","])).toThrow(/at least one name/);
    expect(() => parseArgs(["--throttles", "1,Infinity"])).toThrow(/from 1 to 20/);
    expect(() => parseArgs(["--reps", "3", "--reps", "5"])).toThrow(/--reps is given twice/);
    expect(parseArgs(["--resume", "d"]).resume).toBe("d");
    expect(() => parseArgs(["--resume", "d", "--out", "e"])).toThrow(/takes no --out/);
  });
});

describe("runner summaries", () => {
  it("alternates which engine goes first", () => {
    expect(engineOrder(0)).toEqual(["ts", "wasm"]);
    expect(engineOrder(1)).toEqual(["wasm", "ts"]);
  });
  it("summarizes a simulation run's steps", () => {
    const s = stepSummary(
      { mode: "raw", engineActive: "wasm", steps: 4, dt: 2, loadMs: 3, totalMs: 10, stepMs: [1, 2, 3, 4], attribution: null, hostErrorsAdded: [], gcAvailable: true, startMinutes: 0, startKey: "a", endKey: "b", end: { minutes: 8, money: 1, star: 1, population: 1, people: 0 } },
      "s",
      "e",
    );
    expect(s).toMatchObject({ totalMs: 10, loadMs: 3, stepMedianMs: 2.5, stepMaxMs: 4, startDigest: "s", endDigest: "e", engineActive: "wasm" });
  });
  it("summarizes frames with the achieved speed and the tick share", () => {
    const f = frameSummary({ audioStarted: false, intervalsMs: [10, 10, 20], wallMs: 1000, simMinutes: 50, tickMs: 100, ticks: 9, uiMs: 10, engineActive: "ts", hostErrorsAdded: [] });
    expect(f).toMatchObject({ frames: 3, medianMs: 10, simMinutesPerSecond: 50, tickShare: 0.1, uiShare: 0.01, ticks: 9, onePercentLowFps: 50, clampedFrames: 0 });
    expect(f.restShare).toBeCloseTo(0.89, 12);
    expect(frameSummary({ audioStarted: true, intervalsMs: [16, 250, 201, 200], wallMs: 700, simMinutes: 1, tickMs: 0, ticks: 1, uiMs: 0, engineActive: "wasm", hostErrorsAdded: [] }).clampedFrames).toBe(2);
  });
});

describe("outputDir", () => {
  const env = { commitShort: "abc1234", dirty: false };
  it("names a new folder by date and commit and never reuses one", () => {
    const taken = new Set(["/r/docs/performance/results/2026-10-13-abc1234", "/r/docs/performance/results/2026-10-13-abc1234-2"]);
    expect(outputDir("/r", { out: null, quick: false, skipBuild: false }, "2026-10-14", env, () => false)).toBe("/r/docs/performance/results/2026-10-14-abc1234");
    expect(outputDir("/r", { out: null, quick: false, skipBuild: false }, "2026-10-13", env, (p) => taken.has(p))).toBe("/r/docs/performance/results/2026-10-13-abc1234-3");
  });
  it("marks quick and dirty runs, and refuses an existing --out", () => {
    expect(outputDir("/r", { out: null, quick: true, skipBuild: true }, "2026-10-13", { commitShort: "abc1234", dirty: true }, () => false)).toBe("/r/docs/performance/results/2026-10-13-abc1234-quick-skipbuild-dirty");
    expect(outputDir("/r", { out: "x", quick: false, skipBuild: false }, "d", env, () => false)).toBe("/r/x");
    expect(() => outputDir("/r", { out: "x", quick: false, skipBuild: false }, "d", env, () => true)).toThrow(/never overwritten/);
  });
});

describe("stampErrors", () => {
  const tree = { commit: "abc", dirty: false };
  const files = (m: Record<string, string | null>) => (p: string) => m[p] ?? null;
  it("passes stamps from this clean commit in both builds", () => {
    expect(stampErrors(["a", "b"], tree, files({ a: '{"commit":"abc","dirty":false}', b: '{"commit":"abc","dirty":false}' }))).toEqual([]);
  });
  it("names a missing, unreadable, foreign, other-commit or dirty stamp, never throwing", () => {
    const errs = stampErrors(["a", "b", "c", "d", "e"], tree, files({ b: "{trunc", c: '{"sha":"abc"}', d: '{"commit":"def","dirty":false}', e: '{"commit":"abc","dirty":true}' }));
    expect(errs).toHaveLength(5);
    expect(errs[0]).toMatch(/a is missing/);
    expect(errs[1]).toMatch(/b is unreadable/);
    expect(errs[2]).toMatch(/c is not a build stamp/);
    expect(errs[3]).toMatch(/d came from def, the tree is abc/);
    expect(errs[4]).toMatch(/e came from abc \(dirty\)/);
    expect(stampErrors(["a"], { commit: "abc", dirty: true }, files({ a: '{"commit":"abc","dirty":false}' }))[0]).toMatch(/the tree is abc \(dirty\)/);
    // A reader that throws (a directory in the stamp's place) is reported too.
    expect(stampErrors(["a"], tree, () => { throw new Error("EISDIR"); })).toEqual(["--skip-build: a cannot be read; run once without --skip-build"]);
  });
});

describe("loadCheckpoint", () => {
  const config = makeConfig(parseArgs([]), ["small"]);
  const machine = { cpuModel: "cpu", node: "v22" };
  const expected = { commit: "abc", dirty: false, skipBuild: false, config, enginePackage: { "x.wasm": "h" }, scenarios: ["s1"], machine };
  const meta = JSON.stringify({ ...expected, startedAt: "2026-10-14T00:00:00.000Z" });
  const files = (m: Record<string, string>) => (p: string) => m[p] ?? null;
  const M = `d/${CHECKPOINT_META}`;
  const R = `d/${CHECKPOINT_RUNS}`;
  const started = (rep: number, engine: string) => JSON.stringify({ started: { rep, engine, at: `t${rep}${engine}` } });
  it("returns finished runs, interrupted attempts and resumes, and cuts a truncated tail", () => {
    const text = [started(0, "ts"), JSON.stringify(processRun(0, "ts")), started(0, "wasm"), started(0, "wasm"), JSON.stringify(processRun(0, "wasm")), JSON.stringify({ resumed: "r1", runsFromCheckpoint: 1 }), started(1, "wasm"), '{"rep":1,"eng'].join("\n");
    let cutTo = -1;
    const cp = loadCheckpoint("d", expected, files({ [M]: meta, [R]: text }), (_p, n) => (cutTo = n));
    expect(cp.runs.map((r) => `${r.rep}${r.engine}`)).toEqual(["0ts", "0wasm"]);
    expect(cp.interrupted.map((x) => x.at)).toEqual(["t0wasm", "t1wasm"]);
    expect(cp.resumes).toEqual([{ at: "r1", runsFromCheckpoint: 1 }]);
    expect(cp.startedAt).toBe("2026-10-14T00:00:00.000Z");
    expect(cutTo).toBe(Buffer.byteLength(text.slice(0, text.lastIndexOf("\n") + 1)));
  });
  it("refuses a bad line before the end, a dirty start, any mismatch, final results, or no checkpoint", () => {
    const at = files({ [M]: meta });
    expect(() => loadCheckpoint("d", expected, files({ [M]: meta, [R]: 'oops\n{"a":1}\n' }))).toThrow(/line 1 of runs.jsonl is not JSON/);
    for (const line of ["{}", "5", "null", '{"rep":0,"engine":"go","scenarios":{}}']) expect(() => loadCheckpoint("d", expected, files({ [M]: meta, [R]: `${line}\n` }))).toThrow(/line 1 of runs.jsonl is neither a run/);
    expect(() => loadCheckpoint("d", expected, files({ [M]: JSON.stringify({ ...expected, dirty: true, startedAt: "x" }) }))).toThrow(/started on a dirty tree/);
    expect(() => loadCheckpoint("d", { ...expected, commit: "def" }, at)).toThrow(/its commit differs/);
    expect(() => loadCheckpoint("d", { ...expected, skipBuild: true }, at)).toThrow(/its skipBuild differs/);
    expect(() => loadCheckpoint("d", { ...expected, config: { ...config, reps: 3 } }, at)).toThrow(/its config differs/);
    expect(() => loadCheckpoint("d", { ...expected, enginePackage: { "x.wasm": "other" } }, at)).toThrow(/its enginePackage differs/);
    expect(() => loadCheckpoint("d", { ...expected, scenarios: ["s2"] }, at)).toThrow(/its scenarios differs/);
    expect(() => loadCheckpoint("d", { ...expected, machine: { ...machine, node: "v24" } }, at)).toThrow(/its machine differs/);
    expect(() => loadCheckpoint("d", expected, files({ "d/results.json": "{}" }))).toThrow(/already holds final results/);
    expect(() => loadCheckpoint("d", expected, files({}))).toThrow(/nothing to resume/);
    expect(loadCheckpoint("d", expected, at).runs).toEqual([]);
  });
});

describe("packageErrors", () => {
  const files = { "verticopolis_engine_bg.wasm": "a", "verticopolis_engine.js": "b" };
  const env = { engineBuildHash: "h", engineSourceHash: "h", enginePackage: files };
  it("passes one package built from the current sources and served by both builds", () => {
    expect(packageErrors(env, "h", { ...files })).toEqual([]);
  });
  it("fails closed on every way the served package can drift from the sources", () => {
    expect(packageErrors({ ...env, engineSourceHash: "other" }, "h", files)).toEqual([expect.stringMatching(/was not built from the current engine-rs sources \(other\)/)]);
    expect(packageErrors({ ...env, engineBuildHash: null }, null, files)).toEqual([expect.stringMatching(/has no BUILD.json/)]);
    expect(packageErrors({ ...env, engineSourceHash: null }, "h", files)).toEqual([expect.stringMatching(/no engine-rs sources in this checkout/)]);
    expect(packageErrors(env, "stale", files)).toEqual([expect.stringMatching(/dist\/ \(sizes\) and dist-perf\/ \(timings\) carry different engine packages \(stale vs h\)/)]);
    expect(packageErrors(env, "h", { ...files, "verticopolis_engine_bg.wasm": "rebuilt" })).toEqual([expect.stringMatching(/serve different engine bytes/)]);
    expect(packageErrors({ ...env, enginePackage: {} }, "h", {})).toEqual([expect.stringMatching(/serves no engine package/)]);
  });
});
