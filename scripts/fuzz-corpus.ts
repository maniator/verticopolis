/**
 * Replay every entry of conformance/fuzz-corpus/ on both engines and fail if
 * they disagree. The pull-request job (engine-rs.yml, `fuzz-corpus`) runs it
 * on a change to either engine. Usage:
 *   (cd engine-rs && cargo build --release --features conformance --bin fuzz)
 *   npx tsx scripts/fuzz-corpus.ts [--budget <seconds>]
 * Exit 0 all entries agree, 1 a divergence, an engine refusal or the budget
 * ran out (default 480 s, under the job's ten-minute limit), 3 the harness
 * failed (no fuzzer, an unreadable entry, an empty corpus).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { binaryProblem, rustReplay } from "../src/tests/conformance/fuzzBinary";
import { corpusFiles } from "../src/tests/conformance/fuzzCorpus";
import { replayCompare } from "../src/tests/conformance/fuzzReplay";

const flag = process.argv.indexOf("--budget");
const budget = flag >= 0 ? Number(process.argv[flag + 1]) : 480;
if (!Number.isFinite(budget) || budget <= 0) {
  console.error("usage: fuzz-corpus [--budget <seconds>]");
  process.exit(2);
}
const problem = binaryProblem();
if (problem) {
  console.error(`HARNESS: ${problem}`);
  process.exit(3);
}
const files = corpusFiles();
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
    const rust = rustReplay(file, work);
    if (rust.code !== 0) {
      console.log(`${name}: the Rust engine ${rust.code === 1 ? "stopped" : rust.code === 101 ? "panicked" : `failed (${rust.code})`}: ${rust.stderr.trim().split("\n").pop()}`);
      if (rust.code === 1 || rust.code === 101) failed.push(name);
      else harness = true;
      continue;
    }
    const r = replayCompare(file, work);
    if (r.status === "ok") console.log(`${name}: ok (${r.checkpoints} checkpoints)`);
    else {
      console.log(`${name}: ${r.message}`);
      if (r.status === "harness") harness = true;
      else failed.push(name);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`${files.length} corpus entries in ${seconds} s${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
process.exit(failed.length ? 1 : harness ? 3 : 0);
