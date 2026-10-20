import { stable, treeProblem } from "../perfCompare/calibrate";
import { rendererFinding } from "../perfCompare/renderer";
import { pairedRatio, summarize } from "../perfCompare/stats";
import { UNTHROTTLED_WORKER, type Metric } from "./analysis";
import type { WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";

/**
 * Compares two `perf:worker` result folders from different builds of the same
 * machine: a BEFORE run and an AFTER run (main against a candidate PR). Each
 * metric of each mode is paired by repetition number across the two runs
 * (rep i with rep i, so the mode order position matches), the ratio is
 * written so that above 1.0 is worse (AFTER over BEFORE for times, memory
 * and counts; BEFORE over AFTER for rates), and its interval is the
 * order-statistic one `perfCompare/stats.ts` defines.
 *
 * The two runs happened hours apart, so drift is the main confound. The
 * control modes (code the candidate does not touch; `ts`, `wasm` and
 * `wasm-frame` by default) are compared the same way. A subject row is void
 * when a control row of the same metric moved by more than the tolerance
 * between the runs, because then the machine or the browser moved, not the
 * code. A row with no control to vouch for it is marked uncontrolled.
 */

export interface BeforeAfterOptions {
  /** Modes the candidate does not change; their before-to-after ratio must stay near 1. */
  controls: ModeName[];
  /** Modes under test; default is every other mode in the runs. */
  subjects?: ModeName[];
  /** A control row whose ratio is farther than this from 1.0 voids the subject rows of the same metric. Default 0.05, the cap on δ in protocol section 6.1; the A/A noise measured by `perf:calibrate` replaces it once the owner adopts one. */
  tolerance: number;
  /** Fewest pairs a row needs for an interval. Default 10, the protocol's minimum for a verdict. */
  minPairs: number;
}

export const DEFAULT_CONTROLS: ModeName[] = ["ts", "wasm", "wasm-frame"];

export interface Row {
  group: Metric["group"];
  scenario: string;
  throttle: string;
  metric: string;
  unit: string;
  better: "lower" | "higher";
  mode: ModeName;
  role: "subject" | "control";
  /** Above 1.0 is worse. */
  ratio: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  pairs: number;
  /** Pairs dropped because the denominator was 0. */
  zeroReference: number;
  beforeMedian: number | null;
  afterMedian: number | null;
  /** Median of AFTER minus BEFORE over the pairs, in the metric's unit, with its interval; the figure for a metric that is often 0. */
  diffMedian: number | null;
  diffCiLow: number | null;
  diffCiHigh: number | null;
  /** `ok` means only that no control moved: it is not a verdict, and an effect smaller than the tolerance cannot be told from allowed drift. */
  status: "ok" | "void" | "uncontrolled" | "thin" | "zero-ref" | "control-ok" | "control-drift" | "control-noisy";
  /** For a void row, the controls that moved, with their ratios. */
  voidedBy: string[];
  unthrottled?: "worker";
}

export interface RunIdentity {
  commit: string;
  appVersion: string;
  engineBuildHash: string | null;
  startedAt: string;
  reps: number;
  sha256?: string;
}

export interface BeforeAfter {
  /** "A/A" when both runs are the same commit and engine build, which measures the noise itself. */
  kind: "before-after" | "A/A";
  options: BeforeAfterOptions;
  before: RunIdentity;
  after: RunIdentity;
  /** Reasons the two runs cannot be compared at all; no rows are produced when this is not empty. */
  problems: string[];
  rows: Row[];
  /** Metrics one run has and the other lacks, or whose unit or direction differs; each is named with the run that lacks it. */
  missing: string[];
  /** Counts by status, for the summary line. */
  counts: Record<Row["status"], number>;
}

const identity = (r: WorkerResults, sha256?: string): RunIdentity => ({ commit: r.environment.commit, appVersion: r.environment.appVersion, engineBuildHash: r.environment.engineBuildHash ?? null, startedAt: r.startedAt, reps: r.config.reps, ...(sha256 ? { sha256 } : {}) });

const goodRenderers = (r: WorkerResults) => ({ starts: r.runs.filter((x) => x.ok).map((x) => x.page?.webgl?.renderer), ends: r.runs.filter((x) => x.ok).map((x) => x.rendererEnd) });

/** Why two result sets cannot be compared, or an empty list. Each run must stand alone as protocol evidence, and the two must differ in nothing but the build. */
export function comparability(before: WorkerResults, after: WorkerResults, minPairs: number): string[] {
  const out: string[] = [];
  for (const [name, r] of [["BEFORE", before], ["AFTER", after]] as const) {
    if (!r.validation?.ok) out.push(`${name} failed its own validation`);
    if (r.config.quick) out.push(`${name} is a --quick run`);
    const tree = treeProblem({ environment: r.environment });
    if (tree) out.push(`${name}: ${tree}`);
    if (r.browser.rendererException) out.push(`${name} declared renderer exception ${r.browser.rendererException}`);
    if (r.browser.gpuVerified !== true) out.push(`${name} does not record gpuVerified: true (a pre-#1125 harness, or a renderer that was not verified hardware)`);
    else {
      const { starts, ends } = goodRenderers(r);
      const f = rendererFinding(starts, ends, { quick: false });
      if (f.errors.length) out.push(`${name}: ${f.errors[0]}`);
    }
    if (r.config.reps < minPairs) out.push(`${name} has ${r.config.reps} repetitions, fewer than the ${minPairs} a verdict needs`);
  }
  const same = (what: string, key: (r: WorkerResults) => unknown): void => {
    if (stable(key(before)) !== stable(key(after))) out.push(`the runs differ in ${what}`);
  };
  same("run parameters (repetitions, modes, scenarios, throttles, steps, step size, batch, frame window, speed or viewport)", (r) => ({ ...r.config, quick: false, scenarios: [...r.config.scenarios].sort() }));
  same("scenario inputs (the scenario hashes)", (r) => r.scenarios.map((s) => [s.name, s.sha256]));
  same("machine or runtime", (r) => [r.environment.cpuModel, r.environment.logicalCpus, r.environment.totalMemoryBytes, r.environment.os, r.environment.kernel, r.environment.arch, r.environment.node, r.environment.rust, r.environment.playwright]);
  same("browser (executable, channel, switches, version or WebGL renderer)", (r) => [r.browser.executable, r.browser.channel, r.browser.args, r.browser.version, [...new Set(r.runs.filter((x) => x.ok).flatMap((x) => [x.page?.webgl?.renderer, x.rendererEnd]).filter(Boolean))].sort()]);
  const t0 = Date.parse(before.startedAt);
  const t1 = Date.parse(after.startedAt);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) out.push("a run has no readable start time, so their order cannot be checked");
  else if (t1 < t0) out.push("AFTER started before BEFORE; name them in the order they were run");
  else if (Date.parse(before.generatedAt) > t1) out.push("AFTER started before BEFORE finished; the two runs overlapped on the machine");
  if (stable(before) === stable(after)) out.push("BEFORE and AFTER are the same results; name two different runs");
  out.push(...metricProblems("BEFORE", before), ...metricProblems("AFTER", after));
  return out;
}

