/**
 * Writes the Test CI lane for a list of changed paths (the `changes` job in
 * test.yml). The rules are in `src/build/prLane.ts`.
 *
 *   node scripts/pr-lane.ts <file listing one changed path per line>
 *
 * Each line is a path, or "F <path>" / "P <path>" (a file, or the old path of
 * a rename) as the workflow writes them. The result goes to $GITHUB_OUTPUT as
 * `code`, `tests` and `lane`, or to stdout when that is unset.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { prLane } from "../src/build/prLane.ts";

const listFile = process.argv[2];
if (!listFile) {
  console.error("usage: node scripts/pr-lane.ts <changed-paths-file>");
  process.exit(2);
}

const paths = readFileSync(listFile, "utf8")
  .split("\n")
  .map((line) => line.replace(/^[FP] /, ""));
const { code, tests, lane } = prLane(paths);
const lines = `code=${code}\ntests=${tests}\nlane=${lane}\n`;
const out = process.env.GITHUB_OUTPUT;
if (out) appendFileSync(out, lines);
else process.stdout.write(lines);
console.error(`lane: ${lane} (application paths changed: ${code}; test inputs changed: ${tests})`);
