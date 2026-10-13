import { describe, expect, it } from "vitest";
import { binomialHalfCdf, frameStats, mean, medianCiRanks, quantile, ratioOfMedians, sampleSd, seededRandom, summarize, verdict } from "./stats";

describe("quantile", () => {
  it("interpolates linearly between order statistics (type 7)", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([4, 1, 3, 2], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantile([10], 0.99)).toBe(10);
    expect(quantile([0, 10], 0.95)).toBeCloseTo(9.5, 12);
    expect(quantile([1, 2, 3], 0)).toBe(1);
    expect(quantile([1, 2, 3], 1)).toBe(3);
  });
  it("refuses empty samples, non-finite values and a q outside 0..1", () => {
    expect(() => quantile([], 0.5)).toThrow(/empty/);
    expect(() => quantile([1, NaN], 0.5)).toThrow(/non-finite/);
    expect(() => quantile([1], 1.5)).toThrow(/outside/);
    expect(() => quantile([1], NaN)).toThrow(/outside/);
  });
});

describe("mean and sd", () => {
  it("computes the mean and the n - 1 standard deviation", () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138089935, 8);
    expect(sampleSd([3])).toBe(0);
  });
  it("refuses an empty or non-finite sample", () => {
    expect(() => mean([])).toThrow(/empty/);
    expect(() => mean([1, Infinity])).toThrow(/non-finite/);
  });
});

describe("the median's order-statistic interval", () => {
  it("matches the published binomial table", () => {
    // n = 10: ranks 2 and 9 cover 97.85%; ranks 3 and 8 cover only 89%.
    expect(medianCiRanks(10)).toEqual({ lo: 2, hi: 9 });
    expect(1 - 2 * binomialHalfCdf(10, 1)).toBeCloseTo(0.978515625, 9);
    // n = 20: ranks 6 and 15 (95.86%).
    expect(medianCiRanks(20)).toEqual({ lo: 6, hi: 15 });
    // n = 6 is the smallest sample with a 95% pair (the full range, 96.9%).
    expect(medianCiRanks(6)).toEqual({ lo: 1, hi: 6 });
    expect(medianCiRanks(5)).toBeNull();
  });
  it("has binomial tails at the edges", () => {
    expect(binomialHalfCdf(4, -1)).toBe(0);
    expect(binomialHalfCdf(4, 4)).toBe(1);
    expect(binomialHalfCdf(4, 0)).toBeCloseTo(1 / 16, 12);
  });
});

describe("summarize", () => {
  it("reports every field and the median interval from the sorted sample", () => {
    const s = summarize([10, 1, 9, 2, 8, 3, 7, 4, 6, 5]);
    expect(s).toMatchObject({ n: 10, min: 1, max: 10, mean: 5.5, median: 5.5, medianCiLow: 2, medianCiHigh: 9 });
    expect(s.p95).toBeCloseTo(9.55, 12);
    expect(s.cv).toBeCloseTo(s.sd / 5.5, 12);
  });
  it("leaves the interval null on a small sample and the cv 0 on a zero mean", () => {
    const s = summarize([0, 0]);
    expect(s.medianCiLow).toBeNull();
    expect(s.cv).toBe(0);
    expect(() => summarize([])).toThrow(/empty/);
  });
});

describe("ratioOfMedians", () => {
  it("is reproducible for a seed and brackets the point ratio", () => {
    const a = [20, 21, 19, 22, 20, 21, 20, 19, 23, 20];
    const b = [10, 11, 10, 9, 10, 10, 11, 10, 9, 10];
    const r1 = ratioOfMedians(a, b, { seed: 1 });
    const r2 = ratioOfMedians(a, b, { seed: 1 });
    expect(r1).toEqual(r2);
    expect(r1.ratio).toBe(2);
    expect(r1.ciLow!).toBeLessThanOrEqual(2);
    expect(r1.ciHigh!).toBeGreaterThanOrEqual(2);
    expect(r1.ciLow!).toBeGreaterThan(1.5);
  });
  it("has no interval for single samples and refuses a zero median", () => {
    expect(ratioOfMedians([2], [1])).toEqual({ ratio: 2, ciLow: null, ciHigh: null });
    expect(() => ratioOfMedians([1], [0])).toThrow(/zero/);
  });
});

describe("seededRandom", () => {
  it("is deterministic and stays in [0, 1)", () => {
    const r = seededRandom(42);
    const xs = Array.from({ length: 1000 }, r);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(Array.from({ length: 3 }, seededRandom(42))).toEqual(xs.slice(0, 3));
  });
});

describe("frameStats", () => {
  it("computes the 1% low from the slowest 1% of frames", () => {
    const frames = [...Array.from({ length: 198 }, () => 16), 50, 100];
    const s = frameStats(frames);
    expect(s.frames).toBe(200);
    expect(s.medianMs).toBe(16);
    // The slowest 1% of 200 frames is two frames: 50 and 100 ms.
    expect(s.onePercentLowFps).toBeCloseTo(1000 / 75, 9);
    expect(s.meanFps).toBeCloseTo(1000 / mean(frames), 9);
  });
  it("uses at least one frame for the 1% low and refuses bad intervals", () => {
    expect(frameStats([10, 20]).onePercentLowFps).toBe(50);
    expect(() => frameStats([])).toThrow(/no frames/);
    expect(() => frameStats([0, 16])).toThrow(/not positive/);
  });
});

describe("verdict", () => {
  it("calls a difference only when the whole interval clears the band", () => {
    expect(verdict({ ratio: 2, ciLow: 1.8, ciHigh: 2.2 })).toBe("higher");
    expect(verdict({ ratio: 0.5, ciLow: 0.4, ciHigh: 0.6 })).toBe("lower");
    expect(verdict({ ratio: 1, ciLow: 0.97, ciHigh: 1.03 })).toBe("equivalent");
    expect(verdict({ ratio: 1, ciLow: 0.9, ciHigh: 1.2 })).toBe("inconclusive");
    expect(verdict({ ratio: 1, ciLow: null, ciHigh: null })).toBe("inconclusive");
  });
});
