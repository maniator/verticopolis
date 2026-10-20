import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { calibrate, calibrationMarkdown, stable } from "./calibrate";
import type { CompareResults } from "./types";

/**
 * `npm run perf:calibrate -- <folder>... --out <dir> [--min-passes N]
 * [--exceedance-limit X]`: the δ and ε candidates from A/A result folders
 * (benchmark-protocol.md section 6.1). Writes calibration.json and
 * calibration.md into the new `--out` folder (never an existing one) and
 * exits 0 only when every check passes. `--min-passes` is the passes
 * required of each engine (default 5, as the protocol says today) and
 * `--exceedance-limit` the coverage limit the stated guarantee must be under
 * (default 0.05); the report states the guarantee for the count used. The
 * owner's OD-7 decision sets the real values.
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
    let results: CompareResults;
    try {
      results = JSON.parse(text.toString("utf8")) as CompareResults;
    } catch (e) {
      throw new Error(`${file} is not valid JSON: ${(e as Error).message}`);
    }
    const r = results as Partial<CompareResults> | null;
    if (!r || !r.config || !r.environment || !Array.isArray(r.comparisons) || !Array.isArray(r.metrics) || !r.validation) throw new Error(`${file} is not a perf:compare results.json (config, environment, comparisons, metrics or validation is missing)`);
    // The hash is of the parsed JSON with sorted keys, so a copy re-saved with
    // other line endings, indentation or key order is the same pass.
    return { folder: f, results, sha256: createHash("sha256").update(stable(results)).digest("hex") };
  });
  const result = calibrate(folders, { minPassesPerEngine: args.minPassesPerEngine, exceedanceLimit: args.exceedanceLimit });
  mkdirSync(out, { recursive: true });
  const generatedAt = now();
  writeFileSync(join(out, "calibration.json"), JSON.stringify({ generatedAt, ...result }, null, 1) + "\n");
  writeFileSync(join(out, "calibration.md"), calibrationMarkdown(result, generatedAt));
  process.stdout.write(`perf:calibrate: wrote ${out} (${result.adoptable ? "adoptable" : `not adoptable: ${result.problems.length} problem(s)`})\n`);
  return result.adoptable ? 0 : 1;
}
