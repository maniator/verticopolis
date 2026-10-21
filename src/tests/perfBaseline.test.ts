import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { budgetChecks, crossEngineLines, entryFromPasses, formatBaselineFile, harnessOf, mintProblem, parseBaselineFile, passSpread, PERF_TOLERANCES, spreadLines, withBaseline, type EngineBaseline, type PerfMeasurement } from "./perfBaseline";

const measurement = (over: { medianMs?: number; p95Ms?: number; speed?: number; windows?: number } = {}): PerfMeasurement => ({
  uiUpdate: { n: 4000, batch: 40, medianMs: over.medianMs ?? 0.65, p95Ms: over.p95Ms ?? 1, meanMs: 0.68 },
  simSpeed: { simMinutesPerRealSecond: over.speed ?? 0.3, cpuThrottle: 4, speed: 120, windowMs: 4000, windows: over.windows ?? 5 },
});
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const entry = (engine: "ts" | "wasm", m = measurement()): EngineBaseline => ({ engine, ...m });

describe("the committed perf baseline (#900)", () => {
  it("holds the TypeScript engine's entry, under its engine, with the numbers it was minted with", () => {
    const file = parseBaselineFile(readFileSync(resolve(repoRoot, "e2e/perf/baseline.json"), "utf8"));
    expect(file.ts?.engine).toBe("ts");
    expect(file.ts?.uiUpdate.medianMs).toBe(0.65);
    expect(file.ts?.simSpeed.simMinutesPerRealSecond).toBe(0.2682030396348826);
  });
});

describe("parseBaselineFile", () => {
  it("reads an entry per engine", () => {
    const file = parseBaselineFile(formatBaselineFile({ ts: entry("ts"), wasm: entry("wasm") }));
    expect(Object.keys(file)).toEqual(["ts", "wasm"]);
  });

  it("refuses the file from before #900, a key that is no engine, and an entry that records another engine", () => {
    expect(() => parseBaselineFile(JSON.stringify(measurement()))).toThrow(/no engine keys/);
    expect(() => parseBaselineFile(JSON.stringify({ rust: entry("wasm") }))).toThrow(/"rust", which is not an engine/);
    expect(() => parseBaselineFile(JSON.stringify({ wasm: entry("ts") }))).toThrow(/"wasm" entry records the engine "ts"; re-mint it with \[update-perf-baseline:wasm\]/);
    expect(() => parseBaselineFile(JSON.stringify({ wasm: measurement() }))).toThrow(/records the engine undefined/);
    expect(() => parseBaselineFile("[]")).toThrow(/keyed by engine/);
  });
});

describe("withBaseline", () => {
  it("writes one engine's entry and keeps the other's exactly, in engine order", () => {
    const ts = entry("ts", measurement({ medianMs: 0.6851750000000102 }));
    const text = formatBaselineFile({ ts });
    const next = formatBaselineFile(withBaseline(parseBaselineFile(text), entry("wasm", measurement({ medianMs: 0.9 }))));
    expect(Object.keys(JSON.parse(next) as object)).toEqual(["ts", "wasm"]);
    expect(JSON.stringify(parseBaselineFile(next).ts)).toBe(JSON.stringify(ts));
    // Writing the first engine after the second keeps the order too.
    expect(Object.keys(withBaseline({ wasm: entry("wasm") }, ts))).toEqual(["ts", "wasm"]);
  });
});

describe("mintProblem", () => {
  it("accepts a mint that wrote its engine and kept the other", () => {
    const before = { ts: entry("ts") };
    expect(mintProblem(before, withBaseline(before, entry("wasm")), "wasm")).toBeNull();
    expect(mintProblem({}, { ts: entry("ts") }, "ts")).toBeNull();
  });

  it("refuses a mint that wrote nothing for its engine or changed another engine's entry", () => {
    const before = { ts: entry("ts") };
    expect(mintProblem(before, before, "wasm")).toMatch(/wrote no "wasm" entry/);
    expect(mintProblem(before, { ts: entry("ts", measurement({ medianMs: 0.7 })), wasm: entry("wasm") }, "wasm")).toMatch(/changed the committed "ts" entry/);
    expect(mintProblem(before, { wasm: entry("wasm") }, "wasm")).toMatch(/changed the committed "ts" entry/);
  });
});

