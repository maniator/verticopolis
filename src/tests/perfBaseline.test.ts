import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOCKING, budgetChecks, crossEngineLines, entryFromPasses, formatBaselineFile, gateChecks, harnessOf, hasReportedBudgets, measurementProblem, mintProblem, ownEntryLines, parseBaselineFile, passLines, passSpread, PERF_TOLERANCES, runAction, spreadLines, withBaseline, type EngineBaseline, type PerfMeasurement } from "./perfBaseline";

const measurement = (over: { medianMs?: number; p95Ms?: number; speed?: number; windows?: number } = {}): PerfMeasurement => ({
  uiUpdate: { n: 4000, batch: 40, medianMs: over.medianMs ?? 0.65, p95Ms: over.p95Ms ?? 1, meanMs: 0.68 },
  simSpeed: { simMinutesPerRealSecond: over.speed ?? 0.3, cpuThrottle: 4, speed: 120, windowMs: 4000, windows: over.windows ?? 5 },
});
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const entry = (engine: "ts" | "wasm", m = measurement()): EngineBaseline => ({ engine, ...m });

describe("the committed perf baseline (#900)", () => {
  const text = readFileSync(resolve(repoRoot, "e2e/perf/baseline.json"), "utf8");

  it("holds the TypeScript engine's entry, under its engine, with the numbers it was minted with", () => {
    const file = parseBaselineFile(text);
    expect(file.ts?.engine).toBe("ts");
    // The TypeScript entry is the approved gate, minted on the pre-E5 render
    // path. These pins are deliberate: a re-mint of it is the owner's call, and
    // it changes them in the same PR (update-perf-baseline.yml says so), so an
    // accidental [update-perf-baseline:ts] cannot land unnoticed.
    expect(file.ts?.uiUpdate.medianMs).toBe(0.65);
    expect(file.ts?.simSpeed.simMinutesPerRealSecond).toBe(0.2682030396348826);
  });

  it("holds a WASM entry of its own, and reads back byte for byte, so a mint diffs one entry", () => {
    const file = parseBaselineFile(text);
    expect(file.wasm?.engine).toBe("wasm");
    expect(harnessOf(file.wasm!)).toEqual(harnessOf(file.ts!));
    expect(formatBaselineFile(file)).toBe(text);
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
    expect(() => parseBaselineFile(JSON.stringify({ wasm: measurement() }))).toThrow(/"wasm" entry records no engine; re-mint it/);
    expect(() => parseBaselineFile("[]")).toThrow(/keyed by engine/);
  });

  it("refuses an entry that cannot gate: a missing part, or a value that is zero, missing or not a number", () => {
    const zeroSpeed = entry("wasm", measurement({ speed: 0 }));
    expect(() => parseBaselineFile(JSON.stringify({ wasm: zeroSpeed }))).toThrow(/"wasm" entry cannot gate: its simSpeed\.simMinutesPerRealSecond is 0.*remove it and re-mint it with \[update-perf-baseline:wasm\]/);
    expect(() => parseBaselineFile(JSON.stringify({ wasm: { engine: "wasm" } }))).toThrow(/cannot gate: it has no uiUpdate/);
    const { simSpeed: _speed, ...noSpeed } = entry("ts");
    expect(() => parseBaselineFile(JSON.stringify({ ts: noSpeed }))).toThrow(/cannot gate: it has no simSpeed/);
    const nulled = entry("ts");
    nulled.uiUpdate.medianMs = Number.NaN; // JSON writes it as null
    expect(() => parseBaselineFile(JSON.stringify({ ts: nulled }))).toThrow(/its uiUpdate\.medianMs is null/);
    expect(() => parseBaselineFile(JSON.stringify({ ts: { ...entry("ts"), uiUpdate: { ...entry("ts").uiUpdate, p95Ms: "1" } } }))).toThrow(/its uiUpdate\.p95Ms is "1"/);
    expect(() => parseBaselineFile(JSON.stringify({ ts: entry("ts", measurement({ windows: 0 })) }))).toThrow(/its simSpeed\.windows is 0/);
    // A malformed TypeScript entry fails the WASM run too: the whole file is read.
    expect(() => parseBaselineFile(JSON.stringify({ ts: noSpeed, wasm: entry("wasm") }))).toThrow(/"ts" entry cannot gate/);
  });
});

