import { stable, treeProblem } from "../perfCompare/calibrate";
import { rendererFinding } from "../perfCompare/renderer";
import { summarize } from "../perfCompare/stats";
import { UNTHROTTLED_WORKER, type Metric } from "./analysis";
import type { WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";

/**
 * Compares two `perf:worker` result folders from different builds of the same
 * machine: a BEFORE run and an AFTER run (main against a candidate PR). Each
 * metric of each mode is paired by repetition number across the two runs
 * (rep i with rep i, so the mode order position matches). The ratio is
 * written so that above 1.0 is worse (AFTER over BEFORE for times, memory and
 * counts; BEFORE over AFTER for rates), and its interval is the
 * order-statistic one `perfCompare/stats.ts` defines. A metric that is a
 * count or blocking time, or that has a zero denominator in any pair, is
 * judged on the paired difference instead, signed so that positive is worse.
 *
 * The two runs happened hours apart, so drift is the main confound. The
 * control modes (code the candidate does not touch) are compared the same
 * way. A subject row is void when a control row of the same metric moved,
 * judged on the control's median, because then the machine or the browser
 * moved and the code did not. A control whose median sat still but whose
 * pairs scatter is called noisy: it still vouches, but a subject that only
 * noisy controls vouch for gets its own status, and its scatter is carried
 * into the subject through the net-of-control ratio (the subject's ratio over
 * the control's ratio, repetition by repetition, with its own interval). A
 * control whose values barely move in either run (pinned at a cap or a
 * floor) could not have shown drift, so it does not vouch. A row with no
 * control to vouch for it is marked uncontrolled.
 */

export interface BeforeAfterOptions {
  /** Modes the candidate does not change; their before-to-after ratio must stay near 1. Default: all three main-thread modes for two runs of one build, `ts` alone when the commit or the engine build differs (the candidate then moves the WASM modes). */
  controls: ModeName[];
  /** Modes under test; default is every other mode in the runs. */
  subjects?: ModeName[];
  /** A control row whose median ratio is farther than this from 1.0 voids the subject rows of the same metric (blocking time is judged against BLOCKING_EPSILON_MS instead). Default 0.05, the cap on δ in protocol section 6.1; the A/A noise measured by `perf:calibrate` replaces it once the owner adopts one. */
  tolerance: number;
  /** Fewest pairs a row needs for an interval. Default 10, the protocol's minimum for a verdict. */
  minPairs: number;
}

export const DEFAULT_CONTROLS: ModeName[] = ["ts", "wasm", "wasm-frame"];

/** Long-task time a blocking control may move before it voids the subject rows: the 50 ms cap that protocol section 5 (M4) puts on ε, until the owner adopts a calibrated one. A fraction of a control's own size would be hundreds of milliseconds on a busy tower and a rounding error on a quiet one. */
export const BLOCKING_EPSILON_MS = 50;

const BLOCKING = /^main-thread blocking/;

export interface Row {
  group: Metric["group"];
  scenario: string;
  throttle: string;
  metric: string;
  unit: string;
  better: "lower" | "higher";
  mode: ModeName;
  role: "subject" | "control";
  /** "ratio" for most metrics; "difference" for counts, blocking time and any metric with a zero denominator, which has no ratio. */
  basis: "ratio" | "difference";
  /** Above 1.0 is worse. Null on the difference basis. */
  ratio: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  /** Repetitions present in both runs. */
  pairs: number;
  /** Pairs whose denominator was 0 (their presence puts the row on the difference basis). */
  zeroReference: number;
  beforeMedian: number | null;
  afterMedian: number | null;
  /** Median over the pairs of the worse-is-positive difference (AFTER minus BEFORE for lower-is-better, BEFORE minus AFTER for rates), in the metric's unit, with its interval. */
  diffMedian: number | null;
  diffCiLow: number | null;
  diffCiHigh: number | null;
  /** The subject's per-repetition ratio over the vouching controls' ratio, with its interval; null on the difference basis or without enough paired repetitions. */
  net: { ratio: number; ciLow: number | null; ciHigh: number | null; pairs: number; controls: ModeName[] } | null;
  /** `ok` means only that no control moved: it is not a verdict, and an effect smaller than the tolerance cannot be told from allowed drift. `noisy-controlled` is the same with only noisy controls behind it. A flat control (`control-flat`) never vouches. */
  status: "ok" | "noisy-controlled" | "void" | "uncontrolled" | "thin" | "control-ok" | "control-drift" | "control-noisy" | "control-flat";
  /** For a void row, the controls that moved, with their readings. */
  voidedBy: string[];
  /** Things a reader needs beside an `ok`: a noisy control and its interval, flat controls that could not vouch, why a controlled ratio row has no net-of-control ratio. */
  notes: string[];
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
  /** Metrics one run has and the other lacks (or has no values for), or whose unit or direction differs; each is named with the run that lacks it. */
  missing: string[];
  /** Metric rows with no values in either run (for example PSS off Linux, or bare-engine rows of a host that does not measure them); they have no numbers to compare, so they get no row. */
  notMeasured: number;
  /** Modes in the runs that are neither control nor subject, so a reader knows what was left out. */
  unlisted: ModeName[];
  /** Counts by status, for the summary line. */
  counts: Record<Row["status"], number>;
}

const identity = (r: WorkerResults, sha256?: string): RunIdentity => ({ commit: r.environment.commit, appVersion: r.environment.appVersion, engineBuildHash: r.environment.engineBuildHash ?? null, startedAt: r.startedAt, reps: r.config.reps, ...(sha256 ? { sha256 } : {}) });

const goodRuns = (r: WorkerResults) => r.runs.filter((x) => x.ok);

/** Why two result sets cannot be compared, or an empty list. Each run must stand alone as protocol evidence, and the two must differ in nothing but the build. Their roles come from the argument order; the runs may have happened in either order but must not overlap. */
export function comparability(before: WorkerResults, after: WorkerResults, minPairs: number): string[] {
  const out: string[] = [];
  for (const [name, r] of [["BEFORE", before], ["AFTER", after]] as const) {
    if (r.validation?.ok !== true || (r.validation.errors ?? []).length > 0) out.push(`${name} failed its own validation`);
    if (r.config.quick !== false) out.push(`${name} is a --quick run, or does not say it was not`);
    const tree = treeProblem({ environment: r.environment });
    if (tree) out.push(`${name}: ${tree}`);
    if (r.browser.rendererException) out.push(`${name} declared renderer exception ${r.browser.rendererException}`);
    if (r.browser.gpuVerified !== true) out.push(`${name} does not record gpuVerified: true (a pre-#1125 harness, or a renderer that was not verified hardware)`);
    else {
      const good = goodRuns(r);
      // The same three reads as `perf:calibrate`: at the page's start, after the frames and after the throttled cold start (absent only for a run without one).
      const f = rendererFinding(good.map((x) => x.page?.webgl?.renderer), good.map((x) => x.rendererEnd), { quick: false, lateEnds: good.map((x) => x.rendererEndCold) });
      if (f.errors.length) out.push(`${name}: ${f.errors[0]}`);
    }
    if (!Number.isInteger(r.config.reps) || r.config.reps < minPairs) out.push(`${name} has ${r.config.reps} repetitions, fewer than the ${minPairs} a verdict needs`);
  }
  const same = (what: string, key: (r: WorkerResults) => unknown): void => {
    if (stable(key(before)) !== stable(key(after))) out.push(`the runs differ in ${what}`);
  };
  same("run parameters (repetitions, modes, scenarios, throttles, steps, step size, batch, frame window, speed or viewport)", (r) => ({ ...r.config, quick: false, scenarios: [...r.config.scenarios].sort() }));
  same("scenario inputs (the scenario hashes)", (r) => r.scenarios.map((s) => [s.name, s.sha256]).sort());
  same("machine or runtime", (r) => [r.environment.cpuModel, r.environment.logicalCpus, r.environment.totalMemoryBytes, r.environment.os, r.environment.kernel, r.environment.arch, r.environment.node, r.environment.rust, r.environment.playwright]);
  same("browser (executable, channel, switches, version or WebGL renderer)", (r) => [r.browser.executable, r.browser.channel, r.browser.args, r.browser.version, [...new Set(goodRuns(r).flatMap((x) => [x.page?.webgl?.renderer, x.rendererEnd, x.rendererEndCold]).filter(Boolean))].sort()]);
  const span = (r: WorkerResults): [number, number] => [Date.parse(r.startedAt), Date.parse(r.generatedAt)];
  const [s0, e0] = span(before);
  const [s1, e1] = span(after);
  if (![s0, e0, s1, e1].every(Number.isFinite)) out.push("a run has no readable start or finish time, so whether the two overlapped cannot be checked");
  else if (s0 < e1 && s1 < e0) out.push("the two runs overlapped on the machine");
  if (stable(before) === stable(after)) out.push("BEFORE and AFTER are the same results; name two different runs");
  out.push(...metricProblems("BEFORE", before), ...metricProblems("AFTER", after));
  return out;
}

const emptyCounts = (): BeforeAfter["counts"] => ({ ok: 0, "noisy-controlled": 0, void: 0, uncontrolled: 0, thin: 0, "control-ok": 0, "control-drift": 0, "control-noisy": 0, "control-flat": 0 });

const keyOf = (m: Pick<Metric, "group" | "scenario" | "throttle" | "metric">): string => `${m.group}|${m.scenario}|${m.throttle}|${m.metric}`;

/** Shape of every metric a run carries, so pairing by repetition number cannot read garbage: unique whole repetitions, one finite value each, and no metric listed twice. */
function metricProblems(name: string, r: WorkerResults): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of r.metrics) {
    const label = `${name} ${m.mode} ${m.scenario} ${m.throttle}x ${m.metric}`;
    if (seen.has(`${keyOf(m)}|${m.mode}`)) out.push(`${label}: listed twice`);
    seen.add(`${keyOf(m)}|${m.mode}`);
    if (!Array.isArray(m.reps) || !Array.isArray(m.values) || m.reps.length !== m.values.length) out.push(`${label}: reps and values do not line up`);
    else if (new Set(m.reps).size !== m.reps.length || m.reps.some((x) => !Number.isInteger(x) || x < 0 || x >= r.config.reps)) out.push(`${label}: repetition numbers repeat or fall outside 0 to ${r.config.reps - 1}`);
    else if (m.values.some((v) => typeof v !== "number" || !Number.isFinite(v))) out.push(`${label}: a value is not a finite number`);
    if (out.length >= 3) break;
  }
  return out;
}

