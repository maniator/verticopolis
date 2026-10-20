import { duplicateCheck, poolIdentity, poolProblems, rendererProblem, stable, treeProblem, type PoolIdentity, type PoolPass } from "./calibratePool";
import { summarize } from "./stats";
import type { CompareResults, EngineName } from "./types";

export { stable, treeProblem };
export type { PoolIdentity };

/**
 * The tolerance calibration of benchmark-protocol.md section 6.1, applied to
 * a set of A/A result folders (`perf:compare --aa`). It covers the families
 * that harness measures: M1 (bare engine total), M2 (hosted total), M3 (frame
 * time p99, and 1% low FPS read as TypeScript over WASM) for δ, one candidate
 * each, and M5 (cold start to ready, at each throttle) for ε. M4's long tasks
 * come from `perf:worker --aa` folders and are computed in
 * `perfWorker/calibrateM4.ts` (#1111), which shares this file's screening,
 * pooling and coverage checks.
 *
 * Per pass, a family's value is the largest upper bound across its scenarios
 * and throttles. The candidate is the largest such value across every pass,
 * rounded up to a round number.
 *
 * Two checks speak about coverage, and they say different things:
 *
 * - The stated guarantee. For passes that are exchangeable, the chance that
 *   a fresh pass lands above the largest of n passes is 1 / (n + 1) (before
 *   rounding). With n passes of the engine that has the fewest, that is the
 *   guarantee the candidates carry, and it must be under `exceedanceLimit`
 *   (5% in the protocol, which needs at least 20 passes per engine; the
 *   count is a parameter, `minPassesPerEngine`, and the report states the
 *   guarantee for the count actually used).
 * - The leave-one-out reading, which is informational. Leave each pass out,
 *   take the candidate the others set after rounding, and see whether the
 *   left-out pass lands above it. Only the single largest pass can, so the
 *   count is 0 or 1. It is printed beside each candidate and never blocks
 *   adoption: a set that meets the stated guarantee always passes it (the
 *   guarantee needs at least as many passes as the check's share allows), so
 *   as a rule it could not fire.
 */

export const DELTA_CAP = 0.05;
export const COLD_START_CAP_SHARE = 0.05;
export const DEFAULT_EXCEEDANCE_LIMIT = 0.05;
/** δ is rounded up to this step; ε for cold start to this many milliseconds. */
const DELTA_STEP = 0.01;
export const EPSILON_STEP_MS = 5;
/** The long-task ε cap: 50 ms of blocking, one 100 ms task (protocol 6.1 step 4). */
export const LONG_TASK_CAP_MS = 50;
export const DEFAULT_MIN_PASSES_PER_ENGINE = 5;
/** The repetitions every pass must have: the verdict runs use 10, and a pass with another count does not pool with them. */
export const MIN_REPS = 10;
export const SCENARIOS = ["medium", "large"];
export const THROTTLES = ["1", "4"];

export interface CalibrateOptions {
  /** Passes of each engine required (protocol 6.1 step 1: default 5; the pass count is an open amendment to OD-4). */
  minPassesPerEngine?: number;
  /** The coverage limit the stated guarantee must be under (protocol 6.1: 5%). */
  exceedanceLimit?: number;
}

/** The fewest passes per engine whose guarantee 1 / (n + 1) is under `limit`. */
export const passesForLimit = (limit: number): number => Math.floor(1 / limit + 1e-9);

export interface Family {
  id: "M1" | "M2" | "M3" | "M4" | "M5-1x" | "M5-4x";
  kind: "delta" | "epsilon";
  unit: "ratio" | "ms";
  /** One value per pass, null when a pass lacks a cell the family needs. */
  values: (number | null)[];
  candidate: number | null;
  cap: number | null;
  exceedance: { leaveOneOut: number; of: number; share: number } | null;
  withinCap: boolean | null;
  passesExceedanceLimit: boolean | null;
}

