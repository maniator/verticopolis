/**
 * Mirror each backlog row's Priority onto its GitHub issue as a P1/P2/P3 label.
 *
 * The curated table in `_bmad-output/implementation-artifacts/backlog.md` is the
 * source of truth for an issue's priority (see its "How items flow"). The
 * `backlog-priority-labels.yml` workflow runs this when a push to `main` changes
 * the backlog, and weekly, so the label follows the row.
 *
 * Scope, kept narrow on purpose:
 * - Only OPEN issues that a row cites in its `GH` column are touched. An issue
 *   with no row (a community report, say) keeps whatever P label triage gave it.
 * - Only the three P labels change, plus `needs-triage`, which comes off a
 *   row-cited issue because having a row means it has been triaged.
 * - The table is parsed as text. Nothing in it is executed.
 *
 * A row it cannot read, or an issue it fails to relabel, is reported and the
 * rest still sync; the run then exits 1 so the failure shows on the workflow.
 * Rows that cite an issue that is not open are listed as warnings: the backlog's
 * rule says to true those rows up.
 *
 * Usage: `node scripts/backlog-priority-labels.mjs [--dry-run]`. It talks to
 * GitHub through the `gh` CLI, which GitHub's runners ship with: the workflow
 * passes the job token as `GH_TOKEN`, and locally your `gh auth login` session
 * works. It targets `maniator/verticopolis`, whose issues the backlog cites
 * (in Actions, the job's `GITHUB_REPOSITORY`, which the workflow guards).
 * `--dry-run` prints the plan and changes nothing.
 *
 * Plain dependency-free JS so the workflow runs it with no install step. The
 * pure helpers are typed in backlog-priority-labels.d.mts for the unit test.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const PRIORITY_LABELS = ["P1", "P2", "P3"];
export const TRIAGE_LABEL = "needs-triage";

const HEADER =
  "| Date | Story | GH | Epic | Type | Priority | Severity | Owner | Status | Notes |";

/** Issue number to the priority its row records. Rows without a `#N` in the GH
 *  column (finished rows carry `—`) are skipped; backlogIssueMirror.test.ts
 *  already fails CI on any other GH value and on a malformed row. A row whose
 *  Priority is not P1/P2/P3 is reported in `errors` rather than guessed. Pipes
 *  escaped as `\|` inside Notes do not split cells, matching that test. */
export function parseBacklogPriorities(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimEnd() === HEADER);
  const priorities = new Map();
  const errors = [];
  const conflicted = new Set();
  if (start < 0)
    return { priorities, errors: ["curated-table header not found"] };
  for (let i = start + 2; i < lines.length && lines[i].trim() !== ""; i++) {
    const cells = lines[i].split(/(?<!\\)\|/).map((c) => c.trim());
    const gh = /^#(\d+)$/.exec(cells[3] ?? "");
    if (!gh) continue;
    const issue = Number(gh[1]);
    const priority = cells[6];
    if (!PRIORITY_LABELS.includes(priority)) {
      errors.push(
        `#${issue}: priority ${JSON.stringify(priority)} is not P1, P2 or P3`,
      );
      // Hold the issue back, as for rows that disagree.
      priorities.delete(issue);
      conflicted.add(issue);
      continue;
    }
    if (conflicted.has(issue)) continue;
    if (priorities.has(issue) && priorities.get(issue) !== priority) {
      // Leave the issue alone rather than pick a row by its position.
      errors.push(`#${issue}: rows disagree on its priority`);
      priorities.delete(issue);
      conflicted.add(issue);
      continue;
    }
    priorities.set(issue, priority);
  }
  return { priorities, errors };
}

/** The smallest change that leaves each open, row-cited issue with exactly its
 *  row's P label and no `needs-triage`. Issues not in `openIssues` (closed, or
 *  not found) are left alone, and so is every open issue no row cites. */
export function planLabelChanges(priorities, openIssues) {
  const plan = [];
  for (const [issue, want] of [...priorities].sort((a, b) => a[0] - b[0])) {
    const labels = openIssues.get(issue);
    if (!labels) continue;
    const add = labels.includes(want) ? null : want;
    const remove = [
      ...PRIORITY_LABELS.filter((p) => p !== want),
      TRIAGE_LABEL,
    ].filter((l) => labels.includes(l));
    if (add || remove.length) plan.push({ issue, add, remove });
  }
  return plan;
}

