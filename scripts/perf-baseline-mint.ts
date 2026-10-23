/**
 * `npx tsx scripts/perf-baseline-mint.ts <engine> <passes dir> <passes>`: run
 * by update-perf-baseline.yml after the perf spec has measured one engine
 * `<passes>` times with `PERF_PASSES_DIR` set (#900). It writes that engine's
 * entry into `e2e/perf/baseline.json` from the median of the passes, keeps
 * every other entry exactly as HEAD commits it, and prints how the passes
 * spread around the entry (the A/A reading M7's calibration needs). It fails
 * when a pass is missing, so a pass that failed its own checks cannot leave a
 * baseline made from the others.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryFromPasses, formatBaselineFile, mintProblem, parseBaselineFile, passSpread, PERF_ENGINES, spreadLines, withBaseline, type BaselineFile, type EngineBaseline, type PerfEngine } from "../src/tests/perfBaseline";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = resolve(repo, "e2e/perf/baseline.json");

function committed(): BaselineFile {
  let text: string;
  try {
    text = execFileSync("git", ["show", "HEAD:e2e/perf/baseline.json"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return {}; // no committed file yet: nothing to keep
  }
  return parseBaselineFile(text);
}

try {
  const [engineArg, dir, countArg] = process.argv.slice(2);
  const engine = engineArg as PerfEngine;
  if (!PERF_ENGINES.includes(engine)) throw new Error(`name the minted engine (${PERF_ENGINES.join(" or ")}); got ${JSON.stringify(engineArg)}`);
  const count = Number(countArg);
  if (!dir || !Number.isInteger(count) || count < 1) throw new Error("usage: perf-baseline-mint.ts <engine> <passes dir> <passes>");
  const files = readdirSync(dir).filter((f) => f.startsWith(`${engine}-`) && f.endsWith(".json"));
  if (files.length !== count) throw new Error(`${files.length} of ${count} ${engine} passes recorded a measurement; a failed pass records none, so nothing is minted`);
  const passes = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as EngineBaseline);
  const entry = entryFromPasses(engine, passes);
  const before = committed();
  writeFileSync(FILE, formatBaselineFile(withBaseline(before, entry)));
  const problem = mintProblem(before, parseBaselineFile(readFileSync(FILE, "utf8")), engine);
  if (problem) throw new Error(problem);
  const lines = [`perf baseline: "${engine}" minted from ${count} passes, the other entries kept as committed`, "", ...spreadLines(engine, passSpread(passes, entry)), ""];
  process.stdout.write(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
} catch (e) {
  process.stderr.write(`perf-baseline-mint: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
