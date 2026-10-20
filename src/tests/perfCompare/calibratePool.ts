import { rendererFinding } from "./renderer";
import type { CompareResults } from "./types";

/**
 * What the two calibrations (`calibrate.ts` for `perf:compare` folders and
 * `perfWorker/calibrateM4.ts` for `perf:worker` folders) share: the checks
 * that decide whether a folder can be a calibration pass at all, and the
 * checks that decide whether several passes can be pooled.
 */

export interface PoolPass {
  config: { reps: number; scenarios: string[]; throttles: (number | string)[]; quick?: boolean; aa?: unknown };
  startedAt?: string;
  browser?: Partial<Pick<CompareResults["browser"], "version" | "executable" | "channel" | "args" | "rendererException" | "gpuVerified">>;
  runs?: { ok: boolean; page?: { webgl?: { renderer?: string | null } | null } | null; rendererEnd?: string | null; rendererEndCold?: string | null; contextLost?: string[] }[];
  environment: Pick<CompareResults["environment"], "commit" | "dirty"> & Partial<Pick<CompareResults["environment"], "tree" | "cpuModel" | "logicalCpus" | "totalMemoryBytes" | "os" | "kernel" | "arch" | "node" | "rust" | "playwright" | "engineBuildHash" | "enginePackage">>;
}

/** JSON with object keys sorted, so equal values compare equal whatever order a writer used. */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Why the working-tree record cannot vouch for a clean tree, or null. */
export function treeProblem(r: Pick<PoolPass, "environment">): string | null {
  if (r.environment.dirty !== false) return "it ran on a dirty tree, or does not say it was clean";
  const t = r.environment.tree;
  if (!t) return "it has no working-tree record, so a clean tree is not proven";
  if (!t.complete) return "its working-tree record is incomplete (git could not finish it)";
  if (t.porcelain === null || t.porcelain.length > 0) return "its working-tree record shows changes";
  if (!Array.isArray(t.untracked)) return "its working-tree record has no list of untracked files (an incomplete record)";
  if (t.diffSha256 !== null || t.untracked.length > 0) return "its working-tree record holds a tracked-changes hash or untracked files, so the tree was not clean";
  if (!t.hidden) return "its working-tree record did not check for edits git hides (assume-unchanged, skip-worktree)";
  if (t.hidden.length > 0) return "its tree holds files git was told to ignore changes in (assume-unchanged or skip-worktree)";
  return null;
}

/**
 * Why a pass's renderer cannot back the frame rows, or null. The check is the
 * harness's own (renderer.ts, the allowlist that fails closed): the pass must
 * record `gpuVerified: true`, and every good process run must show a hardware
 * adapter at its start, after its frames and after its cold start. A pass that
 * declared a renderer exception is not calibration evidence.
 */
export function rendererProblem(r: Pick<PoolPass, "browser" | "runs">): string | null {
  if (r.browser?.rendererException) return `it declared renderer exception ${r.browser.rendererException}`;
  if (r.browser?.gpuVerified !== true) return r.browser?.gpuVerified === false ? "it recorded gpuVerified: false" : "it does not record gpuVerified: true (a harness from before the renderer check)";
  const good = (r.runs ?? []).filter((x) => x.ok);
  // A calibration pass always ran a throttled cold start, so the third read is part of the evidence.
  if (good.some((x) => !x.rendererEndCold)) return "a process run has no renderer read after its cold start";
  const lost = good.find((x) => x.contextLost?.length);
  if (lost) return `a process run lost its WebGL context (${lost.contextLost!.join("; ")})`;
  const f = rendererFinding(good.map((x) => x.page?.webgl?.renderer), good.map((x) => x.rendererEnd), { quick: false, lateEnds: good.map((x) => x.rendererEndCold) });
  return f.errors.length ? f.errors[0] : null;
}

/**
 * Every good process run must carry a context-loss record (#1136): a folder
 * from a harness that did not look for a lost WebGL context is not evidence
 * of a stable renderer, and a folder with a loss in it fails `rendererProblem`.
 */
export function lossRecordProblem(r: Pick<PoolPass, "runs">): string | null {
  const good = (r.runs ?? []).filter((x) => x.ok);
  return good.some((x) => !Array.isArray(x.contextLost)) ? "a process run has no WebGL context-loss record (a harness from before #1136)" : null;
}

/** The distinct renderer strings a pass read, in order. */
export const renderers = (r: Pick<PoolPass, "runs">): string[] => [...new Set((r.runs ?? []).filter((x) => x.ok).flatMap((x) => [x.page?.webgl?.renderer, x.rendererEnd, x.rendererEndCold]).filter((x): x is string => !!x))].sort();

export interface PoolIdentity {
  commit: string;
  engineBuildHash: string | null;
  enginePackage: unknown;
  machine: Record<string, unknown>;
  browser: { executable: string | null; channel: string | null; args: string[]; version: string | null; renderers: string[] };
  config: Record<string, unknown>;
}

