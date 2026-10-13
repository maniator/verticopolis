import { describe, expect, it } from "vitest";
import { config, processRun, step } from "./fixtures";
import type { NodeCheck } from "./nodeCheck";
import { validateResults } from "./validate";

const node = (match = true): NodeCheck => ({
  scenario: "small",
  steps: 10,
  dt: 2,
  start: { tsState: "a", wasmState: "a", tsCrowd: "c", wasmCrowd: "c" },
  end: { tsState: "b", wasmState: match ? "b" : "x", tsCrowd: "d", wasmCrowd: "d" },
  match,
  nodeTsMs: 1,
  nodeWasmMs: 1,
});

const good = () => [processRun(0, "ts"), processRun(0, "wasm"), processRun(1, "wasm"), processRun(1, "ts")];

describe("validateResults", () => {
  it("passes a complete, consistent set", () => {
    const v = validateResults(config(), good(), [node()]);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/only 2 repetition/);
  });

  it("names a WASM fallback as an error and never counts it", () => {
    const runs = good();
    runs[1].cold!.engineActive = "ts";
    const v = validateResults(config(), runs, [node()]);
    expect(v.ok).toBe(false);
    expect(v.errors).toContain("rep 0 wasm: cold start: the WASM engine did not initialize; the page fell back to TypeScript");
  });

  it("flags a simulation or frame sample that ran on the other engine", () => {
    const runs = good();
    runs[1].scenarios.small.hosted["1"].engineActive = "ts";
    runs[1].scenarios.small.frames["1"].engineActive = "ts";
    runs[0].warm!.engineActive = "wasm";
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(
      expect.arrayContaining([
        "rep 0 wasm: small hosted at 1x ran on ts, not wasm",
        "rep 0 wasm: small frames at 1x ran on ts, not wasm",
        "rep 0 ts: warm start: the TypeScript run reports the WASM engine active",
      ]),
    );
  });

  it("refuses samples that started or ended in different states", () => {
    const runs = good();
    runs[3].scenarios.small.raw["1"] = step("ts", { startDigest: "other", endDigest: "other-end", end: { minutes: 599, money: 1, star: 2, population: 10, people: 3 } });
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors.some((e) => e.startsWith("small: the samples did not start from one state"))).toBe(true);
    expect(v.errors.some((e) => e.startsWith("small: the samples did not end in one state"))).toBe(true);
    expect(v.errors).toContain("small: the samples ended at different clock minutes: 600, 599");
  });

  it("reports missing and failed runs, and missing samples, by name", () => {
    const runs = good().slice(0, 3);
    runs[2] = { ...runs[2], ok: false, error: "boom" };
    delete (runs[0].scenarios as Record<string, unknown>).small;
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(expect.arrayContaining(["rep 1 ts: no process run recorded", "rep 1 wasm: failed: boom", "rep 0 ts: scenario small missing"]));
  });

  it("reports duplicate runs, a missing phase and missing per-throttle samples", () => {
    const runs = [...good(), processRun(1, "ts")];
    runs[0].warm = null;
    delete runs[1].scenarios.small.raw["1"];
    delete runs[1].scenarios.small.frames["1"];
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(expect.arrayContaining(["rep 1 ts: 2 process runs recorded, expected one", "rep 0 ts: no warm start sample", "rep 0 wasm: small raw at 1x missing", "rep 0 wasm: small frames at 1x missing"]));
  });

  it("fails on a Node mismatch or a missing Node check", () => {
    expect(validateResults(config(), good(), [node(false)]).errors[0]).toMatch(/Node conformance check found the engines disagree/);
    expect(validateResults(config(), good(), []).errors).toContain("small: no Node conformance check ran");
  });

  it("fails when the configurations cannot be compared", () => {
    const runs = good();
    runs[2].browserVersion = "140.0";
    runs[3].page = { ...runs[3].page!, viewport: { width: 800, height: 600, dpr: 1 }, crossOriginIsolated: false, timerResolutionMs: 0.1 };
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(expect.arrayContaining(["the runs used different browser builds: 141.0, 140.0", "some runs were cross-origin isolated and some were not"]));
    expect(v.errors.some((e) => e.startsWith("the runs used different viewports"))).toBe(true);
    expect(v.warnings.some((w) => /coarser than 20 microseconds/.test(w))).toBe(true);
    const onlyTs = validateResults(config({ reps: 1 }), [processRun(0, "ts"), { ...processRun(0, "wasm"), ok: false, error: "x" }], [node()]);
    expect(onlyTs.errors).toContain("no successful wasm process: the configurations cannot be compared");
  });

  it("gives no repetition warning at ten or more", () => {
    const runs = Array.from({ length: 10 }, (_, rep) => [processRun(rep, "ts"), processRun(rep, "wasm")]).flat();
    expect(validateResults(config({ reps: 10 }), runs, [node()]).warnings).toEqual([]);
  });
});