const emptyCounts = (): BeforeAfter["counts"] => ({ ok: 0, void: 0, uncontrolled: 0, thin: 0, "zero-ref": 0, "control-ok": 0, "control-drift": 0, "control-noisy": 0 });

/** Shape of every metric a run carries, so pairing by repetition number cannot read garbage: unique whole repetitions, one finite value each. */
function metricProblems(name: string, r: WorkerResults): string[] {
  const out: string[] = [];
  for (const m of r.metrics) {
    const label = `${name} ${m.mode} ${m.scenario} ${m.throttle}x ${m.metric}`;
    if (!Array.isArray(m.reps) || !Array.isArray(m.values) || m.reps.length !== m.values.length) out.push(`${label}: reps and values do not line up`);
    else if (new Set(m.reps).size !== m.reps.length || m.reps.some((x) => !Number.isInteger(x) || x < 0 || x >= r.config.reps)) out.push(`${label}: repetition numbers repeat or fall outside 0 to ${r.config.reps - 1}`);
    else if (m.values.some((v) => typeof v !== "number" || !Number.isFinite(v))) out.push(`${label}: a value is not a finite number`);
    if (out.length >= 3) break;
  }
  return out;
}

const factor = (ratio: number, tolerance: number): boolean => ratio > 1 + tolerance || ratio < 1 / (1 + tolerance);

