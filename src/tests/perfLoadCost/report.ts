import { pairedDifference, summarize } from "../perfCompare/stats";
import { CONDITIONS, CONDITION_TEXT, STEP_MARKS, type Condition, type LoadSample } from "./sample";

export const ARMS = ["before", "after"] as const;
export type Arm = (typeof ARMS)[number];

/** One kept run. `rep` pairs a before run with an after run. */
export interface Row {
  arm: Arm;
  condition: Condition;
  throttle: number;
  rep: number;
  sample: LoadSample;
}

/** A run that did not produce a sample, kept so the report can say how many were refused. */
export interface Refusal {
  arm: Arm;
  condition: Condition;
  throttle: number;
  rep: number;
  error: string;
}

export interface Metric {
  name: string;
  unit: string;
  pick(s: LoadSample): number | null;
}

export const METRICS: readonly Metric[] = [
  { name: "engine ready", unit: "ms", pick: (s) => s.readyMs },
  { name: "wasm fetch (resource timing)", unit: "ms", pick: (s) => s.wasmFetchMs },
  ...STEP_MARKS.map((n, i): Metric => ({ name: `first ${n} steps`, unit: "ms", pick: (s) => s.stepsMs[i] ?? null })),
  { name: "long tasks before the first step", unit: "count", pick: (s) => s.longTasks },
  { name: "longest long task", unit: "ms", pick: (s) => s.longestTaskMs },
];

/** The repeat-boot thresholds of the decision rule: above these the two mitigations go to the owner. */
export const DECISION_MS = { oneX: 100, slow: 400 } as const;

const fmt = (n: number | null | undefined, digits = 1): string => (n === null || n === undefined || !Number.isFinite(n) ? "-" : n.toFixed(digits));

function valuesOf(rows: readonly Row[], arm: Arm, metric: Metric): { reps: number[]; values: number[] } {
  const reps: number[] = [];
  const values: number[] = [];
  for (const r of rows.filter((x) => x.arm === arm).sort((a, b) => a.rep - b.rep)) {
    const v = metric.pick(r.sample);
    if (v === null) continue;
    reps.push(r.rep);
    values.push(v);
  }
  return { reps, values };
}

/** The table for one condition at one throttle. */
export function conditionTable(rows: readonly Row[], condition: Condition, throttle: number): string[] {
  const here = rows.filter((r) => r.condition === condition && r.throttle === throttle);
  const lines = [`### ${condition}, ${CONDITION_TEXT[condition]}, ${throttle}x CPU`, "", "| Metric | before median | after median | after minus before (median, 95% interval) | pairs |", "| --- | --- | --- | --- | --- |"];
  for (const m of METRICS) {
    const b = valuesOf(here, "before", m);
    const a = valuesOf(here, "after", m);
    const sb = b.values.length ? summarize(b.values) : null;
    const sa = a.values.length ? summarize(a.values) : null;
    const d = pairedDifference(a, b);
    const diff = d ? `${fmt(d.median)} (${fmt(d.ciLow)} to ${fmt(d.ciHigh)})` : "-";
    lines.push(`| ${m.name} (${m.unit}) | ${fmt(sb?.median)} | ${fmt(sa?.median)} | ${diff} | ${d?.n ?? 0} |`);
  }
  return [...lines, ""];
}

/** The decision-rule line for the repeat boot (L2): which branch the engine-ready difference falls in. */
export function decisionLine(rows: readonly Row[], throttle: number): string {
  const here = rows.filter((r) => r.condition === "L2" && r.throttle === throttle);
  const ready = METRICS[0];
  const d = pairedDifference(valuesOf(here, "after", ready), valuesOf(here, "before", ready));
  if (!d) return `L2 at ${throttle}x: no paired difference (too few kept runs).`;
  const limit = throttle === 1 ? DECISION_MS.oneX : DECISION_MS.slow;
  const branch = d.median >= limit ? `at or above ${limit} ms: bring the two mitigations to the owner` : `under ${limit} ms: compare it with the calibrated noise floor (epsilon) before calling it a cost`;
  return `L2 at ${throttle}x: engine ready after minus before is ${fmt(d.median)} ms (${fmt(d.ciLow)} to ${fmt(d.ciHigh)}, ${d.n} pairs), ${branch}.`;
}

export interface Header {
  window: string;
  before: string;
  after: string;
  machine: string;
  reps: number;
  command: string;
}

/** The whole readout. The window and the regenerating command come first, per the snapshot rule. */
export function reportMarkdown(rows: readonly Row[], refusals: readonly Refusal[], header: Header, throttles: readonly number[], conditions: readonly Condition[] = CONDITIONS): string {
  const out = [
    "# Engine load cost, before and after the verified loader (#985)",
    "",
    `This is a snapshot, not a live figure. Window: ${header.window}. Regenerate with \`${header.command}\`; the aggregation is \`src/tests/perfLoadCost/report.ts\` (tested in \`report.test.ts\`).`,
    "",
    `- before: ${header.before}`,
    `- after: ${header.after}`,
    `- machine: ${header.machine}`,
    `- repetitions requested per arm per condition per throttle: ${header.reps}`,
    "",
  ];
  for (const t of throttles) for (const c of conditions) out.push(...conditionTable(rows, c, t));
  out.push("## Decision rule", "");
  for (const t of throttles) out.push(`- ${decisionLine(rows, t)}`);
  out.push("", "## Refused runs", "");
  if (refusals.length === 0) out.push("None.");
  else for (const r of refusals) out.push(`- ${r.arm} ${r.condition} ${r.throttle}x rep ${r.rep}: ${r.error}`);
  out.push("");
  return out.join("\n");
}
