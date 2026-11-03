/**
 * Shrink a diverging fuzzer scenario to a 1-minimal command list (no single
 * command can be dropped) that still diverges the same way, and write it to
 * the corpus. Delta debugging does not promise the globally shortest list, and
 * a run cut off by `--max-tests` may not be 1-minimal; the entry's description
 * says so. Usage:
 *   npx tsx scripts/fuzz-shrink.ts <fuzz-out>/fuzz-<seed>.json <name> [--wasm] [--max-tests 4000]
 * With `--wasm` the candidates replay on the shipped WASM build in Node
 * (`npm run wasm:build`) instead of the TypeScript engine, so a night that
 * diverged only on the WASM leg, or trapped there, can be shrunk. The fuzzer
 * (`cargo build --release --features conformance --bin fuzz`, in engine-rs/)
 * must be built. A candidate counts as still failing only when the Rust engine
 * runs it cleanly and the chosen leg (TypeScript, or WASM with `--wasm`) shows
 * the same kind of divergence as the original (`state:units`, `money`,
 * `threw`, or `trap` on the WASM leg), so a smaller scenario that merely
 * breaks differently is not accepted. The result goes to
 * conformance/fuzz-corpus/<name>.json; commit it with the fix, where the corpus
 * job then holds it to agreement. Exit 0 written, 1 the original does not
 * diverge (or the Rust engine refuses it), 2 bad arguments, an unreadable input
 * or a taken name, 3 the harness failed (no fuzzer, no WASM package with
 * `--wasm`, a timeout, a malformed record). The default limit is 4000 tests: a
 * tall night needs about 1300.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { binaryProblem, rustMessage, rustReplay } from "../src/tests/conformance/fuzzBinary";
import type { Leg } from "../src/tests/conformance/fuzzCompare";
import { replayCompare } from "../src/tests/conformance/fuzzReplay";
import { ddmin } from "../src/tests/conformance/fuzzShrink";
import { CORPUS_NAME, corpusDir } from "../src/tests/conformance/fuzzCorpus";

/** What running a candidate on both engines showed. Only `diverged` can be
 *  shrunk toward; the others tell the caller why it cannot. */
type Shown =
  | { kind: "diverged"; signature: string }
  | { kind: "converged" }
  | { kind: "refused"; message: string }
  | { kind: "harness"; message: string };

/** The flags after the file and name: `--wasm` and `--max-tests <n>`, each at
 *  most once. Anything else (a typo such as `--wams`) is refused, so a shrink
 *  never quietly runs on the leg the caller did not mean. */
function parseOptions(args: readonly string[]): { maxTests: number; leg: Leg } | null {
  let maxTests = 4000;
  let leg: Leg = "TypeScript";
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) return null;
    seen.add(arg);
    if (arg === "--wasm") leg = "WASM";
    else if (arg === "--max-tests") {
      maxTests = Number(args[++i]);
      if (!Number.isInteger(maxTests) || maxTests < 1) return null;
    } else return null;
  }
  return { maxTests, leg };
}

function main(): number {
  const [file, name, ...rest] = process.argv.slice(2);
  const options = parseOptions(rest);
  if (!file || !name || !CORPUS_NAME.test(name) || !options) {
    console.error("usage: fuzz-shrink <scenario.json> <name: lowercase words and digits joined by dashes> [--wasm] [--max-tests <n>]");
    return 2;
  }
  const { maxTests, leg } = options;
  const problem = binaryProblem();
  if (problem) {
    console.error(problem);
    return 3;
  }
  // Check the name before any work, so a taken one fails fast and no work
  // directory exists yet to leak.
  const out = resolve(corpusDir(), `${name}.json`);
  if (existsSync(out)) {
    console.error(`${out} already exists; pick another name`);
    return 2;
  }

  let original: { id: string; description: string; start: unknown; commands: unknown[] };
  try {
    original = JSON.parse(readFileSync(file, "utf8"));
    if (!original || typeof original.id !== "string" || typeof original.description !== "string" || !Array.isArray(original.commands)) throw new Error("not a scenario (needs id, description and commands)");
  } catch (e) {
    console.error(`${file}: cannot read the scenario: ${(e as Error).message}`);
    return 2;
  }
  const work = mkdtempSync(join(tmpdir(), "vc-shrink-"));
  try {
    /** Run a candidate: the Rust engine must run it cleanly (a scenario it
     *  refuses is not a valid shrink) and the chosen leg must then differ. */
    const show = (commands: readonly unknown[], id = "candidate"): Shown => {
      const path = join(work, `${id}.json`);
      writeFileSync(path, JSON.stringify({ ...original, id, commands }));
      const rust = rustReplay(path, work);
      if (rust.code === 1) return { kind: "refused", message: `the Rust engine refuses it: ${rustMessage(rust.stderr)}` };
      if (rust.code !== 0) return { kind: "harness", message: `the Rust replay failed (${rust.code}): ${rustMessage(rust.stderr)}` };
      const r = replayCompare(path, work, leg);
      if (r.status === "harness") return { kind: "harness", message: r.message };
      return r.status === "diverged" ? { kind: "diverged", signature: r.signature } : { kind: "converged" };
    };

    const first = show(original.commands, "original");
    if (first.kind === "harness") {
      console.error(`${file}: ${first.message}`);
      return 3;
    }
    if (first.kind !== "diverged") {
      console.log(`${file}: ${first.kind === "refused" ? first.message : "does not diverge with the fuzzer's current build"}, nothing to shrink`);
      return 1;
    }
    const target = first.signature;
    // A harness failure on a candidate is not "still failing": the shrink
    // goes on without it, and the final result is still a verified divergence.
    const r = ddmin(original.commands, (c) => {
      const shown = show(c);
      return shown.kind === "diverged" && shown.signature === target;
    }, maxTests);
    const note = r.exhausted ? " The search stopped at its test limit, so the list may not be 1-minimal." : "";
    const shrunk = {
      id: name,
      description: `Shrunk from ${original.id} (${original.commands.length} to ${r.kept.length} commands), which diverged as ${target} on the ${leg} leg.${note} ${original.description}`,
      start: original.start,
      commands: r.kept,
    };
    mkdirSync(corpusDir(), { recursive: true });
    writeFileSync(out, `${JSON.stringify(shrunk, null, 2)}\n`);
    console.log(`${original.commands.length} commands to ${r.kept.length} in ${r.tests} tests${r.exhausted ? " (stopped at the test limit, may not be 1-minimal)" : ""}; signature ${target}; wrote ${out}`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

process.exit(main());
