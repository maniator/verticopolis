/**
 * Lays out open issues filed before the issue forms in their form's fields
 * (`.github/workflows/issue-form-backfill.yml`). The rules are in
 * `src/build/issueBackfill.ts`: each body moves word for word under its form's
 * first required text field, and every other field gets its heading.
 *
 *   node scripts/issue-form-backfill.ts [--author <login>] [--write]
 *
 * Only issues opened by `--author` (default `maniator`, the account agents
 * file under) before the forms applied are touched, so community reports keep
 * their own text. An issue with no type label, one that already follows its
 * form, and one that already has the form's headings are skipped, so a second
 * run changes nothing. Without `--write` it only prints what it would change.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasFormLayout, reshapeIssueBody } from "../src/build/issueBackfill.ts";
import { checkIssueBody, formForLabels, parseIssueForm } from "../src/build/issueForms.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORM_ORDER = ["parity_report", "bug_report", "documentation", "feature_request", "task"];
const FORMS_SINCE = "2026-11-12T05:00:00Z";
/** GitHub's limit on an issue body. */
const MAX_BODY = 65536;
/** A pause between edits, to stay under GitHub's secondary rate limit on writes. */
const EDIT_PAUSE_MS = 1000;
const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const argAfter = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const author = argAfter("--author") ?? "maniator";
const write = process.argv.includes("--write");

const forms = FORM_ORDER.map((stem) =>
  parseIssueForm(readFileSync(resolve(root, ".github/ISSUE_TEMPLATE", `${stem}.yml`), "utf8")),
);

interface Issue {
  number: number;
  body: string | null;
  createdAt: string;
  author: { login: string } | null;
  labels: { name: string }[];
}

const gh = (args: string[], input?: string): string =>
  execFileSync("gh", args, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });

const issues = JSON.parse(
  gh(["issue", "list", "--state", "open", "--limit", "2000", "--json", "number,body,createdAt,author,labels"]),
) as Issue[];

const tally = { reshaped: 0, otherAuthor: 0, afterForms: 0, noType: 0, follows: 0, laidOut: 0 };
for (const issue of issues) {
  const body = issue.body ?? "";
  const labels = issue.labels.map((l) => l.name);
  const form = formForLabels(labels, forms);
  if (issue.author?.login !== author) tally.otherAuthor++;
  else if (issue.createdAt >= FORMS_SINCE) tally.afterForms++;
  else if (!form) tally.noType++;
  else if (checkIssueBody(body, form).length === 0) tally.follows++;
  else if (hasFormLayout(body, form)) tally.laidOut++;
  else {
    const next = reshapeIssueBody(body, labels, form);
    if (next.length > MAX_BODY) throw new Error(`#${issue.number}: the reshaped body passes GitHub's limit`);
    console.log(`#${issue.number} -> ${form.name}${write ? "" : " (dry run)"}`);
    if (write) {
      gh(["issue", "edit", String(issue.number), "--body-file", "-"], next);
      pause(EDIT_PAUSE_MS);
    }
    tally.reshaped++;
  }
}
console.log(
  `${write ? "Reshaped" : "Would reshape"} ${tally.reshaped} of ${issues.length} open issues. ` +
    `Skipped: ${tally.otherAuthor} by another author, ${tally.afterForms} filed after the forms, ` +
    `${tally.noType} with no type label, ${tally.follows} that follow their form, ${tally.laidOut} already laid out.`,
);
