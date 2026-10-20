import { coverageChecks, DEFAULT_EXCEEDANCE_LIMIT, DEFAULT_MIN_PASSES_PER_ENGINE, EPSILON_STEP_MS, family, LONG_TASK_CAP_MS, MIN_REPS, THROTTLES, type CalibrateOptions, type Family } from "../perfCompare/calibrate";
import { duplicateCheck, poolIdentity, poolProblems, rendererProblem, treeProblem, type PoolIdentity, type PoolPass } from "../perfCompare/calibratePool";
import { summarize } from "../perfCompare/stats";
import type { EngineName } from "../perfCompare/types";
import type { Metric } from "./analysis";

/**
 * M4's ε from `perf:worker --aa` folders (protocol section 6.1; #1111).
 *
 * M4 is main-thread blocking, the part of each long task past 50 ms, on the
 * large tower at 1x and 4x. A pass's value is the one-sided upper bound of the
 * median paired difference of that blocking (slot "wasm" minus slot "ts", in
 * ms, paired by repetition, at least `MIN_REPS` pairs), the larger of the two
 * throttles. The candidate is the largest value across passes, rounded up to
 * 5 ms, and it is not adopted above 50 ms. The pass screening, the pooling
 * checks and the coverage checks are the ones `calibrate.ts` applies to
 * `perf:compare` folders; this file adds what is specific to a worker folder.
 */

export const M4_SCENARIO = "large";
export const M4_METRIC = "main-thread blocking (long tasks past 50 ms)";

export type WorkerPass = PoolPass & {
  metrics: Pick<Metric, "group" | "scenario" | "throttle" | "metric" | "mode" | "values" | "reps">[];
  validation: { ok: boolean };
};

export interface M4Calibration {
  passes: { folder: string; engine: EngineName; commit: string; reps: number; startedAt: string | null; sha256: string | null }[];
  excluded: { folder: string; reason: string; sha256: string | null }[];
  window: { from: string; to: string } | null;
  minPassesPerEngine: number;
  exceedanceLimit: number;
  protocolDefaults: boolean;
  pool: PoolIdentity | null;
  guarantee: number | null;
  problems: string[];
  family: Family;
  adoptable: boolean;
}

/** True for a results.json that has the shape of a `perf:worker` folder (modes and a metrics list), so one command can take both kinds. */
export function isWorkerResults(r: unknown): boolean {
  const c = (r as { config?: { modes?: unknown } } | null)?.config;
  return !!c && Array.isArray(c.modes);
}

/** The upper bound of the paired blocking difference (slot wasm minus slot ts) at one throttle, in ms, or null with fewer than `MIN_REPS` pairs. */
export function blockingDifference(p: Pick<WorkerPass, "metrics">, throttle: string): number | null {
  const row = (mode: "ts" | "wasm") => p.metrics.find((m) => m.group === "frames" && m.scenario === M4_SCENARIO && m.throttle === throttle && m.metric === M4_METRIC && m.mode === mode);
  const a = row("wasm");
  const b = row("ts");
  if (!a || !b) return null;
  const diffs: number[] = [];
  a.reps.forEach((rep, i) => {
    const j = b.reps.indexOf(rep);
    if (j >= 0) diffs.push(a.values[i] - b.values[j]);
  });
  if (diffs.length < MIN_REPS) return null;
  return summarize(diffs).medianCiHigh;
}

/** Why a results.json cannot be read as a `perf:worker` pass, or null. */
function shapeProblem(r: WorkerPass): string | null {
  const c = r.config as Partial<WorkerPass["config"]> | undefined;
  if (!c || typeof c.reps !== "number" || !Number.isFinite(c.reps)) return "config.reps is missing";
  if (!Array.isArray(c.scenarios) || !Array.isArray(c.throttles)) return "config.scenarios or config.throttles is missing";
  if (!r.environment || typeof r.environment.commit !== "string") return "environment.commit is missing";
  if (typeof r.startedAt !== "string" || !Number.isFinite(Date.parse(r.startedAt))) return "startedAt is missing, so the copy check and the window cannot use it";
  if (!Array.isArray(r.metrics) || !r.validation) return "metrics or validation is missing";
  return null;
}

/**
 * Every good process run must carry a context-loss record (#1136): a folder
 * from a harness that did not look for a lost WebGL context is not evidence
 * of a stable renderer, and a folder with a loss in it fails the renderer
 * check through `rendererProblem`.
 */
function lossRecordProblem(r: WorkerPass): string | null {
  const good = (r.runs ?? []).filter((x) => x.ok);
  return good.some((x) => !Array.isArray(x.contextLost)) ? "a process run has no WebGL context-loss record (a harness from before #1136)" : null;
}