/** Row-cited issues that are not open, so the rows can be trued up. */
export function citedButNotOpen(priorities, openIssues) {
  return [...priorities.keys()]
    .filter((n) => !openIssues.has(n))
    .sort((a, b) => a - b);
}

/** What gh prints when GitHub refuses a call because of a rate limit: the
 *  primary and secondary limit messages, a bare 429 (`gh api` ends each error
 *  with the HTTP status), and the GraphQL wording for mutations sent too fast.
 *  gh passes GitHub's own message through, so this follows GitHub's wording. */
const RATE_LIMITED =
  /rate limit|HTTP 429|submitted too quickly|abuse detection/i;

/** Runs the GitHub CLI and resolves to its stdout. `gh` brings the auth
 *  (`GH_TOKEN` in the workflow, a `gh auth login` session locally), the
 *  pagination and the HTTP plumbing. A failed call rejects with an Error whose
 *  message carries gh's stderr; `rateLimited` is set when that stderr says
 *  GitHub refused the call because of a rate limit. Each call times out after
 *  a minute. */
export function ghCli() {
  return (args) =>
    new Promise((resolvePromise, reject) => {
      execFile(
        "gh",
        args,
        { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
        (err, stdout, stderr) => {
          if (!err) return resolvePromise(stdout);
          const why =
            err.code === "ENOENT"
              ? "the gh CLI is not on PATH; install it from https://cli.github.com"
              : err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                ? "printed more output than expected"
                : err.killed
                  ? `timed out after a minute${args[0] === "api" ? " (the write may still have landed; the next run checks)" : ""}`
                  : String(stderr).trim() || err.message;
          const what = args.filter((a) => !a.startsWith("-")).slice(0, 3);
          const e = new Error(`gh ${what.join(" ")}: ${why}`);
          e.rateLimited = RATE_LIMITED.test(why);
          reject(e);
        },
      );
    });
}

/** gh's list commands stop quietly at `--limit`, so a list that fills it is
 *  treated as cut short. */
const LIST_LIMIT = 10_000;

async function ghList(gh, args) {
  const items = JSON.parse(await gh([...args, "--limit", String(LIST_LIMIT)]));
  if (items.length >= LIST_LIMIT)
    throw new Error(
      `gh ${args.slice(0, 2).join(" ")} returned ${items.length} items, the --limit; raise LIST_LIMIT`,
    );
  return items;
}

/** Open issues to their label names. `gh issue list` returns issues only,
 *  never pull requests. */
async function openIssueLabels(gh, repo) {
  const issues = await ghList(gh, [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--json",
    "number,labels",
  ]);
  return new Map(issues.map((i) => [i.number, i.labels.map((l) => l.name)]));
}

const message = (err) => (err instanceof Error ? err.message : String(err));

/** One sync. `gh(args)` runs the GitHub CLI and resolves to its stdout;
 *  `pauseMs` spaces every write out so a large first run stays under GitHub's
 *  secondary rate limit. A write refused for rate waits `limitWaitMs` (GitHub
 *  asks for at least a minute) and retries once; refused again, the run stops
 *  writing. Returns what it did; `ok` is false when any row or issue failed. */
export async function run({
  markdown,
  repo,
  gh,
  dryRun = false,
  pauseMs = 1000,
  limitWaitMs = 60_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
}) {
  const { priorities, errors } = parseBacklogPriorities(markdown);
  for (const e of errors) log(`error: ${e}`);
  if (priorities.size === 0) {
    if (errors.length === 0)
      log("no open backlog row cites an issue; nothing to sync");
    return { ok: errors.length === 0, plan: [], failures: [], errors };
  }
  const stop = (why) => {
    log(`error: ${why}`);
    return { ok: false, plan: [], failures: [], errors: [...errors, why] };
  };
  // gh refuses to add a label the repository lacks, so a missing P label would
  // fail every issue one by one. Check once and stop with a clear reason.
  let missing;
  try {
    const labels = (
      await ghList(gh, ["label", "list", "--repo", repo, "--json", "name"])
    ).map((l) => l.name);
    missing = PRIORITY_LABELS.filter((p) => !labels.includes(p));
  } catch (err) {
    return stop(`could not list labels: ${message(err)}`);
  }
  if (missing.length)
    return stop(
      `${missing.length > 1 ? "labels" : "label"} ${missing.join(", ")} missing from ${repo}; run the Sync labels workflow first`,
    );
  let open;
  try {
    open = await openIssueLabels(gh, repo);
  } catch (err) {
    return stop(`could not list open issues: ${message(err)}`);
  }
  const stale = citedButNotOpen(priorities, open);
  // A `::warning::` line becomes an annotation on the workflow run's summary.
  if (stale.length)
    log(
      `::warning::backlog rows cite numbers that are not open issues (closed, or a pull request); true the rows up: ${stale.map((n) => `#${n}`).join(" ")}`,
    );
  const plan = planLabelChanges(priorities, open);
  log(
    `${priorities.size} row-cited issues, ${plan.length} to relabel${dryRun ? " (dry run)" : ""}`,
  );
  const failures = [];
  // Writes go through `gh api` to the REST endpoints: one request per label,
  // where `gh issue edit` spends several GraphQL requests on each edit and
  // could run a large first sync into the token's hourly budget.
  const write = async (args) => {
    try {
      try {
        await gh(args);
      } catch (err) {
        if (!err?.rateLimited) throw err;
        log(`${args[3]}: rate limited; waiting, then retrying once`);
        await sleep(limitWaitMs);
        await gh(args);
      }
    } finally {
      // Pace failed writes too, so one refusal does not turn into a burst.
      if (pauseMs > 0) await sleep(pauseMs);
    }
  };
  const labelsPath = (issue) => `repos/${repo}/issues/${issue}/labels`;
  for (const c of plan) {
    log(
      `#${c.issue}: ${[c.add && `+${c.add}`, ...c.remove.map((l) => `-${l}`)].filter(Boolean).join(" ")}`,
    );
    if (dryRun) continue;
    try {
      // Add first, so a failure partway leaves an extra label for the next run
      // to clear, never an issue with no P label at all.
      if (c.add)
        await write([
          "api",
          "--method",
          "POST",
          labelsPath(c.issue),
          "--silent",
          "-f",
          `labels[]=${c.add}`,
        ]);
      for (const l of c.remove) {
        try {
          await write([
            "api",
            "--method",
            "DELETE",
            `${labelsPath(c.issue)}/${encodeURIComponent(l)}`,
            "--silent",
          ]);
        } catch (err) {
          // The label is already off the issue: the state we want. `gh api`
          // prints GitHub's message and the status; any other 404 (a missing
          // issue, lost access) stays a failure.
          if (!/Label does not exist \(HTTP 404\)/.test(message(err)))
            throw err;
        }
      }
    } catch (err) {
      failures.push(c.issue);
      log(`error: #${c.issue}: ${message(err)}`);
      if (err?.rateLimited) {
        const skipped = plan.slice(plan.indexOf(c) + 1).map((x) => x.issue);
        failures.push(...skipped);
        log(
          `error: rate limited; stopping, the next run picks up ${skipped.length} skipped issue(s)`,
        );
        break;
      }
    }
  }
  return {
    ok: errors.length === 0 && failures.length === 0,
    plan,
    failures,
    errors,
  };
}

async function main() {
  const gh = ghCli();
  // The backlog's issue numbers belong to this repository, so a local run
  // targets it whatever checkout, fork or codespace the shell is in. Only an
  // Actions run reads GITHUB_REPOSITORY, which the job guards to this repo.
  const repo =
    (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REPOSITORY) ||
    "maniator/verticopolis";
  const backlog = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../_bmad-output/implementation-artifacts/backlog.md",
  );
  const result = await run({
    markdown: readFileSync(backlog, "utf8"),
    repo,
    gh,
    dryRun: process.argv.includes("--dry-run"),
  });
  if (!result.ok) process.exit(1);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