export interface Calibration {
  passes: { folder: string; engine: EngineName; commit: string; reps: number; startedAt: string | null; sha256: string | null }[];
  /** Folders left out, with the reason, so the report lists what it did not use. */
  excluded: { folder: string; reason: string; sha256: string | null }[];
  /** The measurement window of the passes used: the earliest and latest `startedAt`. */
  window: { from: string; to: string } | null;
  /** The options used, and what they guarantee. */
  minPassesPerEngine: number;
  exceedanceLimit: number;
  /** False when an option is looser than the protocol's default (fewer passes or a higher limit); the owner settles those (OD-4 amendment), so such a result is never adoptable here. */
  protocolDefaults: boolean;
  /** What every used pass shares, so a later verdict run can check it matches; null with no usable pass. */
  pool: PoolIdentity | null;
  /** 1 / (n + 1) for n the passes of the engine that has the fewest; null with no passes of one engine. */
  guarantee: number | null;
  problems: string[];
  families: Family[];
  /** Median cold start to ready of the `ts` slot across the TypeScript A/A passes, per throttle. */
  tsColdStartMs: Record<string, number | null>;
  adoptable: boolean;
}

type Pass = Pick<CompareResults, "config" | "comparisons" | "metrics" | "validation"> & PoolPass;

/** A markdown table cell: pipes escaped, newlines flattened. */
const cell = (x: string): string => x.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/** Rounds up to a multiple of `step`, then to 6 places so float noise (57 * 0.01) stays out of the output. */
export const roundUp = (x: number, step: number): number => Number(Math.max(0, Math.ceil(x / step - 1e-9) * step).toFixed(6));

/** The largest of the cells' values, or null when any cell is missing. */
function worst(cells: (number | null | undefined)[]): number | null {
  if (cells.length === 0 || cells.some((c) => c === null || c === undefined || !Number.isFinite(c))) return null;
  return Math.max(...(cells as number[]));
}

function ratioCell(p: Pass, group: string, metric: string, scenario: string, throttle: string, invert = false): number | null {
  const c = p.comparisons.find((x) => x.group === group && x.metric === metric && x.scenario === scenario && x.throttle === throttle);
  if (!c || c.ratio === null || !(c.n.pairs >= MIN_REPS)) return null;
  // A rate read as TypeScript over WASM: the upper bound is the reciprocal of the lower.
  const lower = c.ciLow === null ? null : 1 / c.ciLow;
  const bound = invert ? lower : c.ciHigh;
  return bound === null ? null : bound - 1;
}

