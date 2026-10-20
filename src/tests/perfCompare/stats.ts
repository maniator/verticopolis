/**
 * Statistics for the engine comparison (`npm run perf:compare`, issue #972).
 * Pure functions over plain number arrays, so the report's numbers can be
 * checked by unit tests rather than trusted.
 *
 * Conventions, stated once so the report can cite them:
 * - Quantiles interpolate linearly between order statistics (the "type 7"
 *   estimator that numpy and R use by default).
 * - The spread is the sample standard deviation (n - 1).
 * - The median's 95% interval is the distribution-free order-statistic
 *   interval from the binomial distribution, so it needs no normality
 *   assumption and no random resampling.
 * - Engines are compared by paired ratios (one per repetition) with the
 *   same order-statistic interval on their median ({@link pairedRatio}).
 */

export interface Summary {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  /** Sample standard deviation; 0 for fewer than two samples. */
  sd: number;
  /** sd / mean; 0 when the mean is 0. */
  cv: number;
  /** 95% interval for the median (order statistics); null below n = 6,
   *  where no pair of order statistics reaches 95% coverage. */
  medianCiLow: number | null;
  medianCiHigh: number | null;
}

function finiteSorted(values: readonly number[]): number[] {
  for (const v of values) if (!Number.isFinite(v)) throw new Error(`non-finite sample ${v}`);
  return [...values].sort((a, b) => a - b);
}

/** The q-quantile (0..1) of a sample, linear interpolation (type 7). */
export function quantile(values: readonly number[], q: number): number {
  if (!(q >= 0 && q <= 1)) throw new Error(`quantile ${q} is outside 0..1`);
  const s = finiteSorted(values);
  if (s.length === 0) throw new Error("quantile of an empty sample");
  const h = (s.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("mean of an empty sample");
  let sum = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) throw new Error(`non-finite sample ${v}`);
    sum += v;
  }
  return sum / values.length;
}

export function sampleSd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let ss = 0;
  for (const v of values) ss += (v - m) * (v - m);
  return Math.sqrt(ss / (values.length - 1));
}

/** log of n choose k, for the binomial tail below. */
function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** P(X <= k) for X ~ Binomial(n, 1/2). */
export function binomialHalfCdf(n: number, k: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let p = 0;
  for (let i = 0; i <= k; i++) p += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, p);
}

/**
 * The order-statistic interval for the median at `level` coverage: the
 * widest-k pair (x(k), x(n+1-k)) whose coverage 1 - 2 P(X <= k - 1) still
 * reaches `level`. Returns 1-based ranks, or null when even the full range
 * (k = 1) falls short.
 */
export function medianCiRanks(n: number, level = 0.95): { lo: number; hi: number } | null {
  let best: { lo: number; hi: number } | null = null;
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    const coverage = 1 - 2 * binomialHalfCdf(n, k - 1);
    if (coverage >= level) best = { lo: k, hi: n + 1 - k };
    else break;
  }
  return best;
}

export function summarize(values: readonly number[]): Summary {
  const s = finiteSorted(values);
  if (s.length === 0) throw new Error("summary of an empty sample");
  const m = mean(s);
  const sd = sampleSd(s);
  const ranks = medianCiRanks(s.length);
  return {
    n: s.length,
    min: s[0],
    max: s[s.length - 1],
    mean: m,
    median: quantile(s, 0.5),
    p95: quantile(s, 0.95),
    p99: quantile(s, 0.99),
    sd,
    cv: m === 0 ? 0 : sd / m,
    medianCiLow: ranks ? s[ranks.lo - 1] : null,
    medianCiHigh: ranks ? s[ranks.hi - 1] : null,
  };
}

/** The differences a minus b, paired by repetition number: a repetition missing from either side drops out, so a thin or reordered row cannot shift a pair. */
export function pairedDifferences(a: { reps: readonly number[]; values: readonly number[] }, b: { reps: readonly number[]; values: readonly number[] }): number[] {
  const diffs: number[] = [];
  a.reps.forEach((rep, i) => {
    const j = b.reps.indexOf(rep);
    if (j >= 0) diffs.push(a.values[i] - b.values[j]);
  });
  return diffs;
}

export interface FrameStats {
  frames: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  meanFps: number;
  /** The average frame rate over the slowest 1% of frames (at least one
   *  frame): 1000 / mean of those frame times. */
  onePercentLowFps: number;
}

/** Frame-time statistics from rAF intervals in milliseconds. */
export function frameStats(intervalsMs: readonly number[]): FrameStats {
  const s = finiteSorted(intervalsMs);
  if (s.length === 0) throw new Error("no frames");
  if (s[0] <= 0) throw new Error(`a frame interval of ${s[0]} ms is not positive`);
  const slowCount = Math.max(1, Math.floor(s.length / 100));
  const slowest = s.slice(s.length - slowCount);
  return {
    frames: s.length,
    medianMs: quantile(s, 0.5),
    p95Ms: quantile(s, 0.95),
    p99Ms: quantile(s, 0.99),
    meanFps: 1000 / mean(s),
    onePercentLowFps: 1000 / mean(slowest),
  };
}

/** How to describe a ratio of medians whose interval may straddle 1. */
export function verdict(r: { ratio: number; ciLow: number | null; ciHigh: number | null }, equivalenceBand = 0.05): "higher" | "lower" | "equivalent" | "inconclusive" {
  if (r.ciLow === null || r.ciHigh === null) return "inconclusive";
  if (r.ciLow > 1 + equivalenceBand) return "higher";
  if (r.ciHigh < 1 - equivalenceBand) return "lower";
  if (r.ciLow >= 1 - equivalenceBand && r.ciHigh <= 1 + equivalenceBand) return "equivalent";
  return "inconclusive";
}

/**
 * The paired comparison the report uses: one ratio per repetition (a / b,
 * the two engines' processes from the same repetition, which ran back to
 * back in alternating order), their median, and the distribution-free
 * order-statistic 95% interval of that median (null below six pairs). No
 * resampling, so the interval does not depend on a seed and does not
 * undercover the way a percentile bootstrap does at this sample size.
 */
export function pairedRatio(pairs: readonly (readonly [number, number])[]): { ratio: number; ciLow: number | null; ciHigh: number | null; n: number } {
  const ratios = pairs.map(([a, b]) => {
    if (b === 0) throw new Error("a paired ratio against zero");
    return a / b;
  });
  if (ratios.length === 0) throw new Error("no pairs");
  const s = summarize(ratios);
  return { ratio: s.median, ciLow: s.medianCiLow, ciHigh: s.medianCiHigh, n: ratios.length };
}
