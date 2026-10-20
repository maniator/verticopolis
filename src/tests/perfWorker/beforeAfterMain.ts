import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stable } from "../perfCompare/calibrate";
import { compareRuns, DEFAULT_CONTROLS, type BeforeAfter, type BeforeAfterOptions, type Row } from "./beforeAfter";
import { csvField, type WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";

/**
 * `npm run perf:before-after -- <BEFORE folder> <AFTER folder> --out <dir>
 * [--controls ts,wasm,wasm-frame] [--subjects wasm-worker] [--tolerance 0.05]
 * [--min-pairs 10]`: the comparison of two `perf:worker` runs of
 * beforeAfter.ts. Writes comparison.json, comparison.csv and comparison.md
 * into the new `--out` folder (never an existing one). Exits 1 when the runs
 * cannot be compared, 0 otherwise; void rows are reported in the files, not
 * hidden by the exit code.
 */
const MODES: ModeName[] = ["ts", "wasm", "wasm-frame", "wasm-worker"];

export interface BeforeAfterArgs {
  before: string;
  after: string;
  out: string;
  options: Partial<BeforeAfterOptions>;
}

export function parseBeforeAfterArgs(argv: string[]): BeforeAfterArgs {
  const folders: string[] = [];
  let out: string | null = null;
  const options: Partial<BeforeAfterOptions> = {};
  const seen = new Set<string>();
  const modes = (flag: string, v: string): ModeName[] => {
    const list = v.split(",").filter(Boolean);
    if (list.length === 0) throw new Error(`${flag} needs at least one mode`);
    const bad = list.find((m) => !MODES.includes(m as ModeName));
    if (bad) throw new Error(`${flag}: "${bad}" is not a mode; expected ${MODES.join(", ")}`);
    return list as ModeName[];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      folders.push(arg);
      continue;
    }
    if (seen.has(arg)) throw new Error(`${arg} is given twice`);
    seen.add(arg);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === "--out") out = value;
    else if (arg === "--controls") options.controls = modes(arg, value);
    else if (arg === "--subjects") options.subjects = modes(arg, value);
    else if (arg === "--tolerance") {
      const x = Number(value);
      if (!(x > 0 && x <= 0.5)) throw new Error("--tolerance needs a number above 0 and at most 0.5");
      options.tolerance = x;
    } else if (arg === "--min-pairs") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 6) throw new Error("--min-pairs needs a whole number of at least 6 (fewer pairs give no interval)");
      options.minPairs = n;
    } else throw new Error(`unknown argument ${arg}; expected two result folders, --out DIR, --controls a,b, --subjects a,b, --tolerance X and --min-pairs N`);
  }
  if (folders.length !== 2) throw new Error("name exactly two perf:worker result folders: BEFORE first, then AFTER");
  if (out === null) throw new Error("--out DIR is required");
  const overlap = (options.controls ?? []).filter((m) => (options.subjects ?? []).includes(m));
  if (overlap.length) throw new Error(`${overlap.join(", ")} is both a control and a subject`);
  return { before: folders[0], after: folders[1], out, options };
}

