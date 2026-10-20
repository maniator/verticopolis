import { quantile, summarize } from "../perfCompare/stats";
import type { RestoreRun, Workload } from "./page";

/** One timed workload in one browser process, at one CPU throttle. */
export interface MeasuredRun extends RestoreRun {
  rep: number;
  throttle: number;
}

export const WORKLOADS: readonly Workload[] = ["plain", "drag", "click", "edits"];
const SCENARIO_ORDER = ["small", "medium", "large"];

/** One row of the report: a scenario, a workload and a throttle, over the
 *  repetitions. Times are medians across repetitions of each run's own
 *  figure, so one slow process cannot set a row alone. A faulted run
 *  counts in no figure (the Problems section names it). */
export interface Row {
  scenario: string;
  workload: Workload;
  throttle: number;
  /** Clean runs: the figures below come from these alone. */
  reps: number;
  stepMedianMs: number;
  stepP95Ms: number;
  stepMaxMs: number;
  /** Counts summed over the clean runs. Merges' and hosted saves are
   *  restore points at no extra cost; extra saves are the ones the points
   *  added (the design expects 0). */
  merges: number;
  hostedSaves: number;
  extraSaves: number;
  commands: number;
  accepted: number;
  /** Every engine save per command, and the time inside them per command:
   *  what serialization costs a burst of edits. */
  savesPerCommand: number;
  saveMsPerCommand: number;
  /** Time in the event pulls per step, and its share of the step time. */
  pullMsPerStep: number;
  pullShare: number;
  /** What one restore point costs on this tower (median), its size, and
   *  what the rows' extra points added per step. */
  pointSaveMs: number;
  pointChars: number;
  extraSaveMsPerStep: number;
  /** What a fallback pays once, at the fault (median of each run's median). */
  restoreMs: number;
}

const median = (values: readonly number[]): number => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? quantile([...finite].sort((a, b) => a - b), 0.5) : Number.NaN;
};
const ratio = (a: number, b: number) => (b > 0 ? a / b : Number.NaN);

export function rows(runs: readonly MeasuredRun[]): Row[] {
  const groups = new Map<string, MeasuredRun[]>();
  for (const r of runs) {
    const key = `${r.scenario}|${r.workload}|${r.throttle}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: Row[] = [];
  for (const all of groups.values()) {
    const first = all[0];
    const group = all.filter((r) => !r.fault && r.stepMs.length > 0);
    const per = group.map((r) => {
      const s = summarize(r.stepMs);
      const total = r.stepMs.reduce((a, b) => a + b, 0);
      const point = median(r.pointSaveMs);
      return {
        s,
        point,
        pullPerStep: ratio(r.pullMs, r.steps),
        pullShare: ratio(r.pullMs, total),
        extraPerStep: ratio(r.extraSaves * point, r.steps),
        savesPerCommand: ratio(r.saves, r.commands),
        saveMsPerCommand: ratio(r.saveMs, r.commands),
      };
    });
    const sum = (f: (r: MeasuredRun) => number) => group.reduce((a, r) => a + f(r), 0);
    out.push({
      scenario: first.scenario,
      workload: first.workload,
      throttle: first.throttle,
      reps: group.length,
      stepMedianMs: median(per.map((p) => p.s.median)),
      stepP95Ms: median(per.map((p) => p.s.p95)),
      stepMaxMs: per.length ? Math.max(...per.map((p) => p.s.max)) : Number.NaN,
      merges: sum((r) => r.merges),
      hostedSaves: sum((r) => r.hostedSaves),
      extraSaves: sum((r) => r.extraSaves),
      commands: sum((r) => r.commands),
      accepted: sum((r) => r.accepted),
      savesPerCommand: median(per.map((p) => p.savesPerCommand)),
      saveMsPerCommand: median(per.map((p) => p.saveMsPerCommand)),
      pullMsPerStep: median(per.map((p) => p.pullPerStep)),
      pullShare: median(per.map((p) => p.pullShare)),
      pointSaveMs: median(per.map((p) => p.point)),
      pointChars: median(group.map((r) => r.pointChars)),
      extraSaveMsPerStep: median(per.map((p) => p.extraPerStep)),
      restoreMs: median(group.map((r) => median(r.restoreMs))),
    });
  }
  const order = (r: Row) => [SCENARIO_ORDER.indexOf(r.scenario), WORKLOADS.indexOf(r.workload), r.throttle];
  return out.sort((a, b) => {
    const x = order(a);
    const y = order(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
}

/** Why the run cannot stand as evidence, if anything. */
export function problems(runs: readonly MeasuredRun[], expected: number, tree: { dirty: boolean }): string[] {
  const out: string[] = [];
  if (tree.dirty) out.push("the working tree had uncommitted changes, so the run is not tied to its commit");
  for (const r of runs) {
    const at = `rep ${r.rep + 1}, ${r.scenario} ${r.workload} at ${r.throttle}x`;
    if (r.fault) out.push(`${at}: ${r.fault}`);
    if (r.commands < r.planned) out.push(`${at}: issued ${r.commands} of the ${r.planned} commands it planned, so the workload did not run as described`);
    if (r.accepted < r.commands) out.push(`${at}: the tower refused ${r.commands - r.accepted} of ${r.commands} commands, so the workload did not run as described`);
    if (r.extraSaves > 0) out.push(`${at}: ${r.extraSaves} engine saves beyond the merges' and the hosted ones, which the design expects to be 0`);
    if (r.extraSaves < 0) out.push(`${at}: the merges and hosted saves counted exceed the engine's saves by ${-r.extraSaves}, so the save counts cannot be trusted`);
    // Each rapid edit's undo capture reads a hosted save; fewer means the
    // captures stopped reading one, and the rows measured a plain drag.
    if (r.workload === "edits" && r.hostedSaves < r.commands) out.push(`${at}: ${r.hostedSaves} hosted saves for ${r.commands} edits, so the edits' undo captures did not each read a save and the rapid-edit check did not run`);
  }
  if (runs.length < expected) out.push(`${expected - runs.length} of ${expected} runs are missing`);
  return out;
}

