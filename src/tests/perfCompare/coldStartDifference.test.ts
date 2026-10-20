import { describe, expect, it } from "vitest";
import { coldStartDifference } from "./calibrate";
import { coldStartDifferenceLines } from "./report";
import type { EngineName, MetricRow } from "./types";

const row = (engine: EngineName, throttle: string, values: number[], reps = values.map((_, i) => i)): MetricRow => ({
  group: "startup",
  scenario: "-",
  throttle,
  metric: "cold game ready",
  unit: "ms",
  better: "lower",
  engine,
  values,
  reps,
  summary: null,
});

describe("coldStartDifferenceLines", () => {
  it("prints the median and interval of wasm minus ts per throttle, the statistic perf:calibrate reads", () => {
    // Differences 0 to 9 at 1x: median 4.5, interval x(2) to x(9) = 1 to 8; the gate's value is the 8.
    const metrics = [
      row("ts", "1", Array(10).fill(1000)),
      row("wasm", "1", Array.from({ length: 10 }, (_, i) => 1000 + i)),
      row("ts", "4", Array(10).fill(3000)),
      row("wasm", "4", Array(10).fill(2990)),
    ];
    const text = coldStartDifferenceLines(metrics, null).join("\n");
    expect(text).toContain("paired difference (WASM minus TypeScript; above zero is worse)");
    expect(text).toContain("| 1x | 4.50 ms | 1.00 ms to 8.00 ms | 10 |");
    expect(text).toContain("| 4x | -10.00 ms | -10.00 ms to -10.00 ms | 10 |");
    expect(coldStartDifference({ metrics }, "1")).toBe(8);
  });

  it("names the slots in an A/A folder", () => {
    const metrics = [row("ts", "1", Array(10).fill(10)), row("wasm", "1", Array(10).fill(11))];
    expect(coldStartDifferenceLines(metrics, "ts").join("\n")).toContain("(slot wasm minus slot ts;");
  });

  it("pairs by repetition number and marks a row under the gate's minimum", () => {
    const metrics = [row("ts", "1", [10, 20, 30], [0, 1, 2]), row("wasm", "1", [31, 11, 99], [2, 0, 7])];
    const text = coldStartDifferenceLines(metrics, null).join("\n");
    expect(text).toContain("| 1x | 1.00 ms | no interval | 2 (below the gate's minimum of 10) |");
    expect(coldStartDifference({ metrics }, "1")).toBeNull();
  });

  it("leaves a row with a damaged value without a statistic, thin or not, instead of throwing", () => {
    // A results file writes NaN as null, so the rows go through JSON as they would on disk.
    const disk = (rows: MetricRow[]): MetricRow[] => JSON.parse(JSON.stringify(rows));
    const thin = disk([row("ts", "1", [10, 20, 30]), row("wasm", "1", [11, Number.NaN, 31])]);
    expect(coldStartDifferenceLines(thin, null)).toEqual([]);
    expect(coldStartDifference({ metrics: thin }, "1")).toBeNull();
    const full = disk([row("ts", "1", Array(10).fill(10)), row("wasm", "1", [...Array(9).fill(11), Number.NaN])]);
    expect(full[1].values[9]).toBeNull();
    expect(coldStartDifferenceLines(full, null)).toEqual([]);
    expect(coldStartDifference({ metrics: full }, "1")).toBeNull();
  });

  it("prints nothing when a side is missing or nothing pairs", () => {
    expect(coldStartDifferenceLines([row("ts", "1", [1, 2])], null)).toEqual([]);
    expect(coldStartDifferenceLines([row("ts", "1", [1], [0]), row("wasm", "1", [1], [9])], null)).toEqual([]);
  });
});