describe("budgetChecks", () => {
  it("applies the gate's tolerances, at their boundaries", () => {
    const base = measurement({ medianMs: 1, p95Ms: 2, speed: 10 });
    expect(budgetChecks(measurement({ medianMs: 1.05, p95Ms: 2.2, speed: 9 }), base).map((c) => c.ok)).toEqual([true, true, true]);
    expect(budgetChecks(measurement({ medianMs: 1.06, p95Ms: 2.21, speed: 8.9 }), base).map((c) => c.ok)).toEqual([false, false, false]);
    expect(PERF_TOLERANCES).toEqual({ uiMedian: 1.05, uiP95: 1.1, simSpeedFloor: 0.9 });
  });

  it("keeps the gate's messages", () => {
    const [median, p95, speed] = budgetChecks(measurement({ medianMs: 0.7 }), measurement());
    expect(median.message).toBe("ui.update median 0.7000ms vs baseline 0.6500ms (x1.05)");
    expect(p95.message).toBe("ui.update p95 1.0000ms vs baseline 1.0000ms (x1.1)");
    expect(speed.message).toBe("sim-min/s 0.30 vs baseline 0.30 (x0.9)");
  });
});

describe("crossEngineLines", () => {
  it("reads a WASM run against the TypeScript entry, gating nothing", () => {
    const lines = crossEngineLines(measurement({ medianMs: 0.7 }), { ts: entry("ts"), wasm: entry("wasm") });
    expect(lines[0]).toMatch(/^M7, the WASM run against the TypeScript baseline \(reported, gates nothing\):$/);
    expect(lines.slice(1)).toEqual([
      "  outside: ui.update median 0.7000ms vs baseline 0.6500ms (x1.05)",
      "  within: ui.update p95 1.0000ms vs baseline 1.0000ms (x1.1)",
      "  within: sim-min/s 0.30 vs baseline 0.30 (x0.9)",
    ]);
  });

  it("says so when there is no TypeScript entry or it was minted with other harness parameters", () => {
    expect(crossEngineLines(measurement(), { wasm: entry("wasm") })).toEqual([expect.stringMatching(/no TypeScript entry to read against$/)]);
    const other = crossEngineLines(measurement({ windows: 3 }), { ts: entry("ts") });
    expect(other).toHaveLength(1);
    expect(other[0]).toMatch(/not comparable/);
    expect(harnessOf(measurement())).toEqual({ n: 4000, batch: 40, cpuThrottle: 4, speed: 120, windowMs: 4000, windows: 5 });
  });
});

describe("entryFromPasses", () => {
  const pass = (medianMs: number, speed: number) => entry("wasm", measurement({ medianMs, p95Ms: medianMs * 2, speed }));

  it("takes each value's median across the passes and keeps the harness parameters", () => {
    const e = entryFromPasses("wasm", [pass(1, 0.5), pass(3, 0.4), pass(2, 0.6), pass(9, 0), pass(2.5, 0.45)]);
    expect(e.engine).toBe("wasm");
    expect(e.uiUpdate.medianMs).toBe(2.5);
    expect(e.uiUpdate.p95Ms).toBe(5);
    expect(e.simSpeed.simMinutesPerRealSecond).toBe(0.45);
    expect(harnessOf(e)).toEqual(harnessOf(measurement()));
    expect(Object.keys(e.uiUpdate)).toEqual(["n", "batch", "medianMs", "p95Ms", "meanMs"]);
    // An even count averages the middle two.
    expect(entryFromPasses("wasm", [pass(1, 0.2), pass(2, 0.4)]).uiUpdate.medianMs).toBe(1.5);
  });

  it("refuses no passes, another engine's pass, mixed harness parameters, and a median sim speed of zero", () => {
    expect(() => entryFromPasses("wasm", [])).toThrow(/no wasm passes/);
    expect(() => entryFromPasses("wasm", [pass(1, 0.5), entry("ts")])).toThrow(/recorded the engine "ts"/);
    expect(() => entryFromPasses("wasm", [pass(1, 0.5), entry("wasm", measurement({ windows: 3 }))])).toThrow(/different harness parameters/);
    expect(() => entryFromPasses("wasm", [pass(1, 0), pass(1, 0), pass(1, 0.5)])).toThrow(/zero or not a number/);
  });
});

describe("passSpread", () => {
  it("holds each pass to the median entry as the gate would, and names the worst pass", () => {
    const passes = [measurement({ medianMs: 1, p95Ms: 2, speed: 0.5 }), measurement({ medianMs: 1.1, p95Ms: 2, speed: 0 }), measurement({ medianMs: 0.9, p95Ms: 2.1, speed: 0.48 })];
    const e = entryFromPasses("ts", passes.map((p) => ({ engine: "ts" as const, ...p })));
    const spread = passSpread(passes, e);
    expect(spread.map((s) => [s.label, s.outside, s.passes])).toEqual([
      ["ui.update median", 1, 3],
      ["ui.update p95", 0, 3],
      ["sim speed", 1, 3],
    ]);
    expect(spread[0].worst).toBeCloseTo(1.1);
    expect(spread[2].worst).toBe(0);
    const text = spreadLines("ts", spread).join("\n");
    expect(text).toContain("A/A reading of the ts mint (each pass against the median of all 3):");
    expect(text).toContain("| sim speed | x0.9 | x0.000 | 1 of 3 |");
  });
});