/** What the first pass records, for a later verdict run to compare itself with. */
export function poolIdentity(first: PoolPass): PoolIdentity {
  return {
    commit: first.environment.commit,
    engineBuildHash: first.environment.engineBuildHash ?? null,
    enginePackage: first.environment.enginePackage ?? null,
    machine: Object.fromEntries(["cpuModel", "logicalCpus", "totalMemoryBytes", "os", "kernel", "arch", "node", "rust", "playwright"].map((k) => [k, (first.environment as Record<string, unknown>)[k] ?? null])),
    browser: { executable: first.browser?.executable ?? null, channel: first.browser?.channel ?? null, args: first.browser?.args ?? [], version: first.browser?.version ?? null, renderers: renderers(first) },
    config: { ...first.config, aa: null },
  };
}

/**
 * Why the passes cannot be pooled: one commit, one machine, one browser, one
 * build, one set of run parameters. A calibration pools passes that differ
 * only by chance.
 */
export function poolProblems(used: PoolPass[]): string[] {
  const problems: string[] = [];
  const same = (what: string, key: (r: PoolPass) => unknown): void => {
    if (new Set(used.map((u) => stable(key(u) ?? null))).size > 1) problems.push(`the passes differ in ${what}; calibrate passes that share it`);
  };
  // Names the fields that differ, so a pass whose toolchain version was not recorded (null) reads as that and not as an unexplained machine difference.
  const sameFields = (what: string, fields: Record<string, (r: PoolPass) => unknown>): void => {
    const differ = Object.entries(fields).filter(([, get]) => new Set(used.map((u) => stable(get(u) ?? null))).size > 1).map(([name]) => name);
    if (differ.length) problems.push(`the passes differ in ${what}: ${differ.join(", ")}; calibrate passes that share them (a field recorded as unknown in one pass and known in another counts as different)`);
  };
  sameFields("machine or runtime", { cpuModel: (r) => r.environment.cpuModel, logicalCpus: (r) => r.environment.logicalCpus, totalMemoryBytes: (r) => r.environment.totalMemoryBytes, os: (r) => r.environment.os, kernel: (r) => r.environment.kernel, arch: (r) => r.environment.arch, node: (r) => r.environment.node, rust: (r) => r.environment.rust, playwright: (r) => r.environment.playwright });
  same("browser (executable, channel, switches, version or WebGL renderer)", (r) => [r.browser?.executable, r.browser?.channel, r.browser?.args, r.browser?.version, renderers(r)]);
  same("engine build", (r) => [r.environment.engineBuildHash, r.environment.enginePackage]);
  same("run parameters (repetitions, scenarios, throttles, steps, step size, frame window, speed, viewport or warm-up)", (r) => ({ ...r.config, aa: null, quick: false, scenarios: [...r.config.scenarios].sort(), throttles: r.config.throttles.map(Number).sort((a, b) => a - b) }));
  if (new Set(used.map((u) => u.environment.commit)).size > 1) problems.push(`the passes come from more than one commit (${[...new Set(used.map((u) => u.environment.commit.slice(0, 7)))].join(", ")}); calibrate one commit's passes`);
  return problems;
}

/**
 * Why the `perf:compare` passes and the `perf:worker` passes of one command
 * cannot share a report: one calibration comes from one machine, one browser
 * and one engine build (the counting-browser pin in protocol section 3). Both
 * commits are named, so a reader sees which snapshots were joined.
 */
export function halvesProblems(compare: PoolIdentity, worker: PoolIdentity): string[] {
  const differ = [
    ["machine or runtime", compare.machine, worker.machine],
    ["browser (executable, channel, switches, version or WebGL renderer)", compare.browser, worker.browser],
    ["engine build", [compare.engineBuildHash, compare.enginePackage], [worker.engineBuildHash, worker.enginePackage]],
  ].filter(([, a, b]) => stable(a) !== stable(b)).map(([what]) => what as string);
  if (!differ.length) return [];
  return [`the perf:compare passes (commit ${compare.commit.slice(0, 7)}) and the perf:worker passes (commit ${worker.commit.slice(0, 7)}) differ in ${differ.join("; ")}; one calibration needs both kinds from one machine, browser and engine build`];
}

/**
 * Remembers the folders seen so far. `seen` returns why a folder repeats an
 * earlier one, or null: the same canonical hash, or the same start time,
 * commit, engine and build, is one pass counted twice.
 */
export function duplicateCheck(): (folder: string, results: PoolPass, engine: unknown, sha256?: string) => string | null {
  const seenHash = new Map<string, string>();
  const seenRun = new Map<string, string>();
  return (folder, results, engine, sha256) => {
    const runKey = results.startedAt ? `${results.startedAt}|${results.environment.commit}|${engine}|${results.environment.engineBuildHash ?? ""}` : null;
    const hashed = sha256 !== undefined ? seenHash.get(sha256) : undefined;
    if (hashed !== undefined) return `its results.json is identical to ${hashed}'s (one pass counted twice)`;
    const run = runKey !== null ? seenRun.get(runKey) : undefined;
    if (run !== undefined) return `it has the start time, commit and engine of ${run} (one pass saved twice)`;
    if (sha256 !== undefined) seenHash.set(sha256, folder);
    if (runKey !== null) seenRun.set(runKey, folder);
    return null;
  };
}
