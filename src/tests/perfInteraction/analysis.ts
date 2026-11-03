import { frameStats, pairedDifference, pairedRatio, quantile } from "../perfCompare/stats";
import type { PhaseRecord } from "./pageRecorder";
import type { PhaseActions } from "./phases";

/**
 * The interaction benchmark's statistics (`npm run perf:interaction`). Pure
 * functions over what the page recorded, so every number in the report can be
 * checked by a unit test.
 *
 * Conventions:
 * - Frame times compare as paired ratios, B over A, one per repetition (a
 *   ratio below 1 means B's frames are shorter), with the order-statistic
 *   interval of `pairedRatio`.
 * - Blocking and input delay compare as paired differences, B minus A, since
 *   either arm can read 0 (a ratio against 0 is undefined), with the interval
 *   of `pairedDifference`, as M4 does.
 * - Event Timing only reports entries at or above 16 ms and leaves out wheel
 *   and pointer moves, so its quantiles are over the slow clicks and keys,
 *   one per interaction (a phase with none reads 0), and their rate is
 *   compared too. Input to next frame covers every pointer, wheel and key
 *   input, moves included.
 * - Totals (long-task time, LoAF blocking, slow interactions) are read per
 *   second or per minute of the phase window, because a slower arm can keep a
 *   window open a little longer than the faster one.
 */