export interface ReportMeta {
  date: string;
  commit: string;
  dirty: boolean;
  quick: boolean;
  cpu: string;
  os: string;
  browser: string | null;
  /** Whether the page was cross-origin isolated (a finer clock); null
   *  when no run finished. */
  crossOriginIsolated: boolean | null;
  reps: number;
  throttles: number[];
  steps: Record<Workload, number>;
  clickEvery: number;
  dt: number;
}

const ms = (v: number) => {
  if (!Number.isFinite(v)) return "n/a";
  return v < 1 ? v.toFixed(3) : v.toFixed(1);
};
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "n/a");
const num = (v: number, digits: number) => (Number.isFinite(v) ? v.toFixed(digits) : "n/a");

export function markdown(meta: ReportMeta, table: readonly Row[], issues: readonly string[]): string {
  const clock = meta.crossOriginIsolated === false ? " The page was not cross-origin isolated, so its clock is coarse (about 0.1 ms) and the sub-millisecond figures are approximate." : "";
  const lines = [
    "# Restore-point overhead (#874)",
    "",
    `> **Snapshot of one run on ${meta.date}, commit \`${meta.commit.slice(0, 7)}\`${meta.dirty ? " (dirty tree)" : ""}, not refreshing.** ${meta.cpu}, ${meta.os}, ${meta.browser ?? "browser unknown"}. ${meta.quick ? "A `--quick` smoke run: it never counts." : "Evidence only when it ran on the owner's desktop under `docs/performance/benchmark-protocol.md` and is committed; a cloud container's run is indicative only."} To refresh, run \`npm run perf:restore\` (\`scripts/perf-restore-points.ts\`); \`src/tests/perfRestore/report.test.ts\` pins how these figures are computed.${clock}`,
    "",
    "What it measures: the work the runtime fallback's restore points add to a hosted tower. Every engine save the host already reads is a restore point at no cost: a merge's, and a hosted save's (an undo capture, an autosave, an export; each read the engine's save on main too). The points add an engine save only when a tick's events would leave the engine with no point behind them, plus each relayed command's pull of its own events. Each workload runs on the hosted tower at each CPU throttle, in a fresh browser process per repetition, and every step ends with the frame loop's event drain:",
    "",
    `- **plain**: ${meta.steps.plain} steps of ${meta.dt} game minutes, no commands.`,
    `- **drag**: ${meta.steps.drag} steps, each placing one floor tile first (a structural command that merges at the next sync, as a floor drag does).`,
    `- **click**: ${meta.steps.click} steps with a rent change every ${meta.clickEvery} (a plain command with an event).`,
    `- **edits**: ${meta.steps.edits} steps, each a whole gesture: an undo capture, one floor tile and the commit, as rapid single clicks are.`,
    "",
    "## Steps",
    "",
    "Step times are the median over repetitions of each run's median and 95th percentile, and the slowest step of any run. *Pulls* is the time inside the engine's event exports per step, and its share of the step.",
    "",
    "| Scenario | Workload | CPU | Reps | Step median ms | Step p95 ms | Step max ms | Pulls ms/step | Pull share |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...table.map((r) => `| ${r.scenario} | ${r.workload} | ${r.throttle}x | ${r.reps} | ${ms(r.stepMedianMs)} | ${ms(r.stepP95Ms)} | ${ms(r.stepMaxMs)} | ${ms(r.pullMsPerStep)} | ${pct(r.pullShare)} |`),
    "",
    "## Saves",
    "",
    "Counts are summed over the repetitions. *Hosted saves* are the tower's own saves (each undo capture reads one). *Extra saves* are engine saves beyond the merges' and the hosted ones: the restore points' own cost, which the design expects to be 0. *Saves per command* and *save ms per command* count every engine save, merges' and captures' included, so they show what serialization costs each edit. *One point* is what a single restore point costs on that tower (`engine.serialize`), and *point size* its length; the host holds up to three. *Restore* is what a fallback pays once, at the fault (parse the point and load it on TypeScript).",
    "",
    "| Scenario | Workload | CPU | Commands (accepted) | Merges | Hosted saves | Extra saves | Saves per command | Save ms per command | Extra save ms/step | One point ms | Point size (M chars) | Restore ms |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...table.map(
      (r) =>
        `| ${r.scenario} | ${r.workload} | ${r.throttle}x | ${r.commands} (${r.accepted}) | ${r.merges} | ${r.hostedSaves} | ${r.extraSaves} | ${num(r.savesPerCommand, 2)} | ${ms(r.saveMsPerCommand)} | ${ms(r.extraSaveMsPerStep)} | ${ms(r.pointSaveMs)} | ${num(r.pointChars / 1e6, 2)} | ${ms(r.restoreMs)} |`,
    ),
    "",
    issues.length ? "## Problems (the run does not stand as evidence)" : "## Problems",
    "",
    ...(issues.length ? issues.map((i) => `- ${i}`) : ["None."]),
    "",
  ];
  return lines.join("\n");
}
