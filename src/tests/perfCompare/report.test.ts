import { describe, expect, it } from "vitest";
import { config, processRun } from "./fixtures";
import { aggregate, compareEngines } from "./metrics";
import { comparisonsCsv, csvCell, fmt, markdownReport, preThree, rawCsv, summaryCsv, toCsv } from "./report";
import type { CompareResults } from "./types";

describe("csv", () => {
  it("quotes cells that need it and leaves blanks for missing values", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
    expect(csvCell(1 / 3)).toBe("0.333333");
    expect(toCsv(["x", "y"], [[1, "a\nb"]])).toBe('x,y\n1,"a\nb"\n');
  });
});

describe("fmt", () => {
  it("formats each unit", () => {
    expect(fmt(2 * 1024 * 1024, "bytes")).toBe("2.00 MiB");
    expect(fmt(2048, "bytes")).toBe("2.0 KiB");
    expect(fmt(12, "bytes")).toBe("12 B");
    expect(fmt(0.123, "ratio")).toBe("12.3%");
    expect(fmt(1234.5, "ms")).toBe("1235 ms");
    expect(fmt(12.345, "ms")).toBe("12.35 ms");
    expect(fmt(0.1234, "ms")).toBe("0.123 ms");
    expect(fmt(59.5, "fps")).toBe("59.50 fps");
    expect(fmt(null, "ms")).toBe("n/a");
    expect(fmt(NaN, "ms")).toBe("n/a");
  });
});

function results(ok: boolean): CompareResults {
  const runs = Array.from({ length: 6 }, (_, rep) => [processRun(rep, "ts"), processRun(rep, "wasm", {}, 2)]).flat();
  const metrics = aggregate(runs, ["small"], [1]);
  return {
    schema: 1,
    generatedAt: "2026-10-13T00:00:00.000Z",
    issue: "maniator/verticopolis#972",
    config: config({ reps: 6 }),
    environment: {
      commit: "abc1234def",
      commitShort: "abc1234",
      dirty: false,
      branch: "b",
      mainCommit: "c928ff4",
      mainFetched: true,
      mergeBase: "c928ff4",
      behindMain: 0,
      os: "Linux",
      kernel: "6",
      arch: "x64",
      cpuModel: "cpu",
      logicalCpus: 4,
      totalMemoryBytes: 1e9,
      freeMemoryBytesAtStart: 1e8,
      node: "v22",
      rust: null,
      playwright: "1.61.1",
      appVersion: "2.29.6",
      engineBuildHash: "h1",
      engineSourceHash: "h2",
      enginePackage: { "verticopolis_engine_bg.wasm": "a".repeat(64) },
    },
    browser: { version: "141", headless: true, executable: null },
    scenarios: [{ name: "small", description: "d", sha256: "f".repeat(64), population: 700, units: 10, transports: 2, saveBytes: 1000 }],
    nodeChecks: [{ scenario: "small", steps: 10, dt: 2, start: { tsState: "a", wasmState: "a", tsCrowd: "c", wasmCrowd: "c" }, end: { tsState: "b", wasmState: "b", tsCrowd: "d", wasmCrowd: "e" }, match: false, nodeTsMs: 1, nodeWasmMs: 1 }],
    runs,
    bundle: null,
    metrics,
    comparisons: compareEngines(metrics),
    validation: { ok, errors: ok ? [] : ["boom"], warnings: ["careful"] },
    limitations: ["one machine"],
  };
}

describe("markdownReport", () => {
  it("states the validation result, the environment and each section", () => {
    const md = markdownReport(results(false));
    expect(md).toContain("**Validation: FAILED.**");
    expect(md).toContain("> **Snapshot, not a live figure.** Measured ? to 2026-10-13T00:00:00.000Z on commit `abc1234def` (app 2.29.6), with public main at `c928ff4`. A pre-3.0 baseline");
    expect(md).toContain("- error: boom");
    expect(md).toContain("- warning: careful");
    expect(md).toContain("(sources: h2, MISMATCH)");
    expect(md).toContain("verticopolis_engine_bg.wasm aaaaaaaaaaaaaaaa");
    expect(md).toContain("| Public main (origin/main as last fetched) | c928ff4 (merge base c928ff4; this tree contains it) |");
    expect(md).toContain("| small | 10 | same | same | DIFFERENT | NO |");
    expect(md).toContain("## Simulation only, engine as the app hosts it");
    expect(md).toMatch(/\| small \| 1x \| total for fixed duration \| 100 ms \| 200 ms \| 2\.00x \(2\.00 to 2\.00\) \| wasm slower \| 6\/6\/6 \|/);
    expect(md).toContain("ts: ts; wasm: ts");
    expect(md).toContain("- one machine");
    expect(markdownReport(results(true))).toContain("**Validation: passed.**");
  });

  it("writes CSVs with one row per metric, value and comparison", () => {
    const r = results(true);
    expect(summaryCsv(r.metrics).split("\n")[0]).toMatch(/^group,scenario,throttle,metric,unit,engine,n,median/);
    const raw = rawCsv(r.metrics).trim().split("\n");
    expect(raw.length - 1).toBe(r.metrics.reduce((s, m) => s + m.values.length, 0));
    expect(comparisonsCsv(r.comparisons).trim().split("\n").length - 1).toBe(r.comparisons.length);
  });
});

describe("preThree", () => {
  it("calls only versions before 3.0.0 pre-cutover", () => {
    expect(preThree("2.29.6")).toBe(true);
    expect(preThree("3.0.0")).toBe(false);
    expect(preThree("x")).toBe(false);
  });
  it("leaves the pre-3.0 sentence out of a 3.x report and names a stale main", () => {
    const r = results(true);
    r.environment.appVersion = "3.1.0";
    r.environment.mainFetched = false;
    const md = markdownReport(r);
    expect(md).not.toContain("pre-3.0 baseline of an engine");
    expect(md).toContain("as last fetched (the fetch before the run failed)");
  });
});
