import { describe, expect, it } from "vitest";
// The report generator is a dependency-free Node script (see
// scripts/analytics-report.mjs). Its pure helpers are exported so the depth
// math the HTML/summary lean on can be pinned here without a live Vercel query.
import { percentiles, bucketSeconds, parseWindow } from "../scripts/analytics-report.mjs";

/** Shape an aggregate result the way the Vercel query normalizes it: rows of
 *  { key: value, count } sorted however, since percentiles re-sorts by value. */
function agg(pairs: [number | string, number][], truncated = false) {
  return { ok: true, truncated, rows: pairs.map(([key, count]) => ({ key: String(key), count })) };
}

describe("percentiles (per-session depth histogram)", () => {
  it("computes nearest-rank p50 / p90 / max from a value histogram", () => {
    // builds -> sessions: 210@2, 180@5, 140@11, 90@24, 40@60, 12@140 (N=672).
    const p = percentiles(agg([[2, 210], [5, 180], [11, 140], [24, 90], [60, 40], [140, 12]]), [0.5, 0.9]);
    expect(p).not.toBeNull();
    expect(p!.samples).toBe(672);
    expect(p!.values).toEqual([5, 24]); // ceil(.5*672)=336 lands in the 5 bucket; ceil(.9*672)=605 in the 24 bucket
    expect(p!.max).toBe(140);
    expect(p!.truncated).toBe(false);
  });

  it("orders by value, not by frequency, so a common small value can't outrank a rare large one", () => {
    // The most frequent value (1) is the smallest; the max must still be 50.
    const p = percentiles(agg([[50, 1], [1, 999]]), [0.5]);
    expect(p!.max).toBe(50);
    expect(p!.values).toEqual([1]);
  });

  it("handles negative values (basement-only peak floors)", () => {
    const p = percentiles(agg([[-6, 10], [-2, 30], [3, 20]]), [0.5, 0.9]);
    expect(p!.values).toEqual([-2, 3]); // ceil(.5*60)=30 -> -2; ceil(.9*60)=54 -> 3
    expect(p!.max).toBe(3);
  });

  it("skips non-numeric and zero-weight groups instead of misplacing them", () => {
    const p = percentiles(agg([["(none)", 500], [4, 10], [8, 10]]), [0.5]);
    expect(p!.samples).toBe(20); // the "(none)" bucket is dropped, not counted
    expect(p!.values).toEqual([4]);
  });

  it("drops blank and whitespace keys instead of coercing them to zero", () => {
    // Number("") and Number("  ") are both 0; those must not become value-0
    // samples that drag the median down.
    const p = percentiles(agg([["", 900], ["   ", 100], [6, 5], [10, 5]]), [0.5]);
    expect(p!.samples).toBe(10);
    expect(p!.values).toEqual([6]);
  });

  it("carries the truncation flag through so the report can mark it approximate", () => {
    const p = percentiles(agg([[1, 5], [2, 5]], true), [0.9]);
    expect(p!.truncated).toBe(true);
  });

  it("returns null when there is no usable sample", () => {
    expect(percentiles({ ok: true, rows: [] }, [0.5])).toBeNull();
    expect(percentiles({ ok: true, rows: [{ key: "x", count: 3 }] }, [0.5])).toBeNull();
    expect(percentiles({ ok: false, hint: "forbidden", rows: null }, [0.5])).toBeNull();
  });
});

describe("bucketSeconds (session-length buckets)", () => {
  it("buckets by threshold and ignores unparseable groups", () => {
    const b = bucketSeconds(agg([[12, 3], [45, 4], [90, 2], [300, 5], [700, 1], ["n/a", 9]]));
    expect(b).toEqual({ "0-30s": 3, "30s-2m": 6, "2-10m": 5, "10m+": 1 });
  });
});

describe("parseWindow (look-back parser)", () => {
  // The full parser behavior is pinned in src/posthog-report.test.ts; this
  // copy pins that the Vercel script's duplicate stays in sync on the cases
  // that used to differ (silent 30-day default vs loud failure).
  it("reads plain day counts and unit suffixes", () => {
    expect(parseWindow("30")).toEqual({ hours: 720, label: "30 days" });
    expect(parseWindow("0.5")).toEqual({ hours: 12, label: "12 hours" });
    expect(parseWindow("12h")).toEqual({ hours: 12, label: "12 hours" });
    expect(parseWindow("3d")).toEqual({ hours: 72, label: "3 days" });
  });

  it("throws on invalid or out-of-bounds values instead of silently defaulting", () => {
    expect(() => parseWindow("nonsense")).toThrow(/Invalid look-back window/);
    expect(() => parseWindow("0")).toThrow(/shorter than 1 hour/);
    expect(() => parseWindow("-5")).toThrow(/Invalid look-back window/);
    expect(() => parseWindow("1000")).toThrow(/longer than 365 days/);
  });
});