describe("measurementProblem", () => {
  it("lets one pass of a mint read zero, never its harness parameters", () => {
    expect(measurementProblem(measurement({ speed: 0 }))).toMatch(/simMinutesPerRealSecond is 0/);
    expect(measurementProblem(measurement({ speed: 0 }), { pass: true })).toBeNull();
    expect(measurementProblem(measurement({ windows: 0 }), { pass: true })).toMatch(/simSpeed\.windows is 0/);
    expect(measurementProblem(null)).toMatch(/not an object/);
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

describe("gateChecks and ownEntryLines", () => {
  const base = measurement({ medianMs: 1, p95Ms: 2, speed: 10 });
  const slow = measurement({ medianMs: 1.06, p95Ms: 2.21, speed: 0 });

  it("blocks the TypeScript engine on all three budgets, and the WASM engine on ui.update only until the owner's call on M7", () => {
    expect(BLOCKING).toEqual({ ts: ["ui.update median", "ui.update p95", "sim speed"], wasm: ["ui.update median", "ui.update p95"] });
    expect(gateChecks(slow, base, "ts").map((c) => [c.label, c.ok])).toEqual([
      ["ui.update median", false],
      ["ui.update p95", false],
      ["sim speed", false],
    ]);
    expect(gateChecks(slow, base, "wasm").map((c) => [c.label, c.ok])).toEqual([
      ["ui.update median", false],
      ["ui.update p95", false],
    ]);
    // A WASM speed reading of zero fails nothing.
    expect(gateChecks(measurement({ medianMs: 1, p95Ms: 2, speed: 0 }), base, "wasm").every((c) => c.ok)).toBe(true);
    expect([hasReportedBudgets("ts"), hasReportedBudgets("wasm")]).toEqual([false, true]);
  });

  it("prints every budget against the engine's own entry, marked blocking or reported", () => {
    expect(ownEntryLines("wasm", slow, base)).toEqual([
      "perf wasm against its own entry (a reported budget gates nothing until M7's calibration):",
      "  outside (blocking): ui.update median 1.0600ms vs baseline 1.0000ms (x1.05)",
      "  outside (blocking): ui.update p95 2.2100ms vs baseline 2.0000ms (x1.1)",
      "  outside (reported): sim-min/s 0.00 vs baseline 10.00 (x0.9)",
    ]);
  });
});

describe("runAction", () => {
  it("captures only when asked, fails a missing entry on CI, and compares only on CI", () => {
    const at = (capture: boolean, enforce: boolean, hasEntry: boolean) => runAction({ capture, enforce, hasEntry });
    expect(at(true, true, true)).toBe("capture");
    expect(at(true, false, false)).toBe("capture");
    expect(at(false, true, false)).toBe("fail-missing");
    expect(at(false, true, true)).toBe("gate");
    // A plain local run writes nothing, with or without an entry.
    expect(at(false, false, false)).toBe("report-missing");
    expect(at(false, false, true)).toBe("report");
  });
});

describe("crossEngineLines", () => {
  it("reads a WASM run against the TypeScript entry, gating nothing", () => {
    const lines = crossEngineLines(measurement({ medianMs: 0.7 }), { ts: entry("ts"), wasm: entry("wasm") });
    expect(lines[0]).toMatch(/^M7, the WASM run against the TypeScript baseline \(provisional, reported, gates nothing\):$/);
    expect(lines[1]).toMatch(/^ {2}note: tolerances not yet calibrated under the δ cap; the TypeScript tower is built in place and the WASM tower through a loaded save \(#905\)/);
    expect(lines.slice(2)).toEqual([
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

  it("gives the same entry whatever order the passes are read in", () => {
    const passes = [pass(1, 0.5), pass(3, 0.4), pass(2, 0.6), pass(9, 0), pass(2.5, 0.45)];
    const want = JSON.stringify(entryFromPasses("wasm", passes));
    for (const order of [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 4, 0, 3, 2]]) expect(JSON.stringify(entryFromPasses("wasm", order.map((i) => passes[i])))).toBe(want);
  });

  it("refuses a pass that is not a complete measurement, and keeps one that read zero", () => {
    const nulled = pass(1, 0.5);
    nulled.uiUpdate.p95Ms = null as unknown as number;
    expect(() => entryFromPasses("wasm", [pass(1, 0.5), nulled, pass(1, 0.5)])).toThrow(/wasm pass 2 is not a complete measurement: its uiUpdate\.p95Ms is null/);
    const { simSpeed: _speed, ...partial } = pass(1, 0.5);
    expect(() => entryFromPasses("wasm", [partial as EngineBaseline])).toThrow(/pass 1 is not a complete measurement: it has no simSpeed/);
    expect(entryFromPasses("wasm", [pass(1, 0), pass(1, 0.5), pass(1, 0.5)]).simSpeed.simMinutesPerRealSecond).toBe(0.5);
  });

  it("refuses no passes, another engine's pass, mixed harness parameters, and a median sim speed of zero", () => {
    expect(() => entryFromPasses("wasm", [])).toThrow(/no wasm passes/);
    expect(() => entryFromPasses("wasm", [pass(1, 0.5), entry("ts")])).toThrow(/recorded the engine "ts"/);
    expect(() => entryFromPasses("wasm", [pass(1, 0.5), entry("wasm", measurement({ windows: 3 }))])).toThrow(/different harness parameters/);
    expect(() => entryFromPasses("wasm", [pass(1, 0), pass(1, 0), pass(1, 0.5)])).toThrow(/median entry that cannot gate: its simSpeed\.simMinutesPerRealSecond is 0/);
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
    expect(text).toContain("Within-run spread of the ts mint (each pass against the median of all 3, one runner):");
    expect(text).toContain("| sim speed | x0.9 | x0.000 | 1 of 3 |");
  });
});

describe("passLines", () => {
  it("lists every pass, including one that would be refused", () => {
    expect(passLines("wasm", [measurement({ medianMs: 1.4 }), { uiUpdate: { medianMs: null } }, null])).toEqual([
      "The wasm passes:",
      "",
      "| Pass | ui.update median ms | ui.update p95 ms | sim-min/s |",
      "| --- | --- | --- | --- |",
      "| 1 | 1.4 | 1 | 0.3 |",
      "| 2 | null | null | null |",
      "| 3 | null | null | null |",
    ]);
  });
});
