/**
 * Replay every entry of conformance/fuzz-corpus/ on the native Rust engine and
 * through the shipped WASM build, and fail when the native run leaves the
 * entry's golden (conformance/fuzz-corpus/goldens/) or the WASM run leaves the
 * native one. The pull-request job (engine-rs.yml, `fuzz-corpus`) runs it on
 * an engine change. Usage:
 *   (cd engine-rs && cargo build --release --features conformance --bin fuzz)
 *   npm run wasm:build
 *   npx tsx scripts/fuzz-corpus.ts [--budget <seconds>] [--update]
 * --update pins each entry's native records as its golden instead of checking
 * them (local only, never in CI), and still checks the WASM leg; commit the
 * goldens with the change that moves them and say why.
 * Exit 0 all entries agree, 1 a divergence, an engine refusal or the budget
 * ran out (default 240 s, well under the job's ten-minute limit; a Rust replay
 * still running at the deadline is cut off, the WASM half has no timer of its
 * own so a hang there waits for the job's limit, and a run that finishes late
 * fails), 2 bad arguments, 3 the harness failed (no fuzzer, no WASM package,
 * an unreadable entry or folder, an empty corpus, a missing golden).
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { binaryProblem, rustMessage, rustReplay } from "../src/tests/conformance/fuzzBinary";
import { corpusExit, corpusFiles, goldenDir, goldenFiles, lateFailure, rustVerdict } from "../src/tests/conformance/fuzzCorpus";
import { goldenCompare, replayCompare } from "../src/tests/conformance/fuzzReplay";

const USAGE = "usage: fuzz-corpus [--budget <seconds>] [--update]";
const args = process.argv.slice(2);
const update = args.includes("--update");
const flag = args.indexOf("--budget");
const budget = flag >= 0 ? Number(args[flag + 1]) : 240;
const known = args.filter((a, i) => a === "--update" || a === "--budget" || (flag >= 0 && i === flag + 1));
if (!Number.isFinite(budget) || budget <= 0 || known.length !== args.length) {
  console.error(USAGE);
  process.exit(2);
}
if (update && process.env.CI) {
  console.error("fuzz-corpus --update is a local regeneration switch and never runs in CI");
  process.exit(2);
}
const problem = binaryProblem();
if (problem) {
  console.error(`HARNESS: ${problem}`);
  process.exit(3);
}
let files: string[] = [];
try {
  files = corpusFiles();
} catch (e) {
  console.error(`HARNESS: cannot read conformance/fuzz-corpus/: ${(e as Error).message}`);
  process.exit(3);
}
if (files.length === 0) {
  console.error("HARNESS: conformance/fuzz-corpus/ holds no entries, so the job would prove nothing");
  process.exit(3);
}

const work = mkdtempSync(join(tmpdir(), "vc-corpus-"));
const started = Date.now();
const failed: string[] = [];
let harness = false;
try {
  for (const file of files) {
    const name = basename(file);
    if ((Date.now() - started) / 1000 > budget) {
      console.log(`${name}: not run, the ${budget} s budget is spent`);
      failed.push(`${name} (over budget)`);
      continue;
    }
    const remainingMs = budget * 1000 - (Date.now() - started);
    const rust = rustReplay(file, work, Math.min(120_000, remainingMs));
    if (rust.code === 3 && Date.now() - started >= budget * 1000) {
      console.log(`${name}: the Rust replay was cut off by the ${budget} s budget`);
      failed.push(`${name} (over budget)`);
      continue;
    }
    const verdict = rustVerdict(rust.code);
    if (verdict !== "ok") {
      console.log(`${name}: the Rust engine ${rust.code === 1 ? "stopped" : rust.code === 101 ? "panicked" : `failed (${rust.code})`}: ${rustMessage(rust.stderr)}`);
      if (verdict === "failed") failed.push(name);
      else harness = true;
      continue;
    }
    const id = name.replace(/\.json$/, "");
    if (update) {
      mkdirSync(goldenDir(), { recursive: true });
      for (const record of goldenFiles(id)) copyFileSync(join(work, record), join(goldenDir(), record));
    } else {
      const g = goldenCompare(file, goldenDir(), work);
      if (g.status !== "ok") {
        console.log(`${name}: native Rust against its golden: ${g.message}`);
        if (g.status === "harness") harness = true;
        else failed.push(name);
        continue;
      }
    }
    const r = replayCompare(file, work);
    if (r.status === "ok") console.log(`${name}: ok (${r.checkpoints} checkpoints${update ? ", golden pinned" : ""})`);
    else {
      console.log(`${name}: ${r.message}`);
      if (r.status === "harness") harness = true;
      else failed.push(name);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
const elapsed = (Date.now() - started) / 1000;
failed.push(...lateFailure(elapsed, budget, failed));
const seconds = elapsed.toFixed(1);
console.log(`${files.length} corpus entries in ${seconds} s${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
process.exit(corpusExit(failed, harness));
