import { pairedRatio, verdict } from "../perfCompare/stats";
import type { WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";

/**
 * The cross-run comparison for a before/after pair of `perf:worker` runs
 * (#1068): one run on the merge base, one on the branch, each from its own
 * clean worktree. Every row pairs the two runs' repetitions (the same rep
 * number), takes after over before per repetition, and reports the median
 * ratio with the order-statistic interval `perfCompare/stats.ts` defines.
 *
 * The modes the change does not touch (TypeScript, the main-thread WASM
 * hosts) are controls: their rows must come out equivalent, or the two runs
 * did not measure the same machine and nothing else in the pair counts. The
 * band is the 5% working threshold (OD-7); a calibrated tolerance replaces
 * it once `perf:calibrate` has a real PC calibration behind it.
 */
export const CONTROL_MODES: readonly ModeName[] = ["ts", "wasm", "wasm-frame"];

/** Rows a control must hold equivalent: wall and main-thread time of the
 *  hosted run, and the bare engine step. Rates and counts vary run to run
 *  without saying anything about the machine. */
const CONTROL_METRICS = /^(wall time, |main-thread time, |bare engine, )/;

export type CrossInput = Pick<WorkerResults, "config" | "environment" | "browser" | "scenarios" | "metrics" | "validation">;

export interface CrossRow {
  group: string;
  scenario: string;
  throttle: string;
  metric: string;
  unit: string;
  better: "lower" | "higher";
  mode: ModeName;
  role: "control" | "subject";
  /** After over before, the median of the paired ratios. */
  ratio: number;
  ciLow: number | null;
  ciHigh: number | null;
  n: number;
  /** Pairs dropped because the before value was 0. */
  zeroReference: number;
  verdict: "higher" | "lower" | "equivalent" | "inconclusive";
}

export interface CrossResult {
  /** Why the pair cannot be compared at all (the rows are then empty). */
  errors: string[];
  /** Control rows outside the band: each one voids its scenario and throttle. */
  voided: { scenario: string; throttle: string; rows: string[] }[];
  rows: CrossRow[];
}

export interface CrossOptions {
  /** Pairs a row needs; the PC protocol asks for ten valid paired reps. */
  minReps?: number;
  band?: number;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Why two runs cannot be compared: anything that makes them differ other
 *  than the commit under test. */
export function crossErrors(before: CrossInput, after: CrossInput, minReps: number): string[] {
  const errors: string[] = [];
  for (const [name, r] of [["before", before], ["after", after]] as const) {
    if (!r.validation.ok) errors.push(`the ${name} run failed its own validation`);
    if (r.config.quick) errors.push(`the ${name} run is a --quick smoke run`);
    if (r.config.reps < minReps) errors.push(`the ${name} run has ${r.config.reps} repetitions; ${minReps} are needed`);
    if (r.environment.dirty) errors.push(`the ${name} run was on a dirty tree`);
  }
  if (before.environment.commit === after.environment.commit) errors.push("both runs are the same commit");
  if (!same(before.config, after.config)) errors.push("the two runs used different configurations");
  if (!same(before.scenarios.map((s) => [s.name, s.sha256]), after.scenarios.map((s) => [s.name, s.sha256]))) errors.push("the two runs measured different towers");
  const machine = (r: CrossInput) => ({ ...r.browser, cpu: r.environment.cpuModel, cpus: r.environment.logicalCpus, memory: r.environment.totalMemoryBytes, os: r.environment.os, kernel: r.environment.kernel, arch: r.environment.arch, node: r.environment.node, playwright: r.environment.playwright });
  if (!same(machine(before), machine(after))) errors.push("the two runs differ in browser, machine or toolchain");
  if (after.environment.mergeBase !== before.environment.commit) errors.push(`the after run's merge base with main (${after.environment.mergeBase ?? "unknown"}) is not the before run's commit (${before.environment.commit}): the pair is not main versus main plus the change`);
  return errors;
}

export function crossRun(before: CrossInput, after: CrossInput, opts: CrossOptions = {}): CrossResult {
  const minReps = opts.minReps ?? 10;
  const band = opts.band ?? 0.05;
  const errors = crossErrors(before, after, minReps);
  if (errors.length > 0) return { errors, voided: [], rows: [] };
  const index = new Map(before.metrics.map((m) => [`${m.group}|${m.scenario}|${m.throttle}|${m.metric}|${m.mode}`, m]));
  const rows: CrossRow[] = [];
  for (const a of after.metrics) {
    const b = index.get(`${a.group}|${a.scenario}|${a.throttle}|${a.metric}|${a.mode}`);
    if (!b) continue;
    const earlier = new Map(b.reps.map((rep, i) => [rep, b.values[i]]));
    const pairs: [number, number][] = [];
    let zeroReference = 0;
    a.reps.forEach((rep, i) => {
      const was = earlier.get(rep);
      if (was === undefined) return;
      if (was === 0) zeroReference++;
      else pairs.push([a.values[i], was]);
    });
    if (pairs.length === 0) continue;
    const p = pairedRatio(pairs);
    rows.push({ group: a.group, scenario: a.scenario, throttle: a.throttle, metric: a.metric, unit: a.unit, better: a.better, mode: a.mode, role: CONTROL_MODES.includes(a.mode) ? "control" : "subject", ratio: p.ratio, ciLow: p.ciLow, ciHigh: p.ciHigh, n: p.n, zeroReference, verdict: verdict(p, band) });
  }
  const bad = new Map<string, { scenario: string; throttle: string; rows: string[] }>();
  const controls = rows.filter((r) => r.role === "control" && CONTROL_METRICS.test(r.metric));
  for (const r of controls) {
    // A control with too few pairs or an interval that does not sit inside
    // the band cannot vouch for the machine.
    if (r.n >= minReps && r.verdict === "equivalent") continue;
    const key = `${r.scenario}|${r.throttle}`;
    const entry = bad.get(key) ?? { scenario: r.scenario, throttle: r.throttle, rows: [] };
    entry.rows.push(`${r.mode}: ${r.metric} (ratio ${r.ratio.toFixed(3)}, n=${r.n})`);
    bad.set(key, entry);
  }
  // A scenario and throttle with no control row at all vouches for nothing.
  for (const r of rows) {
    if (r.role !== "subject" || r.group === "startup" || r.group === "memory") continue;
    if (controls.some((c) => c.scenario === r.scenario && c.throttle === r.throttle)) continue;
    const key = `${r.scenario}|${r.throttle}`;
    if (!bad.has(key)) bad.set(key, { scenario: r.scenario, throttle: r.throttle, rows: ["no control row to vouch for this scenario and throttle"] });
  }
  return { errors: [], voided: [...bad.values()], rows };
}

export function crossMarkdown(before: CrossInput, after: CrossInput, result: CrossResult): string {
  const lines = ["# perf:worker before and after", "", `Before: \`${before.environment.commit}\`. After: \`${after.environment.commit}\`. Ratios are after over before (below 1 is faster for times).`, ""];
  if (result.errors.length > 0) return [...lines, "**Not comparable:**", ...result.errors.map((e) => `- ${e}`), ""].join("\n");
  if (result.voided.length > 0) lines.push("**Void (a control moved):**", ...result.voided.map((v) => `- ${v.scenario} at ${v.throttle}x: ${v.rows.join("; ")}`), "");
  else lines.push("Every control row is equivalent within the band.", "");
  lines.push("| scenario | throttle | metric | mode | role | ratio | 95% CI | n | verdict |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  const f = (x: number | null) => (x === null ? "-" : x.toFixed(3));
  for (const r of result.rows) lines.push(`| ${r.scenario} | ${r.throttle} | ${r.metric} | ${r.mode} | ${r.role} | ${f(r.ratio)} | ${f(r.ciLow)} to ${f(r.ciHigh)} | ${r.n} | ${r.verdict} |`);
  return [...lines, ""].join("\n");
}
