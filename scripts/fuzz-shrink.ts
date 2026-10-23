/**
 * Shrink a diverging fuzzer scenario to the shortest command list that still
 * diverges the same way, and write it to the corpus. Usage:
 *   npx tsx scripts/fuzz-shrink.ts <fuzz-out>/fuzz-<seed>.json <name> [--max-tests 400]
 * The fuzzer (`cargo build --release --features conformance --bin fuzz`, in
 * engine-rs/) must be built. A candidate counts as still failing only when the
 * Rust engine runs it cleanly and the TypeScript replay shows the same kind of
 * divergence as the original (`state:units`, `money`, `threw`), so a smaller
 * scenario that merely breaks differently is not accepted. The result goes to
 * conformance/fuzz-corpus/<name>.json; commit it with the fix, where the corpus
 * job then holds it to agreement. Exit 0 written, 1 the original does not
 * diverge, 2 bad arguments, 3 the harness failed.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { binaryProblem, rustReplay } from "../src/tests/conformance/fuzzBinary";
import { replayCompare } from "../src/tests/conformance/fuzzReplay";
import { ddmin } from "../src/tests/conformance/fuzzShrink";
import { CORPUS_NAME, corpusDir } from "../src/tests/conformance/fuzzCorpus";

const [file, name, ...rest] = process.argv.slice(2);
const flag = rest.indexOf("--max-tests");
const maxTests = flag >= 0 ? Number(rest[flag + 1]) : 400;
if (!file || !name || !CORPUS_NAME.test(name) || !Number.isInteger(maxTests) || maxTests < 1) {
  console.error("usage: fuzz-shrink <scenario.json> <name: lowercase words and digits joined by dashes> [--max-tests <n>]");
  process.exit(2);
}
const problem = binaryProblem();
if (problem) {
  console.error(problem);
  process.exit(3);
}

const original = JSON.parse(readFileSync(file, "utf8")) as { id: string; description: string; start: unknown; commands: unknown[] };
const out = resolve(corpusDir(), `${name}.json`);
if (existsSync(out)) {
  console.error(`${out} already exists; pick another name`);
  process.exitCode = 2;
} else {
  const work = mkdtempSync(join(tmpdir(), "vc-shrink-"));

  /** What the candidate shows: a signature when Rust ran it clean and TypeScript
   *  diverged, otherwise null (it converged, or it is not a valid scenario). */
  function show(commands: readonly unknown[], id = "candidate"): string | null {
    const path = join(work, `${id}.json`);
    writeFileSync(path, JSON.stringify({ ...original, id, commands }));
    if (rustReplay(path, work).code !== 0) return null;
    const r = replayCompare(path, work);
    return r.status === "diverged" ? r.signature : null;
  }

  try {
    const target = show(original.commands, "original");
    if (target === null) {
      console.log(`${file}: does not diverge with the fuzzer's current build, nothing to shrink`);
      process.exitCode = 1;
      return;
    }
    const r = ddmin(original.commands, (c) => show(c) === target, maxTests);
    const shrunk = {
      id: name,
      description: `Shrunk from ${original.id} (${original.commands.length} to ${r.kept.length} commands), which diverged as ${target}. ${original.description}`,
      start: original.start,
      commands: r.kept,
    };
    mkdirSync(corpusDir(), { recursive: true });
    writeFileSync(out, `${JSON.stringify(shrunk, null, 2)}\n`);
    console.log(`${original.commands.length} commands to ${r.kept.length} in ${r.tests} tests${r.exhausted ? " (stopped at the test limit, may not be minimal)" : ""}; signature ${target}; wrote ${out}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
