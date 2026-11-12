/**
 * Checks a pull request description against `.github/PULL_REQUEST_TEMPLATE.md`
 * (`.github/workflows/pr-template.yml`, or `npm run pr:check` before opening a
 * PR). The rules are in `src/build/prTemplate.ts`.
 *
 *   node scripts/pr-template-check.ts [--body-file <path>] [--branch <name>] [--author <login>]
 *
 * The description comes from `--body-file`, or else the `PR_BODY` environment
 * variable (the workflow passes it there, never through the command line).
 * Release PRs (`release/` branches), Dependabot branches and bot authors are
 * skipped: their descriptions are written by their tools.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPrBody } from "../src/build/prTemplate.ts";
import { BOT_BRANCH, RELEASE_BRANCH } from "../src/build/versionCheck.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = ".github/PULL_REQUEST_TEMPLATE.md";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const branch = arg("--branch") ?? "";
const author = arg("--author") ?? "";
if (RELEASE_BRANCH.test(branch) || BOT_BRANCH.test(branch) || author.endsWith("[bot]")) {
  console.log(`Skipped: ${branch || author} writes its own description.`);
  process.exit(0);
}

const bodyFile = arg("--body-file");
const body = bodyFile ? readFileSync(bodyFile, "utf8") : (process.env.PR_BODY ?? "");
const problems = checkPrBody(body, readFileSync(resolve(root, TEMPLATE), "utf8"));
if (problems.length === 0) {
  console.log(`The description follows ${TEMPLATE}.`);
  process.exit(0);
}
console.error(`The description does not follow ${TEMPLATE}:`);
for (const problem of problems) console.error(`  - ${problem}`);
console.error(
  "Start the body from the template, keep every ## heading, and fill each section " +
    '("None" or "n/a: <reason>" where it does not apply). See AGENTS.md, "Pull request descriptions".',
);
process.exit(1);
