import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stable } from "../perfCompare/calibrate";
import { BLOCKING_EPSILON_MS, compareRuns, resolveControls, type BeforeAfter, type BeforeAfterOptions, type Row } from "./beforeAfter";
import { csvField, type WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";

/**
 * `npm run perf:before-after -- <BEFORE folder> <AFTER folder> --out <dir>
 * [--controls ts,wasm,wasm-frame] [--subjects wasm-worker] [--tolerance 0.05]
 * [--min-pairs 10]`: the comparison of two `perf:worker` runs of
 * beforeAfter.ts. Writes comparison.json, comparison.csv and comparison.md
 * into the new `--out` folder (never an existing one). Exit codes: 0 when the
 * runs could be compared (void, uncontrolled and regressed rows are in the
 * files, and the exit code says nothing about them), 1 when they cannot be
 * compared, 2 for a usage error or an unreadable input (nothing is written).
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
  if (options.tolerance !== undefined && options.tolerance > 0.05) process.stderr.write(`perf:before-after: --tolerance ${options.tolerance} is looser than the 5% cap on δ (protocol section 6.1); the report says so\n`);
  return { before: folders[0], after: folders[1], out, options };
}

function load(repo: string, folder: string): { results: WorkerResults; sha256: string } {
  const file = join(resolve(repo, folder), "results.json");
  if (!existsSync(file)) throw new Error(`${resolve(repo, folder)} has no results.json`);
  let results: WorkerResults;
  try {
    results = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as WorkerResults;
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
const ratioText = (r: Row): string => {
  if (r.basis === "difference") return "no ratio";
  if (r.ratio === null) return "n/a";
  return `${r.ratio.toFixed(2)}x${r.ciLow !== null && r.ciHigh !== null ? ` [${r.ciLow.toFixed(2)}, ${r.ciHigh.toFixed(2)}]` : ""}`;
};
const netText = (r: Row): string => (r.net ? `${r.net.ratio.toFixed(2)}x${r.net.ciLow !== null && r.net.ciHigh !== null ? ` [${r.net.ciLow.toFixed(2)}, ${r.net.ciHigh.toFixed(2)}]` : ""}` : "n/a");
const diffText = (r: Row): string => (r.diffMedian === null ? "n/a" : `${fmt(r.diffMedian, r.unit)}${r.diffCiLow !== null && r.diffCiHigh !== null ? ` [${fmt(r.diffCiLow, r.unit)}, ${fmt(r.diffCiHigh, r.unit)}]` : ""}${r.zeroReference ? ` (${r.zeroReference} zero reference)` : ""}`);
const tolText = (t: number): string => `${Number((t * 100).toFixed(2))}%`;
const statusText = (r: Row): string => {
  const plain: Record<Row["status"], string> = { ok: `controlled${r.unthrottled ? " (main thread only)" : ""}`, void: `VOID (control moved: ${r.voidedBy.join(", ")})`, uncontrolled: "no control for this metric", thin: `too few pairs (${r.pairs})`, "control-drift": "CONTROL MOVED", "control-noisy": "control noisy but its median held", "control-ok": "within tolerance", "control-flat": "CONTROL FLAT (cannot show drift, does not vouch)", "noisy-controlled": `controlled by noisy controls only${r.unthrottled ? " (main thread only)" : ""}` };
  return [plain[r.status], ...r.notes].join("; ");
};

export function comparisonCsv(c: BeforeAfter): string {
  const rows = ["role,group,scenario,throttle,metric,unit,mode,basis,before_median,after_median,ratio_above_1_is_worse,ci_low,ci_high,net_ratio,net_ci_low,net_ci_high,pairs,zero_reference,diff_worse_is_positive,diff_ci_low,diff_ci_high,status,voided_by,notes,unthrottled"];
  for (const r of c.rows) rows.push([r.role, r.group, r.scenario, r.throttle, r.metric, r.unit, r.mode, r.basis, r.beforeMedian ?? "", r.afterMedian ?? "", r.ratio ?? "", r.ciLow ?? "", r.ciHigh ?? "", r.net?.ratio ?? "", r.net?.ciLow ?? "", r.net?.ciHigh ?? "", r.pairs, r.zeroReference, r.diffMedian ?? "", r.diffCiLow ?? "", r.diffCiHigh ?? "", r.status, r.voidedBy.join("; "), r.notes.join("; "), r.unthrottled ?? ""].map(csvField).join(","));
  return rows.join("\n") + "\n";
}

export function comparisonMarkdown(c: BeforeAfter, generatedAt: string): string {
  const L: string[] = [];
  const o = c.options;
  L.push(`# ${c.kind === "A/A" ? "A/A" : "BEFORE/AFTER"} comparison of two perf:worker runs`, "");
  L.push(`> **Snapshot of runs started ${c.before.startedAt} (BEFORE) and ${c.after.startedAt} (AFTER); computed ${generatedAt}.** BEFORE is commit \`${c.before.commit.slice(0, 7)}\` (app ${c.before.appVersion}), AFTER is \`${c.after.commit.slice(0, 7)}\` (app ${c.after.appVersion}). The live number is \`npm run perf:before-after\` (src/tests/perfWorker/beforeAfter.ts, pinned by beforeAfter.test.ts) over the two folders; this file never refreshes.${c.kind === "A/A" ? " Both runs are the same commit and engine build, so every ratio here is noise." : ""}`, "");
  if (c.problems.length) {
    L.push("**The runs cannot be compared.** No ratio was computed.", "", ...c.problems.map((p) => `- ${p}`), "");
    return L.join("\n");
  }
  if (o.tolerance > 0.05) L.push(`> **The tolerance is ${tolText(o.tolerance)}, looser than the 5% cap on δ in protocol section 6.1.** Drift up to that size does not void a row.`, "");
  L.push(`Ratios are paired by repetition number (rep i of BEFORE with rep i of AFTER, up to ${c.before.reps} pairs; the median columns are over the paired repetitions), written so that above 1.0 is worse: AFTER over BEFORE for times and memory, BEFORE over AFTER for rates. Intervals are the distribution-free order-statistic interval of the median (at least 95%; 97.9% at 10 pairs). Counts, blocking time and any metric with a zero denominator have no ratio: they are read on the difference column, the median of the per-repetition difference signed so that positive is worse.`, "");
  L.push(`**Controls:** ${o.controls.join(", ")}${o.subjects ? `; subjects: ${o.subjects.join(", ")}` : ""}${c.unlisted.length ? `; left out of the report: ${c.unlisted.join(", ")}` : ""}. A control whose median ratio moved by more than ${tolText(o.tolerance)} between the runs in either direction, or (for blocking time) whose median difference moved by more than ${BLOCKING_EPSILON_MS} ms, or (for other differences) by more than that share of its own size, voids the subject rows of the same metric, even when it has too few pairs for an interval: the machine, the browser or the load moved and the code did not. A control whose median held but whose pairs scatter past the tolerance is called noisy; it still vouches, but a subject that only noisy controls vouch for is marked as such. The raw ratio assumes the machine drifted no more than the control's median shows. The "net of control" column, the subject's ratio over the controls' ratio repetition by repetition, assumes the drift is common to the subject and the control and carries the control's scatter in its interval; it exists only for ratio rows with a control that has a per-repetition ratio. A control on a frame-loop rate or time, blocking or a count whose values stay within a third of the tolerance of each other in both runs (a rate pinned at its cap, blocking that stays at zero) is flat; heap sizes, byte counts and hosted CPU times are never flat, however precise: it could not have shown drift, so it does not vouch. The tolerance is the cap on δ in protocol section 6.1 until \`perf:calibrate\` has an adopted value, and an effect smaller than it cannot be told from allowed drift. Rows need at least ${o.minPairs} pairs. A row marked controlled is not a verdict: it only means no control moved. The default controls are \`ts\`, \`wasm\` and \`wasm-frame\` for two runs of one build and \`ts\` alone when the commit or the engine build differs, because the candidate then moves the WASM modes.`, "");
  const thinControls = c.rows.filter((r) => r.role === "control" && r.status === "thin").length;
  L.push(`Rows (subjects): ${c.counts.ok} controlled, ${c.counts["noisy-controlled"]} controlled by noisy controls only, ${c.counts.void} void, ${c.counts.uncontrolled} with no control, ${c.counts.thin - thinControls} with too few pairs; controls: ${c.counts["control-ok"]} within tolerance, ${c.counts["control-noisy"]} noisy with a steady median, ${c.counts["control-flat"]} flat, ${c.counts["control-drift"]} moved, ${thinControls} thin. ${c.notMeasured} metric row(s) have no values in either run and are left out.`, "");
  if (c.missing.length) L.push("## Metrics not compared", "", ...c.missing.map((m) => `- ${m}`), "");
  const drift = c.rows.filter((r) => r.role === "control" && (r.basis === "difference" || r.status === "control-drift" || r.status === "control-noisy" || r.status === "control-flat" || r.status === "thin"));
  if (drift.length) {
    L.push("## Controls that moved, are noisy, flat or thin, and every control on a difference", "", "| scenario | throttle | metric | mode | ratio | difference (worse is positive) | pairs | status |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of drift) L.push(`| ${r.scenario} | ${r.throttle}x | ${r.metric} (${r.unit}) | ${r.mode}${r.unthrottled ? " †" : ""} | ${ratioText(r)} | ${diffText(r)} | ${r.pairs} | ${statusText(r)} |`);
    L.push("");
  }
  const groups = [...new Set(c.rows.filter((r) => r.role === "subject").map((r) => r.group))];
  for (const g of groups) {
    L.push(`## ${g}`, "", "| scenario | throttle | metric | mode | BEFORE median | AFTER median | ratio (above 1.0 is worse) | net of control | difference (worse is positive) | pairs | status |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of c.rows.filter((x) => x.role === "subject" && x.group === g)) L.push(`| ${r.scenario} | ${r.throttle}x | ${r.metric} (${r.unit}) | ${r.mode}${r.unthrottled ? " †" : ""} | ${fmt(r.beforeMedian, r.unit)} | ${fmt(r.afterMedian, r.unit)} | ${ratioText(r)} | ${netText(r)} | ${diffText(r)} | ${r.pairs} | ${statusText(r)} |`);
    L.push("");
  }
  if (c.rows.some((r) => r.unthrottled)) L.push("† The engine worker was barely CPU-throttled: DevTools cannot throttle a worker, and a busy loop in one ran 7 to 41% slower with the page at 4x, against about 4x on the main thread. Both runs share that, so a ratio between them compares like with like, but the throttled main-thread controls vouch for the main thread only, and a 4x worker row says nothing about a CPU that is really 4x slower.", "");
  L.push("## Inputs", "", "| Run | Commit | Engine build hash | results.json SHA-256 (canonical) |", "| --- | --- | --- | --- |", `| BEFORE | ${c.before.commit} | ${c.before.engineBuildHash ?? "n/a"} | ${c.before.sha256 ?? "n/a"} |`, `| AFTER | ${c.after.commit} | ${c.after.engineBuildHash ?? "n/a"} | ${c.after.sha256 ?? "n/a"} |`, "");
  L.push("## What this comparison cannot tell", "", "- That the two runs used the same harness. The results do not record a harness hash, so protocol section 6.2 asks for a check of `git diff` over `src/tests/perfWorker`, `src/tests/perfCompare` and `scripts` between the two commits (backlog row #1141).", "- Anything the two runs' validation did not cover: it adds no check of the delta oracle, save fidelity, event order or crash recovery, which are tests (section 6.2 names them).", "- Memory at 4x: perf:worker reads memory once per scenario at 1x only.", "- Whether a 4x worker row would hold on a CPU that is really 4x slower (†).", "- An hourly main-thread spike beyond the per-batch maximum and the frame-time p99 rows (no separate hour-pass row yet).", "- The GPU driver version, which the runs do not record.", "");
  return L.join("\n");
}

export function main(argv: string[], repo: string, now: () => string = () => new Date().toISOString()): number {
  const args = parseBeforeAfterArgs(argv);
  const out = resolve(repo, args.out);
  if (existsSync(out)) throw new Error(`${out} already exists; results are never overwritten`);
  const before = load(repo, args.before);
  const after = load(repo, args.after);
  // A subject that is also a control is a usage error, caught before anything is written.
  const controls = resolveControls(before.results, after.results, args.options);
  const overlap = (args.options.subjects ?? []).filter((m) => controls.includes(m));
  if (overlap.length) throw new Error(`${overlap.join(", ")} is both a control and a subject (the default controls are ${controls.join(", ")} for these runs; pass --controls to change them)`);
  const c = compareRuns(before.results, after.results, args.options, { before: before.sha256, after: after.sha256 });
  const generatedAt = now();
  // Render everything before the folder exists, so a late throw leaves nothing half-written to block a rerun.
  const files: [string, string][] = [["comparison.json", JSON.stringify({ generatedAt, ...c }, null, 1) + "\n"], ["comparison.csv", comparisonCsv(c)], ["comparison.md", comparisonMarkdown(c, generatedAt)]];
  mkdirSync(out, { recursive: false });
  for (const [name, text] of files) writeFileSync(join(out, name), text);
  process.stdout.write(`perf:before-after: wrote ${out} (${c.problems.length ? `cannot compare: ${c.problems.length} problem(s)` : `subjects: ${c.counts.ok} controlled, ${c.counts["noisy-controlled"]} noisy-controlled, ${c.counts.void} void, ${c.counts.uncontrolled} uncontrolled, ${c.counts.thin - c.rows.filter((r) => r.role === "control" && r.status === "thin").length} thin; ${c.counts["control-drift"]} control(s) moved, ${c.counts["control-noisy"]} noisy, ${c.counts["control-flat"]} flat; ${c.missing.length} metric(s) not compared`})\n`);
  return c.problems.length ? 1 : 0;
}