const factor = (ratio: number, tolerance: number): boolean => ratio > 1 + tolerance || ratio < 1 / (1 + tolerance);

/** Counts, and the blocking time the protocol gates (section 5, M4) on a paired difference: a zero reference is the normal case, so they have no ratio. */
const differenceMetric = (m: Metric): boolean => m.unit === "count" || BLOCKING.test(m.metric);

/** The controls the runs get when `--controls` is not given. */
export function resolveControls(before: WorkerResults, after: WorkerResults, options: Partial<BeforeAfterOptions>): ModeName[] {
  if (options.controls) return options.controls;
  const sameBuild = before.environment.commit === after.environment.commit && (before.environment.engineBuildHash ?? null) === (after.environment.engineBuildHash ?? null);
  return sameBuild ? DEFAULT_CONTROLS : ["ts"];
}

interface Paired {
  row: Row;
  /** Every paired value of both runs, for the flat-control check. */
  values: number[];
  /** Oriented ratio (above 1.0 is worse) per repetition number; empty on the difference basis. */
  perRep: Map<number, number>;
}

function pair(b: Metric, a: Metric, mode: ModeName, role: Row["role"]): Paired {
  const reps: number[] = [];
  const diffs: number[] = [];
  const ratios: number[] = [];
  const perRep = new Map<number, number>();
  const beforePaired: number[] = [];
  const afterPaired: number[] = [];
  let zeroReference = 0;
  a.reps.forEach((rep, i) => {
    const j = b.reps.indexOf(rep);
    if (j < 0) return;
    const [x, y] = [b.values[j], a.values[i]];
    reps.push(rep);
    beforePaired.push(x);
    afterPaired.push(y);
    const higher = b.better === "higher";
    diffs.push(higher ? x - y : y - x);
    const [num, den] = higher ? [x, y] : [y, x];
    if (den === 0) zeroReference++;
    else {
      ratios.push(num / den);
      perRep.set(rep, num / den);
    }
  });
  const basis: Row["basis"] = differenceMetric(b) || zeroReference > 0 ? "difference" : "ratio";
  const r = basis === "ratio" && ratios.length ? summarize(ratios) : null;
  const d = diffs.length ? summarize(diffs) : null;
  const row: Row = {
    group: b.group, scenario: b.scenario, throttle: b.throttle, metric: b.metric, unit: b.unit, better: b.better, mode, role, basis,
    ratio: r?.median ?? null, ciLow: r?.medianCiLow ?? null, ciHigh: r?.medianCiHigh ?? null, pairs: reps.length, zeroReference,
    beforeMedian: beforePaired.length ? summarize(beforePaired).median : null, afterMedian: afterPaired.length ? summarize(afterPaired).median : null,
    diffMedian: d?.median ?? null, diffCiLow: d?.medianCiLow ?? null, diffCiHigh: d?.medianCiHigh ?? null,
    net: null, status: "ok", voidedBy: [], notes: [], ...(UNTHROTTLED_WORKER(b.mode, b.throttle) ? { unthrottled: "worker" as const } : {}),
  };
  return { row, values: [...beforePaired, ...afterPaired], perRep: basis === "ratio" ? perRep : new Map() };
}

