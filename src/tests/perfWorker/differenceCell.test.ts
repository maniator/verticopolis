import { describe, expect, it } from "vitest";
import { pairedDifferences } from "../perfCompare/stats";
import type { Metric } from "./analysis";
import { differenceCell } from "./report";

const metric = (mode: "ts" | "wasm", values: number[], reps = values.map((_, i) => i)): Metric => ({
  group: "frames",
  scenario: "large",
  throttle: "1",
  metric: "main-thread blocking (long tasks past 50 ms)",
  unit: "ms",
  better: "lower",
  mode,
  values,
  reps,
  summary: null,
});

describe("differenceCell", () => {
  it("prints the median of wasm minus ts with the 95% interval of the median", () => {
    // Differences 0 to 9: median 4.5, interval x(2) to x(9) = 1 to 8.
    const ts = metric("ts", Array(10).fill(100));
    const wasm = metric("wasm", Array.from({ length: 10 }, (_, i) => 100 + i));
    expect(differenceCell(wasm, ts)).toBe("4.50 [1.00, 8.00], 10 pairs (wasm minus ts)");
    expect(differenceCell(wasm, ts, true)).toContain("(slot wasm minus slot ts)");
  });

  it("reads a negative difference as WASM blocking less, and keeps the sign", () => {
    const ts = metric("ts", Array(10).fill(120));
    const wasm = metric("wasm", Array(10).fill(100));
    expect(differenceCell(wasm, ts)).toBe("-20.0 [-20.0, -20.0], 10 pairs (wasm minus ts)");
  });

  it("pairs by repetition number, not by position, and drops an unpaired repetition", () => {
    const ts = metric("ts", [10, 20, 30], [0, 1, 2]);
    const wasm = metric("wasm", [31, 11, 99], [2, 0, 7]);
    expect(pairedDifferences(wasm, ts)).toEqual([1, 1]);
    expect(differenceCell(wasm, ts)).toBe("1.00 (no interval), 2 pairs (wasm minus ts)");
  });

  it("says n/a when a side is missing or nothing pairs", () => {
    const ts = metric("ts", [1, 2]);
    expect(differenceCell(undefined, ts)).toBe("n/a");
    expect(differenceCell(ts, undefined)).toBe("n/a");
    expect(differenceCell(metric("wasm", [1], [9]), ts)).toBe("n/a");
  });
});