export interface PhaseMetrics {
  frames: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameP99Ms: number;
  onePercentLowFps: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  /** Long-task time per second of the phase window. */
  longTaskMsPerSecond: number;
  longTaskMaxMs: number;
  /** Long animation frames' blocking time; null when the browser has no LoAF. */
  loafBlockingTotalMs: number | null;
  loafBlockingMsPerSecond: number | null;
  loafBlockingMaxMs: number | null;
  /** Slow interactions (clicks and keys at or above 16 ms), counted and per minute. */
  slowEventCount: number;
  slowInteractionsPerMinute: number;
  eventP75Ms: number;
  eventP98Ms: number;
  eventMaxDelayMs: number;
  inputCount: number;
  /** Every input's time to the start of the next frame; 0 with no input. */
  inputToFrameP95Ms: number;
  inputToFrameP99Ms: number;
  /** Game minutes the tower advanced: a stalled arm shows here. */
  simMinutes: number;
  /** The phase window's length, and the game's time of day when it opened. */
  windowMs: number;
  minuteOfDayStart: number;
  /** What the phase script did (inputs sent, and those that took effect). */
  actions: number;
  effective: number | null;
  /** Timed app calls, total and max per label. */
  parts: Record<string, { n: number; ms: number; max: number }>;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const max = (xs: readonly number[]): number => xs.reduce((a, b) => Math.max(a, b), 0);

/** One phase's metrics. Throws when the phase recorded no frames, which means
 *  the page stopped drawing and the run is not usable. */
export function phaseMetrics(p: PhaseRecord, loafSupported: boolean, acts: PhaseActions = { actions: 0, effective: null }): PhaseMetrics {
  const f = frameStats(p.frames);
  const durs = p.events.map((e) => e.dur);
  const blocking = p.loafs.map((l) => l.blocking);
  const seconds = p.windowMs > 0 ? p.windowMs / 1000 : Number.NaN;
  return {
    frames: f.frames,
    frameP50Ms: f.medianMs,
    frameP95Ms: f.p95Ms,
    frameP99Ms: f.p99Ms,
    onePercentLowFps: f.onePercentLowFps,
    longTaskCount: p.longTasks.length,
    longTaskTotalMs: sum(p.longTasks),
    longTaskMsPerSecond: sum(p.longTasks) / seconds,
    longTaskMaxMs: max(p.longTasks),
    loafBlockingTotalMs: loafSupported ? sum(blocking) : null,
    loafBlockingMsPerSecond: loafSupported ? sum(blocking) / seconds : null,
    loafBlockingMaxMs: loafSupported ? max(blocking) : null,
    slowEventCount: durs.length,
    slowInteractionsPerMinute: (durs.length * 60) / seconds,
    eventP75Ms: durs.length ? quantile(durs, 0.75) : 0,
    eventP98Ms: durs.length ? quantile(durs, 0.98) : 0,
    eventMaxDelayMs: max(p.events.map((e) => e.delay)),
    inputCount: p.inputToFrame.length,
    inputToFrameP95Ms: p.inputToFrame.length ? quantile(p.inputToFrame, 0.95) : 0,
    inputToFrameP99Ms: p.inputToFrame.length ? quantile(p.inputToFrame, 0.99) : 0,
    simMinutes: p.simMinutes,
    windowMs: p.windowMs,
    minuteOfDayStart: p.minuteOfDayStart,
    actions: acts.actions,
    effective: acts.effective,
    parts: p.parts,
  };
}

export type Arm = "A" | "B";

/** One arm's run at one throttle in one repetition. */
export interface ArmRun {
  arm: Arm;
  rep: number;
  throttle: number;
  phases: Record<string, PhaseMetrics>;
}

/** The metrics compared as ratios (B over A) and as differences (B minus A). */
export const RATIO_METRICS = ["frameP95Ms", "frameP99Ms", "onePercentLowFps"] as const;
export const DIFFERENCE_METRICS = ["longTaskMsPerSecond", "longTaskMaxMs", "loafBlockingMsPerSecond", "inputToFrameP95Ms", "inputToFrameP99Ms", "slowInteractionsPerMinute", "eventP98Ms", "eventMaxDelayMs"] as const;
type RatioMetric = (typeof RATIO_METRICS)[number];
type DifferenceMetric = (typeof DIFFERENCE_METRICS)[number];

export interface Comparison {
  throttle: number;
  phase: string;
  metric: RatioMetric | DifferenceMetric;
  kind: "ratio" | "difference";
  medianA: number | null;
  medianB: number | null;
  /** The paired ratio or difference and its 95% interval (null below six pairs). */
  value: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  pairs: number;
}

function median(xs: readonly number[]): number | null {
  return xs.length ? quantile(xs, 0.5) : null;
}

function valuesOf(runs: readonly ArmRun[], arm: Arm, throttle: number, phase: string, metric: keyof PhaseMetrics): { reps: number[]; values: number[] } {
  const reps: number[] = [];
  const values: number[] = [];
  for (const r of runs) {
    if (r.arm !== arm || r.throttle !== throttle) continue;
    const v = r.phases[phase]?.[metric];
    if (typeof v !== "number") continue;
    reps.push(r.rep);
    values.push(v);
  }
  return { reps, values };
}

/** Every metric of every phase at every throttle, A against B, paired by repetition. */
export function compareArms(runs: readonly ArmRun[], phases: readonly string[]): Comparison[] {
  const out: Comparison[] = [];
  const throttles = [...new Set(runs.map((r) => r.throttle))].sort((a, b) => a - b);
  for (const throttle of throttles) {
    for (const phase of phases) {
      for (const metric of RATIO_METRICS) {
        const a = valuesOf(runs, "A", throttle, phase, metric);
        const b = valuesOf(runs, "B", throttle, phase, metric);
        const pairs: [number, number][] = [];
        a.reps.forEach((rep, i) => {
          const j = b.reps.indexOf(rep);
          if (j >= 0 && a.values[i] > 0) pairs.push([b.values[j], a.values[i]]);
        });
        const r = pairs.length ? pairedRatio(pairs) : null;
        out.push({ throttle, phase, metric, kind: "ratio", medianA: median(a.values), medianB: median(b.values), value: r?.ratio ?? null, ciLow: r?.ciLow ?? null, ciHigh: r?.ciHigh ?? null, pairs: pairs.length });
      }
      for (const metric of DIFFERENCE_METRICS) {
        const a = valuesOf(runs, "A", throttle, phase, metric);
        const b = valuesOf(runs, "B", throttle, phase, metric);
        const d = pairedDifference(b, a);
        out.push({ throttle, phase, metric, kind: "difference", medianA: median(a.values), medianB: median(b.values), value: d?.median ?? null, ciLow: d?.ciLow ?? null, ciHigh: d?.ciHigh ?? null, pairs: d?.n ?? 0 });
      }
    }
  }
  return out;
}

const LABELS: Record<Comparison["metric"], string> = {
  frameP95Ms: "frame p95 (ms)",
  frameP99Ms: "frame p99 (ms)",
  onePercentLowFps: "1% low (fps)",
  longTaskMsPerSecond: "long tasks (ms per s)",
  longTaskMaxMs: "longest task (ms)",
  loafBlockingMsPerSecond: "LoAF blocking (ms per s)",
  inputToFrameP95Ms: "input to next frame p95 (ms)",
  inputToFrameP99Ms: "input to next frame p99 (ms)",
  slowInteractionsPerMinute: "slow clicks and keys (per min)",
  eventP98Ms: "slow click or key p98 (ms)",
  eventMaxDelayMs: "worst click or key delay (ms)",
};

const num = (v: number | null, digits = 1): string => (v === null ? "n/a" : v.toFixed(digits));

/** The report table: one row per throttle, phase and metric. */
export function comparisonTable(rows: readonly Comparison[]): string {
  const lines = ["| CPU | Phase | Metric | A median | B median | B vs A (paired) | 95% interval | Pairs |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const r of rows) {
    const digits = r.kind === "ratio" ? 3 : 1;
    let value = "n/a";
    if (r.value !== null) value = r.kind === "ratio" ? `x${num(r.value, 3)}` : `${r.value >= 0 ? "+" : ""}${num(r.value)}`;
    const ci = r.ciLow === null || r.ciHigh === null ? "n/a (under 6 pairs)" : `${num(r.ciLow, digits)} to ${num(r.ciHigh, digits)}`;
    lines.push(`| ${r.throttle}x | ${r.phase} | ${LABELS[r.metric]} | ${num(r.medianA)} | ${num(r.medianB)} | ${value} | ${ci} | ${r.pairs} |`);
  }
  return lines.join("\n");
}

/** Per run and phase: what the script did and how far the tower ran, so a
 *  phase that measured nothing, or an arm whose tower stalled, is visible. */
export function activityTable(runs: readonly ArmRun[], phases: readonly string[]): string {
  const lines = ["| CPU | Rep | Arm | Phase | Starts at | Window (s) | Inputs sent | Took effect | Game minutes | Frames |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  const clock = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  for (const r of runs) {
    for (const phase of phases) {
      const m = r.phases[phase];
      if (!m) continue;
      lines.push(`| ${r.throttle}x | ${r.rep} | ${r.arm} | ${phase} | ${clock(m.minuteOfDayStart)} | ${(m.windowMs / 1000).toFixed(1)} | ${m.actions} | ${m.effective ?? "n/a"} | ${m.simMinutes} | ${m.frames} |`);
    }
  }
  return lines.join("\n");
}