/** A control whose values barely move in either run, so a drift in the machine would not have shown in it: a rate pinned at its cap, a time at a floor, blocking that stays at zero. The band is a third of the tolerance of the control's own median (a tenth of the blocking epsilon for blocking), taken over every paired value of both runs. */
function isFlat(row: Row, values: number[], tolerance: number): boolean {
  const spread = Math.max(...values) - Math.min(...values);
  if (BLOCKING.test(row.metric)) return spread <= BLOCKING_EPSILON_MS / 10;
  return spread <= (tolerance / 3) * Math.abs(summarize(values).median);
}

/** A control's reading for the report, in the unit its basis uses. */
const reading = (c: Row): string => (c.basis === "ratio" ? `${c.ratio!.toFixed(2)}x` : `${c.diffMedian!.toFixed(2)} ${c.unit}${c.beforeMedian === 0 ? " from 0" : ""}`);

export function compareRuns(before: WorkerResults, after: WorkerResults, options: Partial<BeforeAfterOptions> = {}, hashes: { before?: string; after?: string } = {}): BeforeAfter {
  const controls = resolveControls(before, after, options);
  const sameBuild = before.environment.commit === after.environment.commit && (before.environment.engineBuildHash ?? null) === (after.environment.engineBuildHash ?? null);
  const modes = before.config.modes;
  const subjects = options.subjects ?? modes.filter((m) => !controls.includes(m));
  const opts: BeforeAfterOptions = { controls, subjects, tolerance: options.tolerance ?? 0.05, minPairs: options.minPairs ?? 10 };
  const result: BeforeAfter = { kind: sameBuild ? "A/A" : "before-after", options: opts, before: identity(before, hashes.before), after: identity(after, hashes.after), problems: comparability(before, after, opts.minPairs), rows: [], missing: [], notMeasured: 0, unlisted: modes.filter((m) => !controls.includes(m) && !subjects.includes(m)), counts: emptyCounts() };
  for (const m of subjects) if (!modes.includes(m)) result.problems.push(`subject mode ${m} was not in the runs`);
  for (const m of subjects) if (controls.includes(m)) result.problems.push(`${m} is both a control and a subject`);
  if (!controls.some((m) => modes.includes(m))) result.problems.push("none of the control modes was in the runs");
  if (subjects.length === 0) result.problems.push("no subject mode is left to compare");
  if (result.problems.length) return result;
  const afterBy = new Map(after.metrics.map((m) => [`${keyOf(m)}|${m.mode}`, m]));
  const beforeKeys = new Set(before.metrics.map((m) => `${keyOf(m)}|${m.mode}`));
  const paired: Paired[] = [];
  for (const b of before.metrics) {
    const a = afterBy.get(`${keyOf(b)}|${b.mode}`);
    const name = `${b.mode} ${b.scenario} ${b.throttle}x ${b.metric}`;
    if (!a) result.missing.push(`${name}: only in BEFORE`);
    else if (a.unit !== b.unit || a.better !== b.better) result.missing.push(`${name}: unit or direction differs between the runs, so it is not compared`);
    else if (b.values.length === 0 && a.values.length === 0) result.notMeasured++;
    else if (b.values.length === 0 || a.values.length === 0) result.missing.push(`${name}: values only in ${b.values.length === 0 ? "AFTER" : "BEFORE"}`);
    else if (controls.includes(b.mode)) paired.push(pair(b, a, b.mode, "control"));
    else if (subjects.includes(b.mode)) paired.push(pair(b, a, b.mode, "subject"));
  }
  for (const m of after.metrics) if (!beforeKeys.has(`${keyOf(m)}|${m.mode}`)) result.missing.push(`${m.mode} ${m.scenario} ${m.throttle}x ${m.metric}: only in AFTER`);
  const byKey = new Map<string, Paired[]>();
  for (const p of paired) byKey.set(keyOf(p.row), [...(byKey.get(keyOf(p.row)) ?? []), p]);
  // A control row: moved, thin, flat, noisy, or fine. Its median decides whether it moved, even when it is thin, so a thin control that moved still blocks.
  for (const { row, values } of paired.filter((p) => p.row.role === "control")) {
    let moved = false;
    if (row.pairs > 0) {
      if (row.basis === "ratio") moved = factor(row.ratio!, opts.tolerance);
      else if (BLOCKING.test(row.metric)) moved = Math.abs(row.diffMedian!) > BLOCKING_EPSILON_MS;
      else moved = Math.abs(row.diffMedian!) > opts.tolerance * Math.abs(row.beforeMedian ?? 0);
    }
    if (moved) row.status = "control-drift";
    else if (row.pairs < opts.minPairs) row.status = "thin";
    else if (isFlat(row, values, opts.tolerance)) row.status = "control-flat";
    else if (row.basis === "ratio" && row.ciLow !== null && row.ciHigh !== null && (factor(row.ciLow, opts.tolerance) || factor(row.ciHigh, opts.tolerance))) row.status = "control-noisy";
    else row.status = "control-ok";
  }
  for (const p of paired.filter((x) => x.row.role === "subject")) {
    const row = p.row;
    const peers = (byKey.get(keyOf(row)) ?? []).filter((x) => x.row.role === "control");
    const drifted = peers.filter((c) => c.row.status === "control-drift");
    const vouching = peers.filter((c) => c.row.status === "control-ok" || c.row.status === "control-noisy");
    const noisy = vouching.filter((c) => c.row.status === "control-noisy");
    if (drifted.length) {
      row.status = "void";
      row.voidedBy = drifted.map((c) => `${c.row.mode} ${reading(c.row)}${c.row.pairs < opts.minPairs ? ` (only ${c.row.pairs} pairs, but it moved)` : ""}`);
    } else if (row.pairs < opts.minPairs) row.status = "thin";
    else if (vouching.length === 0) row.status = "uncontrolled";
    else if (noisy.length === vouching.length) row.status = "noisy-controlled";
    const flat = peers.filter((c) => c.row.status === "control-flat");
    if (flat.length && row.status !== "void") row.notes.push(`control ${flat.map((c) => c.row.mode).join(", ")} ${flat.length === 1 ? "is" : "are"} flat in both runs (pinned at a cap or a floor), so ${flat.length === 1 ? "it" : "they"} could not have shown drift and ${flat.length === 1 ? "does" : "do"} not vouch`);
    if ((row.status !== "ok" && row.status !== "noisy-controlled") || row.basis !== "ratio") continue;
    // The subject over the controls, repetition by repetition: the controls' scatter lands in this interval.
    const withRatios = vouching.filter((c) => c.perRep.size > 0);
    const net: number[] = [];
    for (const [rep, ratio] of p.perRep) {
      const cs = withRatios.map((c) => c.perRep.get(rep)).filter((x): x is number => x !== undefined);
      if (cs.length) net.push(ratio / summarize(cs).median);
    }
    const noisyNote = noisy.map((c) => `${c.row.mode} (ratio ${c.row.ratio!.toFixed(2)}x, interval ${c.row.ciLow!.toFixed(2)} to ${c.row.ciHigh!.toFixed(2)})`).join(", ");
    if (net.length >= opts.minPairs) {
      const s = summarize(net);
      row.net = { ratio: s.median, ciLow: s.medianCiLow, ciHigh: s.medianCiHigh, pairs: net.length, controls: withRatios.map((c) => c.row.mode) };
      if (noisy.length) row.notes.push(`noisy control ${noisyNote}: the raw ratio assumes the machine drifted no more than the control's median shows; the net-of-control ratio assumes the drift is common to the subject and the control, and carries the control's scatter`);
    } else {
      const why = withRatios.length === 0 ? "no vouching control has a per-repetition ratio (the controls are judged on a difference)" : `only ${net.length} repetitions have a control ratio`;
      row.notes.push(`no net-of-control ratio: ${why}${noisy.length ? `; noisy control ${noisyNote}, so read the raw ratio against that scatter` : ""}`);
    }
  }
  const rows = paired.map((p) => p.row);
  if (!rows.some((r) => r.role === "subject")) {
    result.problems.push("no subject metric is in both runs with values, so there is nothing to compare");
    return result;
  }
  result.rows = rows;
  for (const row of rows) result.counts[row.status]++;
  return result;
}
