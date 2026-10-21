import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { calibrateM4, isWorkerResults, m4Markdown, type WorkerPass } from "../perfWorker/calibrateM4";
import { calibrate, calibrationMarkdown, stable, type Calibration } from "./calibrate";
import { halvesProblems } from "./calibratePool";
import type { CompareResults } from "./types";

/**
 * `npm run perf:calibrate -- <folder>... --out <dir> [--min-passes N]
 * [--exceedance-limit X]`: the δ and ε candidates from A/A result folders
 * (benchmark-protocol.md section 6.1). A `perf:compare` folder feeds M1, M2,
 * M3 and M5; a `perf:worker` folder feeds M4's long-task ε, and one command
 * takes both kinds. Writes calibration.json and calibration.md into the new
 * `--out` folder (never an existing one) and exits 0 only when every check
 * passes for every kind of folder given (a run with one kind only is judged
 * on that kind and says so on its last line and in `missingFamilies`).
 * `--min-passes` is the passes
 * required of each engine (default 5, as the protocol says today) and
 * `--exceedance-limit` the coverage limit the stated guarantee must be under
 * (default 0.05); the report states the guarantee for the count used. The
 * owner's decision (an open amendment to OD-4) sets the real values; a run
 * with fewer passes or a looser limit than the defaults is never adoptable
 * and exits 1.
 */
export function parseCalibrateArgs(argv: string[]): { folders: string[]; out: string; minPassesPerEngine?: number; exceedanceLimit?: number } {
  const folders: string[] = [];
  let out: string | null = null;
  let minPassesPerEngine: number | undefined;
  let exceedanceLimit: number | undefined;
  const value = (i: number, flag: string): string => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      const v = value(i++, "--out");
      if (out !== null) throw new Error("--out is given twice");
      out = v;
    } else if (argv[i] === "--min-passes") {
      const n = Number(value(i++, "--min-passes"));
      if (minPassesPerEngine !== undefined) throw new Error("--min-passes is given twice");
      if (!Number.isInteger(n) || n < 2) throw new Error("--min-passes needs a whole number of at least 2");
      minPassesPerEngine = n;
    } else if (argv[i] === "--exceedance-limit") {
      const x = Number(value(i++, "--exceedance-limit"));
      if (exceedanceLimit !== undefined) throw new Error("--exceedance-limit is given twice");
      if (!(x > 0 && x < 1)) throw new Error("--exceedance-limit needs a number above 0 and below 1");
      exceedanceLimit = x;
    } else if (argv[i].startsWith("--")) throw new Error(`unknown argument ${argv[i]}; expected result folders, --out DIR, --min-passes N and --exceedance-limit X`);
    else folders.push(argv[i]);
  }
  if (folders.length === 0) throw new Error("name at least one A/A result folder");
  if (out === null) throw new Error("--out DIR is required");
  return { folders, out, ...(minPassesPerEngine !== undefined ? { minPassesPerEngine } : {}), ...(exceedanceLimit !== undefined ? { exceedanceLimit } : {}) };
}

export function main(argv: string[], repo: string, now: () => string = () => new Date().toISOString()): number {
  const args = parseCalibrateArgs(argv);
  const out = resolve(repo, args.out);
  if (existsSync(out)) throw new Error(`${out} already exists; results are never overwritten`);
  const folders = args.folders.map((f) => {
    const dir = resolve(repo, f);
    const file = join(dir, "results.json");
    if (!existsSync(file)) throw new Error(`${dir} has no results.json`);
    const text = readFileSync(file);
    let results: CompareResults | WorkerPass;
    try {
      results = JSON.parse(text.toString("utf8").replace(/^\uFEFF/, "")) as CompareResults | WorkerPass;
    } catch (e) {
      throw new Error(`${file} is not valid JSON: ${(e as Error).message}`);
    }
    const r = results as Partial<CompareResults> | null;
    const worker = isWorkerResults(r);
    if (!r || !r.config || !r.environment || !Array.isArray(r.metrics) || !r.validation || (!worker && !Array.isArray(r.comparisons))) throw new Error(`${file} is not a perf:compare or perf:worker results.json (config, environment, comparisons, metrics or validation is missing)`);
    // The hash is of the parsed JSON with sorted keys, so a copy re-saved with
    // other line endings, indentation or key order is the same pass.
    return { folder: f, worker, results, sha256: createHash("sha256").update(stable(results)).digest("hex") };
  });
  const opts = { minPassesPerEngine: args.minPassesPerEngine, exceedanceLimit: args.exceedanceLimit };
  const compareFolders = folders.filter((f) => !f.worker) as { folder: string; results: CompareResults; sha256: string }[];
  const workerFolders = folders.filter((f) => f.worker) as { folder: string; results: WorkerPass; sha256: string }[];
  const compare: Calibration | null = compareFolders.length ? calibrate(compareFolders, opts) : null;
  const m4 = workerFolders.length ? calibrateM4(workerFolders, opts) : null;
  // Passes of the two kinds in one report must share a machine, a browser and an engine build.
  const across = compare?.pool && m4?.pool ? halvesProblems(compare.pool, m4.pool) : [];
  const m4Problems = (m4?.problems ?? []).map((p) => `perf:worker folders: ${p}`);
  const adoptable = (compare?.adoptable ?? true) && (m4?.adoptable ?? true) && across.length === 0;
  const problems = [...(compare?.problems ?? []), ...m4Problems, ...across];
  // Which families this run cannot speak for, so a partial run does not read as a complete one.
  const missingFamilies = [...(compare ? [] : ["M1", "M2", "M3", "M5-1x", "M5-4x"]), ...(m4 ? [] : ["M4"])];
  mkdirSync(out, { recursive: true });
  const generatedAt = now();
  writeFileSync(join(out, "calibration.json"), JSON.stringify({ generatedAt, ...(compare ?? {}), m4, missingFamilies, problems, adoptable }, null, 1) + "\n");
  const mixed = m4 ? { m4Window: m4.window, m4Commits: [...new Set(m4.passes.map((p) => p.commit.slice(0, 7)))], adoptable, problems: [...m4Problems, ...across] } : null;
  writeFileSync(join(out, "calibration.md"), [compare ? calibrationMarkdown(compare, generatedAt, mixed) : null, m4 ? m4Markdown(m4, generatedAt, compare !== null) : null].filter((x) => x !== null).join("\n"));
  process.stdout.write(`perf:calibrate: wrote ${out} (${adoptable ? "adoptable" : `not adoptable: ${problems.length} problem(s)`}${missingFamilies.length ? `; partial, no folders for ${missingFamilies.join(", ")}` : ""})\n`);
  return adoptable ? 0 : 1;
}
