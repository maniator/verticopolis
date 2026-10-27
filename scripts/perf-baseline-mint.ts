/**
 * `npx tsx scripts/perf-baseline-mint.ts <engine> <passes dir> <passes> [--dry-run]`:
 * run by update-perf-baseline.yml after the perf spec has measured one engine
 * `<passes>` times with `PERF_PASSES_DIR` set (#900). It writes that engine's
 * entry into `e2e/perf/baseline.json` from the median of the passes, keeps
 * every other entry exactly as HEAD commits it, and prints the passes and
 * their within-run spread around the entry. It fails when a pass is missing,
 * so a pass that failed its own checks cannot leave a baseline made from the
 * others, and when fewer than MIN_MINT_PASSES were asked for. With
 * `--dry-run` it prints the same reading and writes nothing, which is how the
 * spread of an engine whose entry must stay (the TypeScript one) is read.
 * The spread also goes to `<passes dir>/spread.md` for the bot's commit.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryFromPasses, formatBaselineFile, MIN_MINT_PASSES, mintProblem, parseBaselineFile, passLines, passSpread, PERF_ENGINES, spreadLines, withBaseline, type BaselineFile, type EngineBaseline, type PerfEngine } from "../src/tests/perfBaseline";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PATH = "e2e/perf/baseline.json";
const FILE = resolve(repo, PATH);

const git = (args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

/** The file as HEAD commits it. Only a HEAD with no such path reads as an
 *  empty file; any other git failure (no repository, an untrusted directory)
 *  throws, since reading it as empty would mint a file that drops every other
 *  engine's entry. */
function committed(): BaselineFile {
  if (git(["ls-tree", "--name-only", "HEAD", "--", PATH]).trim() !== PATH) return {};
  return parseBaselineFile(git(["show", `HEAD:${PATH}`]));
}

try {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [engineArg, dir, countArg] = args.filter((a) => a !== "--dry-run");
  const engine = engineArg as PerfEngine;
  if (!PERF_ENGINES.includes(engine)) throw new Error(`name the minted engine (${PERF_ENGINES.join(" or ")}); got ${JSON.stringify(engineArg)}`);
  const count = Number(countArg);
  if (!dir || !Number.isInteger(count)) throw new Error("usage: perf-baseline-mint.ts <engine> <passes dir> <passes> [--dry-run]");
  if (count < MIN_MINT_PASSES) throw new Error(`a mint takes at least ${MIN_MINT_PASSES} passes; got ${count}`);
  const before = committed();
  // The capture must leave the committed file alone, so what is on disk now
  // is what HEAD holds; a difference means something else wrote it.
  const onDisk = existsSync(FILE) ? formatBaselineFile(parseBaselineFile(readFileSync(FILE, "utf8"))) : formatBaselineFile({});
  if (onDisk !== formatBaselineFile(before)) throw new Error(`${PATH} on disk differs from HEAD's before the mint; the capture must not write it`);
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`${engine}-`) && f.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const passes = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as EngineBaseline);
  const summary = (lines: string[]): void => {
    process.stdout.write(lines.join("\n") + "\n");
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  };
  // The passes print first, so a refused mint still shows what it measured.
  summary([...passLines(engine, passes), ""]);
  if (files.length !== count) throw new Error(`${files.length} of ${count} ${engine} passes recorded a measurement; a failed pass records none, so nothing is minted`);
  const entry = entryFromPasses(engine, passes);
  const spread = spreadLines(engine, passSpread(passes, entry));
  const head = dryRun
    ? `perf baseline: a dry run of "${engine}" from ${count} passes; nothing written`
    : `perf baseline: "${engine}" minted from ${count} passes, the other entries kept as committed`;
  summary([head, "", ...spread, ""]);
  writeFileSync(join(dir, "spread.md"), [head, "", ...spread, ""].join("\n"));
  if (!dryRun) {
    writeFileSync(FILE, formatBaselineFile(withBaseline(before, entry)));
    const problem = mintProblem(before, parseBaselineFile(readFileSync(FILE, "utf8")), engine);
    if (problem) throw new Error(problem);
  }
} catch (e) {
  process.stderr.write(`perf-baseline-mint: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