export function calibrateM4(folders: { folder: string; results: WorkerPass; sha256?: string }[], options: CalibrateOptions = {}): M4Calibration {
  const minPasses = options.minPassesPerEngine ?? DEFAULT_MIN_PASSES_PER_ENGINE;
  const limit = options.exceedanceLimit ?? DEFAULT_EXCEEDANCE_LIMIT;
  const problems: string[] = [];
  const excluded: M4Calibration["excluded"] = [];
  const passes: M4Calibration["passes"] = [];
  const used: { folder: string; engine: EngineName; results: WorkerPass }[] = [];
  const duplicate = duplicateCheck();
  for (const { folder, results, sha256 } of folders) {
    const leave = (reason: string): void => {
      excluded.push({ folder, reason, sha256: sha256 ?? null });
      problems.push(`${folder}: ${reason}, so it is left out`);
    };
    const shape = shapeProblem(results);
    if (shape) {
      leave(`its results.json lacks what a pass needs (${shape})`);
      continue;
    }
    const engine = results.config.aa;
    const repeat = duplicate(folder, results, engine, sha256);
    if (repeat) {
      leave(repeat);
      continue;
    }
    const tree = treeProblem(results);
    const renderer = rendererProblem(results) ?? lossRecordProblem(results);
    if (engine !== "ts" && engine !== "wasm") leave('not an A/A pass (config.aa is not "ts" or "wasm")');
    else if (!results.validation.ok) leave("its validation failed");
    else if (tree) leave(tree);
    else if (results.config.quick) leave("it is a --quick run, which is not a protocol run");
    else if (results.config.reps !== MIN_REPS) leave(`${results.config.reps} repetitions; the verdict runs use ${MIN_REPS}, and a pass with another count does not pool with them`);
    else if (!results.config.scenarios.includes(M4_SCENARIO) || THROTTLES.some((t) => !results.config.throttles.map(String).includes(t))) leave(`it lacks the ${M4_SCENARIO} scenario at 1x and 4x`);
    else if (renderer) leave(`its renderer is not verified hardware (${renderer})`);
    else {
      used.push({ folder, engine, results });
      passes.push({ folder, engine, commit: results.environment.commit, reps: results.config.reps, startedAt: results.startedAt ?? null, sha256: sha256 ?? null });
    }
  }
  problems.push(...poolProblems(used.map((u) => u.results)));
  const { guarantee, protocolDefaults, problems: coverage } = coverageChecks(passes.map((p) => p.engine), minPasses, limit);
  problems.push(...coverage);

  const values = used.map((u) => {
    const perThrottle = THROTTLES.map((t) => blockingDifference(u.results, t));
    return perThrottle.some((v) => v === null) ? null : Math.max(...(perThrottle as number[]));
  });
  const m4 = family("M4", "epsilon", "ms", values, LONG_TASK_CAP_MS, EPSILON_STEP_MS, limit);
  if (m4.candidate === null) {
    const thin = used.filter((_, i) => values[i] === null).map((u) => u.folder);
    problems.push(`M4: ${thin.length} of ${values.length} passes (${thin.slice(0, 5).join(", ")}${thin.length > 5 ? ", ..." : ""}) lack a cell the family needs (at least ${MIN_REPS} paired repetitions of the blocking row at 1x and 4x), so there is no candidate for any pass`);
  } else if (m4.withinCap === false) {
    problems.push(`M4: the candidate ${m4.candidate} ms is above its cap ${LONG_TASK_CAP_MS} ms; add repetitions or remove the noise source and calibrate again`);
  }
  const starts = passes.map((p) => p.startedAt).filter((x): x is string => !!x).sort();
  return {
    passes,
    excluded,
    window: starts.length ? { from: starts[0], to: starts[starts.length - 1] } : null,
    minPassesPerEngine: minPasses,
    exceedanceLimit: limit,
    protocolDefaults,
    pool: used[0] ? poolIdentity(used[0].results) : null,
    guarantee,
    problems,
    family: m4,
    adoptable: problems.length === 0 && m4.candidate !== null && m4.withinCap === true,
  };
}

/** A markdown table cell: pipes escaped, newlines flattened. */
const cell = (x: string): string => x.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/**
 * The M4 part of `calibration.md`: a section after the `perf:compare`
 * report's, or the whole report when only worker folders were given.
 */