function load(repo: string, folder: string): { results: WorkerResults; sha256: string } {
  const file = join(resolve(repo, folder), "results.json");
  if (!existsSync(file)) throw new Error(`${resolve(repo, folder)} has no results.json`);
  let results: WorkerResults;
  try {
    results = JSON.parse(readFileSync(file, "utf8")) as WorkerResults;
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  const r = results as Partial<WorkerResults> | null;
  if (!r || !r.config || !r.environment || !r.browser || !Array.isArray(r.metrics) || !Array.isArray(r.runs) || !Array.isArray(r.scenarios) || !r.validation) throw new Error(`${file} is not a perf:worker results.json (config, environment, browser, scenarios, runs, metrics or validation is missing)`);
  return { results, sha256: createHash("sha256").update(stable(results)).digest("hex") };
}

const fmt = (v: number | null, unit: string): string => {
  if (v === null || !Number.isFinite(v)) return "n/a";
  if (unit === "bytes" || unit === "bytes/s") return Math.abs(v) >= 1024 * 1024 ? `${(v / 1024 / 1024).toFixed(2)} MiB` : `${(v / 1024).toFixed(1)} KiB`;
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
};
const ratioText = (r: Row): string => (r.ratio === null ? "n/a" : `${r.ratio.toFixed(2)}x${r.ciLow !== null && r.ciHigh !== null ? ` [${r.ciLow.toFixed(2)}, ${r.ciHigh.toFixed(2)}]` : ""}${r.zeroReference ? ` (${r.zeroReference} zero)` : ""}`);
const diffText = (r: Row): string => (r.diffMedian === null ? "n/a" : `${fmt(r.diffMedian, r.unit)}${r.diffCiLow !== null && r.diffCiHigh !== null ? ` [${fmt(r.diffCiLow, r.unit)}, ${fmt(r.diffCiHigh, r.unit)}]` : ""}`);
const tolText = (t: number): string => `${Number((t * 100).toFixed(2))}%`;
const statusText = (r: Row): string => {
  const plain: Record<Row["status"], string> = { ok: "controlled", void: `VOID (control moved: ${r.voidedBy.join(", ")})`, uncontrolled: "no control for this metric", thin: "too few pairs", "zero-ref": `${r.zeroReference} pair(s) had a zero denominator and left the ratio; read the difference`, "control-drift": "CONTROL MOVED", "control-noisy": "CONTROL TOO NOISY TO VOUCH", "control-ok": "within tolerance" };
  return plain[r.status];
};

export function comparisonCsv(c: BeforeAfter): string {
  const rows = ["role,group,scenario,throttle,metric,unit,mode,before_median,after_median,ratio_above_1_is_worse,ci_low,ci_high,pairs,zero_reference,diff_median,diff_ci_low,diff_ci_high,status,voided_by,unthrottled"];
  for (const r of c.rows) rows.push([r.role, r.group, r.scenario, r.throttle, r.metric, r.unit, r.mode, r.beforeMedian ?? "", r.afterMedian ?? "", r.ratio ?? "", r.ciLow ?? "", r.ciHigh ?? "", r.pairs, r.zeroReference, r.diffMedian ?? "", r.diffCiLow ?? "", r.diffCiHigh ?? "", r.status, r.voidedBy.join("; "), r.unthrottled ?? ""].map(csvField).join(","));
  return rows.join("\n") + "\n";
}

export function comparisonMarkdown(c: BeforeAfter, generatedAt: string): string {
  const L: string[] = [];
  const o = c.options;
  L.push(`# ${c.kind === "A/A" ? "A/A" : "BEFORE/AFTER"} comparison of two perf:worker runs`, "");
  L.push(`> **Snapshot of runs started ${c.before.startedAt} (BEFORE) and ${c.after.startedAt} (AFTER); computed ${generatedAt}.** BEFORE is commit \`${c.before.commit.slice(0, 7)}\` (app ${c.before.appVersion}), AFTER is \`${c.after.commit.slice(0, 7)}\` (app ${c.after.appVersion}). The live number is \`npm run perf:before-after\` (src/tests/perfWorker/beforeAfter.ts, pinned by beforeAfter.test.ts) over the two folders; this file never refreshes.${c.kind === "A/A" ? " Both runs are the same commit and engine build, so every ratio here is noise, not an effect." : ""}`, "");
  if (c.problems.length) {
    L.push("**The runs cannot be compared.** No ratio was computed.", "", ...c.problems.map((p) => `- ${p}`), "");
    return L.join("\n");
  }
  L.push(`Ratios are paired by repetition number (rep i of BEFORE with rep i of AFTER, up to ${c.before.reps} pairs; the median columns are over the paired repetitions), written so that above 1.0 is worse: AFTER over BEFORE for times, memory and counts, BEFORE over AFTER for rates. Intervals are the distribution-free 95% order-statistic interval of the median ratio. The difference column is the median of AFTER minus BEFORE in the metric's unit, for metrics that are often zero.`, "");
  L.push(`**Controls:** ${o.controls.join(", ")}. A control row that moved by more than ${tolText(o.tolerance)} between the runs, or whose interval reaches past it, voids the subject rows of the same metric: the machine, the browser or the load moved, not the code. The tolerance is the cap on δ in protocol section 6.1 until \`perf:calibrate\` has an adopted value, and a candidate effect smaller than it cannot be told from allowed drift. Rows need at least ${o.minPairs} pairs. A row marked controlled is not a verdict: it only means no control moved. The controls run the same code as the candidate unless the candidate leaves it alone; pass \`--controls ts\` when it changes the WASM engine or its host.`, "");
  const thinControls = c.rows.filter((r) => r.role === "control" && r.status === "thin").length;
  L.push(`Rows (subjects): ${c.counts.ok} controlled, ${c.counts.void} void, ${c.counts.uncontrolled} with no control, ${c.counts["zero-ref"]} with a zero denominator, ${c.counts.thin - thinControls} with too few pairs; controls: ${c.counts["control-ok"]} within tolerance, ${c.counts["control-drift"]} moved, ${c.counts["control-noisy"]} too noisy, ${thinControls} thin.`, "");
  if (c.missing.length) L.push("## Metrics not compared", "", ...c.missing.map((m) => `- ${m}`), "");
  const drift = c.rows.filter((r) => r.role === "control" && (r.status === "control-drift" || r.status === "control-noisy" || r.status === "thin"));
  if (drift.length) {
    L.push("## Controls that moved or are thin", "", "| scenario | throttle | metric | mode | ratio | status |", "| --- | --- | --- | --- | --- | --- |");
    for (const r of drift) L.push(`| ${r.scenario} | ${r.throttle}x | ${r.metric} (${r.unit}) | ${r.mode}${r.unthrottled ? " †" : ""} | ${ratioText(r)} | ${statusText(r)} |`);
    L.push("");
  }
  const groups = [...new Set(c.rows.filter((r) => r.role === "subject").map((r) => r.group))];
  for (const g of groups) {
    L.push(`## ${g}`, "", "| scenario | throttle | metric | mode | BEFORE median | AFTER median | ratio (above 1.0 is worse) | difference (AFTER - BEFORE) | status |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of c.rows.filter((x) => x.role === "subject" && x.group === g)) L.push(`| ${r.scenario} | ${r.throttle}x | ${r.metric} (${r.unit}) | ${r.mode}${r.unthrottled ? " †" : ""} | ${fmt(r.beforeMedian, r.unit)} | ${fmt(r.afterMedian, r.unit)} | ${ratioText(r)} | ${diffText(r)} | ${statusText(r)} |`);
    L.push("");
  }
  if (c.rows.some((r) => r.unthrottled)) L.push("† The engine worker was not CPU-throttled at this throttle (DevTools cannot throttle a worker); both runs share that, so a ratio between them compares like with like, but throttled controls do not vouch for the worker thread's own speed.", "");
  L.push("## Inputs", "", "| Run | Commit | Engine build hash | results.json SHA-256 (canonical) |", "| --- | --- | --- | --- |", `| BEFORE | ${c.before.commit} | ${c.before.engineBuildHash ?? "n/a"} | ${c.before.sha256 ?? "n/a"} |`, `| AFTER | ${c.after.commit} | ${c.after.engineBuildHash ?? "n/a"} | ${c.after.sha256 ?? "n/a"} |`, "");
  L.push("## What this comparison cannot tell", "", "- Anything the two runs' validation did not cover: it adds no check of the delta oracle, save fidelity, event order or crash recovery, which are tests.", "- Whether a 4x worker row would hold on a CPU that is really 4x slower: the worker thread is not throttled (†).", "- An hourly main-thread spike beyond the per-batch maximum and the frame-time p99 rows (no separate hour-pass row yet).", "");
  return L.join("\n");
}

export function main(argv: string[], repo: string, now: () => string = () => new Date().toISOString()): number {
  const args = parseBeforeAfterArgs(argv);
  const out = resolve(repo, args.out);
  if (existsSync(out)) throw new Error(`${out} already exists; results are never overwritten`);
  const before = load(repo, args.before);
  const after = load(repo, args.after);
  const c = compareRuns(before.results, after.results, { controls: DEFAULT_CONTROLS, ...args.options }, { before: before.sha256, after: after.sha256 });
  const generatedAt = now();
  // Render everything before the folder exists, so a late throw leaves nothing half-written to block a rerun.
  const files: [string, string][] = [["comparison.json", JSON.stringify({ generatedAt, ...c }, null, 1) + "\n"], ["comparison.csv", comparisonCsv(c)], ["comparison.md", comparisonMarkdown(c, generatedAt)]];
  mkdirSync(out, { recursive: false });
  for (const [name, text] of files) writeFileSync(join(out, name), text);
  process.stdout.write(`perf:before-after: wrote ${out} (${c.problems.length ? `cannot compare: ${c.problems.length} problem(s)` : `${c.counts.ok} controlled, ${c.counts.void} void, ${c.counts.uncontrolled} uncontrolled, ${c.counts["zero-ref"]} with a zero denominator, ${c.counts["control-drift"] + c.counts["control-noisy"]} control(s) moved or noisy, ${c.missing.length} metric(s) not compared`})\n`);
  return c.problems.length ? 1 : 0;
}
