import { describe, expect, it } from "vitest";
import { processRun, startupSample } from "./fixtures";
import { aggregate, REPORTED_DIFFERENCES, SAVED_READY, SAVED_SPLIT } from "./metrics";
import { coldStartDifferenceLines, reportedDifferenceLines } from "./report";
import type { EngineName, MetricRow } from "./types";

const row = (engine: EngineName, metric: string, scenario: string, values: number[]): MetricRow => ({
  group: "startup",
  scenario,
  throttle: "1",
  metric,
  unit: "ms",
  better: "lower",
  engine,
  values,
  reps: values.map((_, i) => i),
  summary: null,
});

const runs = () => Array.from({ length: 10 }, (_, rep) => [processRun(rep, "ts"), processRun(rep, "wasm")]).flat();

describe("the engine-loaded split and the saved-tower rows (#1254)", () => {
  it("splits each start where the engine loaded and keeps both engine-specific spans out of the verdicts", () => {
    const rows = aggregate(runs(), ["small"], [1, 4], null);
    const get = (metric: string, engine: EngineName, throttle = "1") => rows.find((r) => r.metric === metric && r.engine === engine && r.throttle === throttle)!;
    // The fixture: ready at 300 ms, loaded at 150 (WASM) and 40 (TypeScript).
    expect(get("cold loaded to ready", "wasm").values[0]).toBe(150);
    expect(get("cold loaded to ready", "ts").values[0]).toBe(260);
    expect(get("warm loaded to ready", "wasm").values).toHaveLength(10);
    expect(get("cold loaded to ready", "wasm", "4").values[0]).toBe(1050);
    expect(get("cold engine loaded", "wasm").noVerdict).toMatch(/^boot order/);
    expect(get("cold loaded to ready", "wasm").noVerdict).toMatch(/^the span covers different work on each engine/);
    expect(get(SAVED_SPLIT, "wasm").noVerdict).toMatch(/^the span covers different work/);
    expect(get(SAVED_READY, "wasm").noVerdict).toBeUndefined();
    // Both slots of an A/A pass ran one engine, so the engine caveats go.
    const aa = aggregate(runs(), ["small"], [1], "ts");
    for (const metric of ["cold engine loaded", "cold loaded to ready", SAVED_SPLIT]) {
      const r = aa.find((x) => x.metric === metric);
      expect(r, metric).toBeDefined();
      expect(r?.noVerdict, metric).toBeUndefined();
    }
  });

  it("leaves the split empty when the mark came after ready", () => {
    const late = runs().map((r) => ({ ...r, cold: startupSample(r.engine, { engineLoadedMs: 400 }) }));
    expect(aggregate(late, ["small"], [1], null).find((r) => r.metric === "cold loaded to ready")?.values).toEqual([]);
  });

  it("reports the cold start with each scenario's save, at 1x, per scenario, from checked samples only", () => {
    const rows = aggregate(runs(), ["small"], [1, 4], null);
    const saved = rows.filter((r) => r.metric === SAVED_READY);
    expect(saved.map((r) => [r.scenario, r.throttle, r.engine])).toEqual([["small", "1", "ts"], ["small", "1", "wasm"]]);
    expect(saved[0].values).toEqual(Array(10).fill(600));
    expect(rows.find((r) => r.metric === SAVED_SPLIT && r.engine === "wasm")!.values[0]).toBe(450);
    // A start whose checks failed has no sample and adds nothing.
    const failed = runs().map((r) => (r.rep === 0 ? { ...r, coldSaved: { small: { ...r.coldSaved!.small, sample: null, error: "x" } } } : r));
    expect(aggregate(failed, ["small"], [1], null).find((r) => r.metric === SAVED_READY)?.reps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // A run from before the rows existed leaves them empty instead of failing.
    const old = runs().map((r) => ({ ...r, coldSaved: undefined, cold: r.cold && { ...r.cold, engineLoadedMs: undefined } }));
    const oldRows = aggregate(old, ["small"], [1], null);
    expect(oldRows.find((r) => r.metric === SAVED_READY)?.values).toEqual([]);
    expect(oldRows.find((r) => r.metric === "cold loaded to ready")?.values).toEqual([]);
  });

  it("names only rows that exist, so a renamed row cannot drop out of the report", () => {
    const names = new Set(aggregate(runs(), ["small"], [1, 4], null).map((r) => r.metric));
    for (const name of REPORTED_DIFFERENCES) expect(names.has(name), name).toBe(true);
    expect(REPORTED_DIFFERENCES).not.toContain("cold game ready");
  });

  it("prints the reported rows with M5's statistic, apart from M5's own lines", () => {
    const metrics = [
      row("ts", "warm game ready", "-", Array(10).fill(70)),
      row("wasm", "warm game ready", "-", Array.from({ length: 10 }, (_, i) => 80 + i)),
      row("ts", SAVED_READY, "medium", Array(10).fill(460)),
      row("wasm", SAVED_READY, "medium", Array(10).fill(690)),
      row("ts", "cold game ready", "-", Array(10).fill(400)),
      row("wasm", "cold game ready", "-", Array(10).fill(470)),
      row("ts", "cold engine loaded", "-", [40, 40, 40]),
      row("wasm", "cold engine loaded", "-", [150, 150, 150]),
    ];
    const text = reportedDifferenceLines(metrics, null).join("\n");
    expect(text).toContain("Reported, not gates (#1254)");
    expect(text).toContain("| warm game ready | - | 1x | 14.50 ms | 11.00 ms to 18.00 ms | 10 |");
    expect(text).toContain("| cold game ready (saved tower) | medium | 1x | 230 ms | 230 ms to 230 ms | 10 |");
    expect(text).toContain("| cold engine loaded | - | 1x | 110 ms | no interval | 3 (below the gate's minimum of 10) |");
    // M5's own row stays in M5's lines only, and M5 never reads a saved-tower row.
    expect(text).not.toMatch(/\| cold game ready \|/);
    const m5 = coldStartDifferenceLines(metrics, null).join("\n");
    expect(m5).toContain("| 1x | 70.00 ms | 70.00 ms to 70.00 ms | 10 |");
    expect(m5).not.toContain("230 ms");
    expect(m5.match(/^\| 1x \|/gm)).toHaveLength(1);
    expect(reportedDifferenceLines(metrics, "ts").join("\n")).toContain("slot wasm minus slot ts");
  });

  it("prints nothing when no reported row pairs", () => {
    expect(reportedDifferenceLines([row("ts", "warm game ready", "-", [1, 2])], null)).toEqual([]);
    expect(reportedDifferenceLines([], null)).toEqual([]);
  });
});
