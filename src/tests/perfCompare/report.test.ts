import { describe, expect, it } from "vitest";
import { config, processRun } from "./fixtures";
import { aggregate, compareEngines } from "./metrics";
import { buildLimitations } from "./limitations";
import { writeResultFiles } from "./main";
import { validateResults } from "./validate";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(fmt(-12.345, "ms")).toBe("-12.35 ms");
    expect(fmt(-1234.5, "ms")).toBe("-1235 ms");
    expect(fmt(-0.1234, "ms")).toBe("-0.123 ms");
    expect(fmt(59.5, "fps")).toBe("59.50 fps");
    expect(fmt(null, "ms")).toBe("n/a");
    expect(fmt(NaN, "ms")).toBe("n/a");
  });
});

function results(ok: boolean, aa: "ts" | "wasm" | null = null): CompareResults {
  // An A/A pass fills each slot with a run of the one engine, as validate.test's aa() does.
  const runs = Array.from({ length: 6 }, (_, rep) => (["ts", "wasm"] as const).map((slot) => (aa ? { ...processRun(rep, aa, {}, slot === "wasm" ? 2 : 1), engine: slot, ranEngine: aa } : processRun(rep, slot, {}, slot === "wasm" ? 2 : 1)))).flat();
  const metrics = aggregate(runs, ["small"], [1], aa);
  return {
    schema: 1,
    generatedAt: "2026-10-13T00:00:00.000Z",
    issue: "maniator/verticopolis#972",
    config: config({ reps: 6, aa }),
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
    churn: [{ scenario: "small", saveChars: 1000, hours: 24, hourly: [], medianShare: 0.045, p95Share: 0.12, maxShare: 0.2, sections: { units: { saveShare: 0.9, medianChurn: 0.04 }, money: { saveShare: 0.01, medianChurn: 1 } } }],
    runs,
    bundle: null,
    metrics,
    comparisons: compareEngines(metrics, [], aa),
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
    expect(md).toContain("## Hourly save churn (WASM engine, Node)");
    expect(md).toContain("| small | 1000 | 24 | 4.5% | 12.0% | 20.0% | units 90.0% / 4.0%; money 1.0% / 100.0% |");
    expect(md).toContain("## Simulation only, engine as the app hosts it");
    expect(md).toMatch(/\| small \| 1x \| total for fixed duration \| 100 ms \| 200 ms \| 2\.00x \(2\.00 to 2\.00\) \| wasm slower \| 6\/6\/6 \|/);
    expect(md).toContain("ts: ts; wasm: ts");
    expect(md).toMatch(/No engine comparison for cold DOMContentLoaded, cold load event, warm DOMContentLoaded, warm load event: boot order differs between engines/);
    expect(md).toContain("- one machine");
    expect(markdownReport(results(true))).toContain("**Validation: passed.**");
    expect(md).not.toContain("A/A pass");
  });

  it("names what made the tree dirty", () => {
    const r = results(true);
    const md = markdownReport({ ...r, environment: { ...r.environment, dirty: true, tree: { porcelain: [" M a.ts", "?? b.ts"], diffSha256: "d".repeat(64), untracked: [{ path: "b.ts", sha256: "e".repeat(64) }], complete: true } } });
    expect(md).toContain(`| Working tree | status:  M a.ts; ?? b.ts; tracked changes SHA-256 ${"d".repeat(64)}; untracked: b.ts ${"e".repeat(64)} |`);
    expect(markdownReport(r)).not.toContain("Working tree |");
    // A clean record says so, which a harness without a record does not.
    expect(markdownReport({ ...r, environment: { ...r.environment, tree: { porcelain: [], diffSha256: null, untracked: [], complete: true } } })).toContain("| Working tree | clean (nothing outside docs/performance/results) |");
  });

  it("opens an A/A pass with a banner, slot-neutral wording and no verdicts", () => {
    const r = results(true, "wasm");
    const md = markdownReport(r);
    expect(md).toContain("**A/A pass.** Both slots ran the WASM engine.");
    expect(markdownReport(results(true, "ts"))).toContain("Both slots ran the TypeScript engine.");
    expect(md).toContain("# A/A pass: abc1234");
    expect(md).toContain("npm run perf:compare -- --aa wasm");
    expect(md).toMatch(/\| ts \(ran wasm\) \|/);
    expect(md).toContain("slot wasm / slot ts, paired (95% CI)");
    expect(md).not.toMatch(/\| verdict \||equivalent|outside band|wasm (faster|slower)|typescript median|wasm median|## wasm load steps|engine order/i);
    expect(md).not.toMatch(/No engine comparison/);
    expect(md).toContain("slot ts: ts; slot wasm: ts");
    expect(md).toContain("| Rep | Slot |");
    expect(md).toContain("one input to `npm run perf:calibrate`");
    expect(r.validation.errors).toEqual([]);
    expect(validateResults(r.config, r.runs, [{ ...r.nodeChecks[0], match: true }]).errors).toEqual([]);
    expect(summaryCsv(r.metrics, "wasm").split("\n")[1]).toMatch(/,wasm$/);
    expect(summaryCsv(r.metrics, "wasm").split("\n")[0]).toMatch(/,aa$/);
    expect(rawCsv(r.metrics, "ts").split("\n")[0]).toMatch(/,value,aa$/);
    expect(comparisonsCsv(r.comparisons, "ts").split("\n")[0]).toMatch(/,n_pairs,aa$/);
    expect(comparisonsCsv(r.comparisons, "wasm")).toMatch(/,A\/A,\d+,\d+,\d+,wasm/);
    expect(summaryCsv(r.metrics, null)).not.toMatch(/,aa\n/);
  });

  it("marks every file of an A/A folder, and none of a comparison folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "perf-aa-"));
    try {
      writeResultFiles(dir, results(true, "wasm"));
      expect(JSON.parse(readFileSync(join(dir, "results.json"), "utf8")).config.aa).toBe("wasm");
      for (const f of ["metrics.csv", "raw.csv", "comparisons.csv"]) expect(readFileSync(join(dir, f), "utf8").split("\n")[0]).toMatch(/,aa$/);
      expect(readFileSync(join(dir, "report.md"), "utf8")).toContain("**A/A pass.**");
      writeResultFiles(dir, results(true));
      for (const f of ["metrics.csv", "raw.csv", "comparisons.csv"]) expect(readFileSync(join(dir, f), "utf8").split("\n")[0]).not.toMatch(/,aa$/);
      expect(readFileSync(join(dir, "report.md"), "utf8")).not.toContain("A/A pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds an A/A limitations list without the two-engine caveats", () => {
    const wasm = buildLimitations("wasm", "2.29.6", ["SwiftShader"]).join("\n");
    const ts = buildLimitations("ts", "3.0.0", []).join("\n");
    const real = buildLimitations(null, "3.0.0", []).join("\n");
    for (const text of [wasm, ts]) expect(text).not.toMatch(/verdict needs six pairs|two engines' processes|slower engine simulates|Both engines run on the main thread|step driver/i);
    expect(wasm).toContain("An A/A pass: WASM ran in both slots");
    expect(wasm).toMatch(/WASM linear memory only grows/);
    expect(wasm).toMatch(/WASM attribution/);
    expect(ts).not.toMatch(/WASM linear memory only grows|WASM attribution/);
    expect(wasm).toContain("pre-3.0 baseline");
    expect(ts).not.toContain("pre-3.0 baseline");
    expect(wasm).toContain("WebGL renderer in these runs: SwiftShader.");
    expect(wasm).toContain("One machine and one headless browser build");
    expect(real).toMatch(/verdict needs six pairs/);
    expect(real).not.toContain("A/A pass");
  });

  it("writes CSVs with one row per metric, value and comparison", () => {
    const r = results(true);
    expect(summaryCsv(r.metrics, null).split("\n")[0]).toMatch(/^group,scenario,throttle,metric,unit,engine,n,median/);
    const raw = rawCsv(r.metrics, null).trim().split("\n");
    expect(raw.length - 1).toBe(r.metrics.reduce((s, m) => s + m.values.length, 0));
    expect(comparisonsCsv(r.comparisons, null).trim().split("\n").length - 1).toBe(r.comparisons.length);
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