/** The upper bound of the paired difference (slot wasm minus slot ts) of cold start to ready, in ms. */
function coldStartDifference(p: Pass, throttle: string): number | null {
  const row = (engine: EngineName) => p.metrics.find((m) => m.group === "startup" && m.metric === "cold game ready" && m.throttle === throttle && m.engine === engine);
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

export function family(id: Family["id"], kind: Family["kind"], unit: Family["unit"], values: (number | null)[], cap: number | null, step: number, limit: number): Family {
  const known = values.filter((v): v is number => v !== null);
  // A tolerance of zero could never pass, so the floor is one step.
  const candidate = known.length === values.length && values.length > 0 ? Math.max(step, roundUp(Math.max(...known), step)) : null;
  let exceedance: Family["exceedance"] = null;
  if (candidate !== null && values.length >= 2) {
    let over = 0;
    values.forEach((v, i) => {
      const others = (values as number[]).filter((_, j) => j !== i);
      if ((v as number) > Math.max(step, roundUp(Math.max(...others), step)) + 1e-9) over++;
    });
    exceedance = { leaveOneOut: over, of: values.length, share: over / values.length };
  }
  return {
    id,
    kind,
    unit,
    values,
    candidate,
    cap,
    exceedance,
    // A missing cap (no TypeScript cold-start values) never counts as inside it.
    withinCap: candidate === null ? null : cap !== null && candidate <= cap,
    passesExceedanceLimit: exceedance ? exceedance.share < limit : null,
  };
}

/** Why a results.json cannot be read as a perf:compare pass, or null. Undefined fields must not slide through a comparison (`undefined < 10` is false). */
function shapeProblem(r: Pass): string | null {
  const c = r.config as Partial<Pass["config"]> | undefined;
  if (!c || typeof c.reps !== "number" || !Number.isFinite(c.reps)) return "config.reps is missing";
  if (!Array.isArray(c.scenarios) || !Array.isArray(c.throttles)) return "config.scenarios or config.throttles is missing";
  if (!r.environment || typeof r.environment.commit !== "string") return "environment.commit is missing";
  if (typeof r.startedAt !== "string" || !Number.isFinite(Date.parse(r.startedAt))) return "startedAt is missing, so the copy check and the window cannot use it";
  if (!Array.isArray(r.comparisons) || !Array.isArray(r.metrics) || !r.validation) return "comparisons, metrics or validation is missing";
  return null;
}

/**
 * The pass-count checks both calibrations make: enough passes of each engine,
 * the stated guarantee 1 / (n + 1) from the engine with the fewest under the
 * limit, and settings no looser than the protocol's (a stricter one is not a
 * relaxation; only fewer passes or a higher limit need the owner).
 */
export function coverageChecks(engines: readonly EngineName[], minPasses: number, limit: number): { guarantee: number | null; protocolDefaults: boolean; problems: string[] } {
  const problems: string[] = [];
  const perEngine = (["ts", "wasm"] as const).map((engine) => ({ engine, n: engines.filter((e) => e === engine).length }));
  for (const { engine, n } of perEngine) {
    if (n < minPasses) problems.push(`${n} usable A/A passes of ${engine}; this calibration asks for at least ${minPasses} per engine`);
  }
  const fewest = Math.min(...perEngine.map((e) => e.n));
  const guarantee = fewest > 0 ? 1 / (fewest + 1) : null;
  if (guarantee !== null && !(guarantee < limit)) problems.push(`${fewest} passes per engine guarantee only that a fresh pass lands above the candidate with probability 1/${fewest + 1} on average (${(guarantee * 100).toFixed(1)}%), which is not under the ${(limit * 100).toFixed(0)}% limit; the limit needs at least ${passesForLimit(limit)} passes per engine; the pass count and limit are the owner's to change (an open amendment to OD-4), and a looser setting is never adoptable until then`);
  const protocolDefaults = minPasses >= DEFAULT_MIN_PASSES_PER_ENGINE && limit <= DEFAULT_EXCEEDANCE_LIMIT;
  if (!protocolDefaults) problems.push(`this run used ${minPasses} passes per engine and a ${(limit * 100).toFixed(1)}% limit, looser than the protocol's ${DEFAULT_MIN_PASSES_PER_ENGINE} passes and ${(DEFAULT_EXCEEDANCE_LIMIT * 100).toFixed(0)}%; the pass count and limit are the owner's to settle (an open amendment to OD-4), so the result is not adoptable until the owner approves them`);
  return { guarantee, protocolDefaults, problems };
}

/**
 * `sha256` is the hash of the folder's canonical results.json (calibrateMain
 * computes it from the parsed JSON, so a re-saved copy with other line endings
 * or indentation hashes the same). Two folders with the same hash, or the same
 * start time, commit and engine, are one pass counted twice, so the second is
 * left out; the hash also ties an adopted number to its inputs.
 */
export function calibrate(folders: { folder: string; results: Pass; sha256?: string }[], options: CalibrateOptions = {}): Calibration {
  const minPasses = options.minPassesPerEngine ?? DEFAULT_MIN_PASSES_PER_ENGINE;
  const limit = options.exceedanceLimit ?? DEFAULT_EXCEEDANCE_LIMIT;
  const problems: string[] = [];
  const excluded: Calibration["excluded"] = [];
  const passes: Calibration["passes"] = [];
  const used: { folder: string; engine: EngineName; results: Pass }[] = [];
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
    const renderer = rendererProblem(results);
    if (engine !== "ts" && engine !== "wasm") leave('not an A/A pass (config.aa is not "ts" or "wasm")');
    else if (!results.validation.ok) leave("its validation failed");
    else if (tree) leave(tree);
    else if (results.config.quick) leave("it is a --quick run, which is not a protocol run");
    else if (results.config.reps !== MIN_REPS) leave(`${results.config.reps} repetitions; the verdict runs use ${MIN_REPS}, and a pass with another count does not pool with them`);
    else if (SCENARIOS.some((s) => !results.config.scenarios.includes(s)) || THROTTLES.some((t) => !results.config.throttles.map(String).includes(t))) leave("it lacks the medium and large scenarios at 1x and 4x");
    else if (renderer) leave(`its renderer is not verified hardware (${renderer})`);
    else {
      used.push({ folder, engine, results });
      passes.push({ folder, engine, commit: results.environment.commit, reps: results.config.reps, startedAt: results.startedAt ?? null, sha256: sha256 ?? null });
    }
  }
  problems.push(...poolProblems(used.map((u) => u.results)));
  const { guarantee, protocolDefaults, problems: coverage } = coverageChecks(passes.map((p) => p.engine), minPasses, limit);
  problems.push(...coverage);

  const all = used.map((u) => u.results);
  const over = (group: string, metric: string, invert = false): (number | null)[] =>
    all.map((p) => worst(SCENARIOS.flatMap((s) => THROTTLES.map((t) => ratioCell(p, group, metric, s, t, invert)))));
  const p99 = over("frames", "frame time p99");
  const low = over("frames", "1% low FPS", true);
  const m3 = all.map((_, i) => worst([p99[i], low[i]]));
  const tsPasses = used.filter((u) => u.engine === "ts").map((u) => u.results);
  const tsColdStartMs: Record<string, number | null> = {};
  const families: Family[] = [
    family("M1", "delta", "ratio", over("sim-raw", "total for fixed duration"), DELTA_CAP, DELTA_STEP, limit),
    family("M2", "delta", "ratio", over("sim-hosted", "total for fixed duration"), DELTA_CAP, DELTA_STEP, limit),
    family("M3", "delta", "ratio", m3, DELTA_CAP, DELTA_STEP, limit),
  ];
  for (const t of THROTTLES) {
    const tsValues = tsPasses.flatMap((p) => p.metrics.filter((m) => m.group === "startup" && m.metric === "cold game ready" && m.throttle === t && m.engine === "ts").flatMap((m) => m.values));
    tsColdStartMs[t] = tsValues.length ? summarize(tsValues).median : null;
    const cap = tsColdStartMs[t] === null ? null : tsColdStartMs[t]! * COLD_START_CAP_SHARE;
    families.push(family(t === "1" ? "M5-1x" : "M5-4x", "epsilon", "ms", all.map((p) => coldStartDifference(p, t)), cap, EPSILON_STEP_MS, limit));
  }
  for (const f of families) {
    if (f.candidate === null) {
      const thin = used.filter((_, i) => f.values[i] === null).map((u) => u.folder);
      problems.push(`${f.id}: ${thin.length} of ${f.values.length} passes (${thin.slice(0, 5).join(", ")}${thin.length > 5 ? ", ..." : ""}) lack a cell the family needs, so there is no candidate for any pass`);
    } else if (f.withinCap === false) {
      problems.push(f.cap === null ? `${f.id}: the candidate ${f.candidate} ms has no cap, because the TypeScript passes recorded no cold-start values` : `${f.id}: the candidate ${f.candidate}${f.unit === "ms" ? " ms" : ""} is above its cap ${f.cap}; add repetitions or remove the noise source and calibrate again`);
    }
  }
  const adoptable = problems.length === 0 && families.every((f) => f.candidate !== null && f.withinCap === true);
  const first = used[0]?.results;
  const pool: PoolIdentity | null = first ? poolIdentity(first) : null;
  const starts = passes.map((p) => p.startedAt).filter((x): x is string => !!x).sort();
  return { passes, excluded, window: starts.length ? { from: starts[0], to: starts[starts.length - 1] } : null, minPassesPerEngine: minPasses, exceedanceLimit: limit, protocolDefaults, pool, guarantee, problems, families, tsColdStartMs, adoptable };
}

