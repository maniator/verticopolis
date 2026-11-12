/**
 * Checks an issue body against the issue form its labels call for
 * (`.github/workflows/issue-form.yml`, or `npm run issue:check` before filing).
 * The rules are in `src/build/issueForms.ts`.
 *
 *   node scripts/issue-form-check.ts (--form <name> | --labels <a,b,...>) [--body-file <path>]
 *
 * `--form` names a file in `.github/ISSUE_TEMPLATE/` without `.yml`
 * (`bug_report`, `feature_request`, `parity_report`, `documentation`, `task`).
 * `--labels` picks the form from the issue's labels, in the order below, so a
 * parity bug follows the parity form. The body comes from `--body-file`, or
 * else the `ISSUE_BODY` environment variable (the workflow passes it there,
 * never through the command line).
 *
 * Exit codes: 0 when the body follows the form, 1 when it does not, and 3 when
 * no label names a form (the workflow leaves such an issue alone).
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkIssueBody, formForLabels, parseIssueForm, type IssueForm } from "../src/build/issueForms.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORM_DIR = ".github/ISSUE_TEMPLATE";
/** The order forms are tried in when several match an issue's labels. */
const FORM_ORDER = ["parity_report", "bug_report", "documentation", "feature_request", "task"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const read = (stem: string): IssueForm => parseIssueForm(readFileSync(resolve(root, FORM_DIR, `${stem}.yml`), "utf8"));

const formName = arg("--form");
const labelArg = arg("--labels");
if (!formName && labelArg === undefined) {
  console.error("usage: node scripts/issue-form-check.ts (--form <name> | --labels <a,b,...>) [--body-file <path>]");
  process.exit(2);
}
let form: IssueForm | undefined;
if (formName) {
  form = read(formName);
} else {
  const labels = (labelArg ?? "").split(",").map((l) => l.trim()).filter(Boolean);
  form = formForLabels(labels, FORM_ORDER.map(read));
  if (!form) {
    console.log(`No issue form matches the labels [${labels.join(", ")}]; nothing to check.`);
    process.exit(3);
  }
}

const bodyFile = arg("--body-file");
const body = bodyFile ? readFileSync(bodyFile, "utf8") : (process.env.ISSUE_BODY ?? "");
const problems = checkIssueBody(body, form);
if (problems.length === 0) {
  console.log(`The body follows the "${form.name}" form.`);
  process.exit(0);
}
console.error(`The body does not follow the "${form.name}" form:`);
for (const problem of problems) console.error(`  - ${problem}`);
console.error(
  'Write one "### <field label>" section per form field, in the form\'s order, and answer each required one. ' +
    'See AGENTS.md, "Filing issues".',
);
process.exit(1);