export function compareRuns(before: WorkerResults, after: WorkerResults, options: Partial<BeforeAfterOptions> = {}, hashes: { before?: string; after?: string } = {}): BeforeAfter {
  const opts: BeforeAfterOptions = { controls: options.controls ?? DEFAULT_CONTROLS, subjects: options.subjects, tolerance: options.tolerance ?? 0.05, minPairs: options.minPairs ?? 10 };
  const sameBuild = before.environment.commit === after.environment.commit && (before.environment.engineBuildHash ?? null) === (after.environment.engineBuildHash ?? null);
  const result: BeforeAfter = { kind: sameBuild ? "A/A" : "before-after", options: opts, before: identity(before, hashes.before), after: identity(after, hashes.after), problems: comparability(before, after, opts.minPairs), rows: [], missing: [], counts: emptyCounts() };
  const modes = before.config.modes;
  const subjects = opts.subjects ?? modes.filter((m) => !opts.controls.includes(m));
  for (const m of subjects) if (!modes.includes(m)) result.problems.push(`subject mode ${m} was not in the runs`);
  for (const m of subjects) if (opts.controls.includes(m)) result.problems.push(`${m} is both a control and a subject`);
  if (!opts.controls.some((m) => modes.includes(m))) result.problems.push("none of the control modes was in the runs");
  if (subjects.length === 0) result.problems.push("no subject mode is left to compare");
  if (result.problems.length) return result;
  const key = (m: Metric) => `${m.group}|${m.scenario}|${m.throttle}|${m.metric}`;
  const afterBy = new Map(after.metrics.map((m) => [`${key(m)}|${m.mode}`, m]));
  const beforeKeys = new Set(before.metrics.map((m) => `${key(m)}|${m.mode}`));
  for (const m of before.metrics) {
    const a = afterBy.get(`${key(m)}|${m.mode}`);
    const name = `${m.mode} ${m.scenario} ${m.throttle}x ${m.metric}`;
    if (!a) result.missing.push(`${name}: only in BEFORE`);
    else if (a.unit !== m.unit || a.better !== m.better) result.missing.push(`${name}: unit or direction differs between the runs, so it is not compared`);
  }
  for (const m of after.metrics) if (!beforeKeys.has(`${key(m)}|${m.mode}`)) result.missing.push(`${m.mode} ${m.scenario} ${m.throttle}x ${m.metric}: only in AFTER`);
  const rows: Row[] = [];
  for (const b of before.metrics) {
    let role: Row["role"] | null = null;
    if (opts.controls.includes(b.mode)) role = "control";
    else if (subjects.includes(b.mode)) role = "subject";
    const a = afterBy.get(`${key(b)}|${b.mode}`);
    if (!role || !a || a.unit !== b.unit || a.better !== b.better) continue;
    // Above 1.0 is worse: AFTER over BEFORE for a lower-is-better metric, BEFORE over AFTER for a rate.
    const pairs: [number, number][] = [];
    const diffs: number[] = [];
    const beforePaired: number[] = [];
    const afterPaired: number[] = [];
    let zeroReference = 0;
    a.reps.forEach((rep, i) => {
      const j = b.reps.indexOf(rep);
      if (j < 0) return;
      diffs.push(a.values[i] - b.values[j]);
      beforePaired.push(b.values[j]);
      afterPaired.push(a.values[i]);
      const [num, den] = b.better === "higher" ? [b.values[j], a.values[i]] : [a.values[i], b.values[j]];
      if (den === 0) zeroReference++;
      else pairs.push([num, den]);
    });
    const r = pairs.length ? pairedRatio(pairs) : null;
    const d = diffs.length ? summarize(diffs) : null;
    const row: Row = {
      group: b.group, scenario: b.scenario, throttle: b.throttle, metric: b.metric, unit: b.unit, better: b.better, mode: b.mode, role,
      ratio: r?.ratio ?? null, ciLow: r?.ciLow ?? null, ciHigh: r?.ciHigh ?? null, pairs: pairs.length, zeroReference,
      beforeMedian: beforePaired.length ? summarize(beforePaired).median : null, afterMedian: afterPaired.length ? summarize(afterPaired).median : null,
      diffMedian: d?.median ?? null, diffCiLow: d?.medianCiLow ?? null, diffCiHigh: d?.medianCiHigh ?? null,
      status: "ok", voidedBy: [], ...(UNTHROTTLED_WORKER(b.mode, b.throttle) ? { unthrottled: "worker" as const } : {}),
    };
    rows.push(row);
  }
  // A control row: fine, drifted, or too thin to vouch for anything.
  const byKey = new Map<string, Row[]>();
  for (const row of rows) {
    const k = `${row.group}|${row.scenario}|${row.throttle}|${row.metric}`;
    byKey.set(k, [...(byKey.get(k) ?? []), row]);
    if (row.role === "control") {
      if (row.pairs < opts.minPairs || row.ratio === null) row.status = "thin";
      else if (factor(row.ratio, opts.tolerance)) row.status = "control-drift";
      // A control whose interval reaches past the tolerance cannot vouch for a row: its median sat still, but the pairs did not.
      else if (row.ciLow !== null && row.ciHigh !== null && (factor(row.ciLow, opts.tolerance) || factor(row.ciHigh, opts.tolerance))) row.status = "control-noisy";
      else row.status = "control-ok";
    }
  }
  for (const row of rows) {
    if (row.role !== "subject") continue;
    const controls = (byKey.get(`${row.group}|${row.scenario}|${row.throttle}|${row.metric}`) ?? []).filter((x) => x.role === "control");
    const drifted = controls.filter((c) => c.status === "control-drift" || c.status === "control-noisy");
    const vouching = controls.filter((c) => c.status === "control-ok");
    if (row.pairs < opts.minPairs || row.ratio === null) row.status = "thin";
    else if (drifted.length) {
      row.status = "void";
      row.voidedBy = drifted.map((c) => (c.status === "control-noisy" ? `${c.mode} ${c.ratio!.toFixed(2)}x, interval ${c.ciLow!.toFixed(2)} to ${c.ciHigh!.toFixed(2)}` : `${c.mode} ${c.ratio!.toFixed(2)}x`));
    } else if (row.zeroReference > 0) row.status = "zero-ref";
    else if (vouching.length === 0) row.status = "uncontrolled";
  }
  result.rows = rows;
  for (const row of rows) result.counts[row.status]++;
  return result;
}