export function calibrationMarkdown(c: Calibration, generatedAt: string, withM4 = false): string {
  const out: string[] = [];
  const commits = [...new Set(c.passes.map((p) => p.commit.slice(0, 7)))];
  out.push("# δ and ε calibration from A/A passes", "");
  out.push(`> **Snapshot of ${c.window ? `A/A passes started ${c.window.from} to ${c.window.to}` : "no usable A/A pass"}${commits.length ? `, commit ${commits.join(", ")}` : ""}; computed ${generatedAt}.** The live numbers come from \`npm run perf:calibrate\` (src/tests/perfCompare/calibrate.ts, pinned by calibrate.test.ts) run on the folders listed below; this file never refreshes. Provisional: ${withM4 ? "it covers M1, M2, M3, M4 and M5; M4 is from the `perf:worker` A/A passes below" : "it covers M1, M2, M3 and M5; M4's long-task ε needs `perf:worker` A/A passes (#1111) and is missing"}, and nothing here sets a tolerance until the owner adopts the numbers (OD-4; the pass count is an open amendment to it).`, "");
  out.push(c.adoptable ? "**Candidates pass every check of this tool.** They are provisional (see above)." : "**Not adoptable yet.** See the problems below.", "");
  if (!c.protocolDefaults) out.push(`> **Looser than the protocol's parameters.** This run used ${c.minPassesPerEngine} passes per engine and a ${(c.exceedanceLimit * 100).toFixed(1)}% limit. The protocol's are ${DEFAULT_MIN_PASSES_PER_ENGINE} passes and ${(DEFAULT_EXCEEDANCE_LIMIT * 100).toFixed(0)}%, and loosening them needs the owner's approval, so nothing here is adoptable.`, "");
  if (c.problems.length) out.push("## Problems", "", ...c.problems.map((p) => `- ${p}`), "");
  const fewest = c.guarantee === null ? null : Math.round(1 / c.guarantee) - 1;
  out.push("## What the check guarantees", "", c.guarantee === null ? "There are no passes of one engine, so no guarantee can be stated." : `With ${fewest} passes of the engine that has the fewest, and passes that are exchangeable, the chance that a fresh pass lands above a candidate (before rounding) is 1/${fewest! + 1} on average = ${(c.guarantee * 100).toFixed(1)}%. The limit is ${(c.exceedanceLimit * 100).toFixed(0)}%, which needs at least ${passesForLimit(c.exceedanceLimit)} passes per engine. The leave-one-out column below is informational: it can only be 0 or 1, it shows whether the largest pass lands above the candidate the others set, and it never blocks adoption.`, "");
  out.push("## Candidates", "");
  out.push("| Family | Kind | Candidate | Cap | Leave-one-out (informational) | Largest pass values |", "| --- | --- | --- | --- | --- | --- |");
  const num = (x: number | null, unit: string): string => {
    if (x === null) return "n/a";
    return unit === "ms" ? `${x.toFixed(1)} ms` : x.toFixed(3);
  };
  for (const f of c.families) {
    const top = f.values.filter((v): v is number => v !== null).sort((a, b) => b - a).slice(0, 3).map((v) => num(v, f.unit)).join(", ");
    out.push(`| ${f.id} | ${f.kind === "delta" ? "δ" : "ε"} | ${num(f.candidate, f.unit)} | ${num(f.cap, f.unit)} | ${f.exceedance ? `${f.exceedance.leaveOneOut} of ${f.exceedance.of}` : "n/a"} | ${top || "n/a"} |`);
  }
  out.push("", `Scope: the ${SCENARIOS.join(" and ")} scenarios at ${THROTTLES.map((t) => `${t}x`).join(" and ")}. Other scenarios and throttles in the folders do not feed these numbers. M1, M2 and M3 each get their own δ. Each pass's value is the largest upper bound across the scenarios and throttles, and a ratio cell with fewer than ${MIN_REPS} valid pairs leaves its pass without a value, which leaves the whole family without a candidate.`);
  if (c.pool) {
    out.push("", "## What the passes share", "", "A verdict run may use these numbers only if its machine, browser and run parameters match the three lines below. The commit and engine build are provenance: the verdict runs come from later commits.", "");
    out.push(`- Provenance: commit ${c.pool.commit}, engine build ${c.pool.engineBuildHash ?? "n/a"} (not a condition on the verdict run)`);
    out.push(`- Machine: ${Object.entries(c.pool.machine).map(([k, v]) => `${k} ${cell(String(v))}`).join("; ")}`);
    out.push(`- Browser: executable ${cell(c.pool.browser.executable ?? "default headless shell")}, channel ${c.pool.browser.channel ?? "default"}, switches ${c.pool.browser.args.length ? cell(c.pool.browser.args.join(" ")) : "none"}, version ${c.pool.browser.version ?? "n/a"}, renderer ${c.pool.browser.renderers.length ? c.pool.browser.renderers.map(cell).join("; ") : "n/a"}`);
    out.push(`- Run parameters: ${cell(stable(c.pool.config))}`);
  }
  out.push("", "## Passes used", "", "| Folder | Engine | Commit | Started | Reps | results.json SHA-256 (canonical) |", "| --- | --- | --- | --- | --- | --- |");
  for (const p of c.passes) out.push(`| ${cell(p.folder)} | ${p.engine} | ${p.commit} | ${p.startedAt ?? "n/a"} | ${p.reps} | ${p.sha256 ?? "n/a"} |`);
  if (c.excluded.length) {
    out.push("", "## Folders left out", "", "| Folder | Reason | results.json SHA-256 (canonical) |", "| --- | --- | --- |");
    for (const e of c.excluded) out.push(`| ${cell(e.folder)} | ${cell(e.reason)} | ${e.sha256 ?? "n/a"} |`);
  }
  out.push("", `TypeScript's median cold start to ready in the \`ts\` A/A passes: ${THROTTLES.map((t) => `${t}x ${num(c.tsColdStartMs[t], "ms")}`).join(", ")} (the ε cap is ${COLD_START_CAP_SHARE * 100}% of each).`, "");
  return out.join("\n");
}