export function m4Markdown(c: M4Calibration, generatedAt: string, afterCompare: boolean): string {
  const out: string[] = [];
  const f = c.family;
  const commits = [...new Set(c.passes.map((p) => p.commit.slice(0, 7)))];
  const h = afterCompare ? "##" : "#";
  if (afterCompare) out.push("");
  out.push(`${h} M4 long-task ε from \`perf:worker\` A/A passes`, "");
  if (!afterCompare) out.push(`> **Snapshot of ${c.window ? `A/A passes started ${c.window.from} to ${c.window.to}` : "no usable A/A pass"}${commits.length ? `, commit ${commits.join(", ")}` : ""}; computed ${generatedAt}.** The live number comes from \`npm run perf:calibrate\` (src/tests/perfWorker/calibrateM4.ts) run on the folders listed below; this file never refreshes. Provisional: M1, M2, M3 and M5 need \`perf:compare\` A/A passes and are not in this report, and nothing here sets a tolerance until the owner adopts the numbers (OD-4).`, "");
  out.push(c.adoptable ? "**M4 passes every check of this tool.** It is provisional (see above)." : "**M4 is not adoptable yet.** See the problems below.", "");
  if (!c.protocolDefaults) out.push(`> **Looser than the protocol's parameters.** This run used ${c.minPassesPerEngine} passes per engine and a ${(c.exceedanceLimit * 100).toFixed(1)}% limit, and loosening them needs the owner's approval, so nothing here is adoptable.`, "");
  if (c.problems.length) out.push("Problems:", "", ...c.problems.map((p) => `- ${p}`), "");
  const fewest = c.guarantee === null ? null : Math.round(1 / c.guarantee) - 1;
  out.push(c.guarantee === null ? "There are no passes of one engine, so no guarantee can be stated." : `Coverage: with ${fewest} passes of the engine that has the fewest, a fresh pass lands above the candidate (before rounding) with probability 1/${fewest! + 1} on average = ${(c.guarantee * 100).toFixed(1)}%, against a limit of ${(c.exceedanceLimit * 100).toFixed(0)}%.`, "");
  const num = (x: number | null): string => (x === null ? "n/a" : `${x.toFixed(1)} ms`);
  const top = f.values.filter((v): v is number => v !== null).sort((a, b) => b - a).slice(0, 3).map(num).join(", ");
  out.push("| Family | Kind | Candidate | Cap | Leave-one-out (informational) | Largest pass values |", "| --- | --- | --- | --- | --- | --- |");
  out.push(`| M4 | ε | ${num(f.candidate)} | ${num(f.cap)} | ${f.exceedance ? `${f.exceedance.leaveOneOut} of ${f.exceedance.of}` : "n/a"} | ${top || "n/a"} |`, "");
  out.push(`Scope: the ${M4_SCENARIO} scenario's "${M4_METRIC}" at ${THROTTLES.map((t) => `${t}x`).join(" and ")}, paired by repetition (slot wasm minus slot ts). Each pass's value is the larger upper bound of the two throttles, and a throttle with fewer than ${MIN_REPS} paired repetitions leaves its pass without a value, which leaves M4 without a candidate. The folders are \`--aa ts\` and \`--aa wasm\` passes of the main-thread hosts, so 4x throttles the engine as well as the page.`);
  if (c.pool) {
    out.push("", `${h}# What the passes share`, "");
    out.push(`- Provenance: commit ${c.pool.commit}, engine build ${c.pool.engineBuildHash ?? "n/a"} (not a condition on the verdict run)`);
    out.push(`- Machine: ${Object.entries(c.pool.machine).map(([k, v]) => `${k} ${cell(String(v))}`).join("; ")}`);
    out.push(`- Browser: executable ${cell(c.pool.browser.executable ?? "default headless shell")}, channel ${c.pool.browser.channel ?? "default"}, switches ${c.pool.browser.args.length ? cell(c.pool.browser.args.join(" ")) : "none"}, version ${c.pool.browser.version ?? "n/a"}, renderer ${c.pool.browser.renderers.length ? c.pool.browser.renderers.map(cell).join("; ") : "n/a"}`);
  }
  out.push("", `${h}# M4 passes used`, "", "| Folder | Engine | Commit | Started | Reps | results.json SHA-256 (canonical) |", "| --- | --- | --- | --- | --- | --- |");
  for (const p of c.passes) out.push(`| ${cell(p.folder)} | ${p.engine} | ${p.commit} | ${p.startedAt ?? "n/a"} | ${p.reps} | ${p.sha256 ?? "n/a"} |`);
  if (c.excluded.length) {
    out.push("", `${h}# M4 folders left out`, "", "| Folder | Reason | results.json SHA-256 (canonical) |", "| --- | --- | --- |");
    for (const e of c.excluded) out.push(`| ${cell(e.folder)} | ${cell(e.reason)} | ${e.sha256 ?? "n/a"} |`);
  }
  out.push("");
  return out.join("\n");
}
