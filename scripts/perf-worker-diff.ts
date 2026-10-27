/**
 * `npm run perf:worker-diff -- BEFORE_DIR AFTER_DIR [--out FILE]`: the paired
 * comparison of two `perf:worker` result folders (see
 * src/tests/perfWorker/crossRun.ts). Exits 1 when the pair is not comparable
 * or a control row moved, so a void comparison cannot pass quietly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crossMarkdown, crossRun, type CrossInput } from "../src/tests/perfWorker/crossRun";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const dirs = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
if (dirs.length !== 2) {
  process.stderr.write("usage: perf:worker-diff BEFORE_DIR AFTER_DIR [--out FILE]\n");
  process.exit(2);
}
const read = (d: string): CrossInput => JSON.parse(readFileSync(join(resolve(d), "results.json"), "utf8")) as CrossInput;
const [before, after] = [read(dirs[0]), read(dirs[1])];
const result = crossRun(before, after);
const text = crossMarkdown(before, after, result);
if (out) writeFileSync(resolve(out), text);
process.stdout.write(text);
process.exit(result.errors.length > 0 || result.voided.length > 0 ? 1 : 0);
