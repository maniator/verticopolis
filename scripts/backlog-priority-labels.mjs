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
 * Usage: `node scripts/backlog-priority-labels.mjs [--dry-run]`, with
 * `GITHUB_TOKEN` and `GITHUB_REPOSITORY` (`owner/name`) in the environment.
 * `--dry-run` prints the plan and changes nothing.
 *
 * Plain dependency-free JS so the workflow runs it with no install step. The
 * pure helpers are typed in backlog-priority-labels.d.mts for the unit test.
 */
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

/** How long GitHub asks a rate-limited caller to wait, in seconds, or null
 *  when the response is not a rate limit. `Retry-After` may be seconds or an
 *  HTTP date; a primary limit sends `x-ratelimit-remaining: 0` with the reset
 *  time instead. */
export function retryWaitSeconds(res, now = Date.now()) {
  const after = res.headers.get("retry-after");
  if (after !== null) {
    const secs = Number(after);
    if (Number.isFinite(secs)) return Math.max(secs, 1);
    const at = Date.parse(after);
    if (Number.isFinite(at)) return Math.max(Math.ceil((at - now) / 1000), 1);
  }
  if (res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0)
      return Math.max(Math.ceil(reset - now / 1000), 1);
  }
  return null;
}

/** Seconds to wait before retrying a rate-limited response, or null. A
 *  secondary limit can arrive as a 429, or a 403 that says so in its body,
 *  with neither timing header; GitHub's advice is then to wait a minute. */
async function rateLimitWait(res) {
  if (res.status !== 403 && res.status !== 429) return null;
  const wait = retryWaitSeconds(res);
  if (wait !== null) return wait;
  // A 429 is always a rate limit; with no timing header GitHub's advice is to
  // wait at least a minute. A 403 is one only when its body says so.
  if (res.status === 429) return 60;
  const text = await res.clone().text();
  return /secondary rate limit/i.test(text) ? 60 : null;
}

/** A REST client for `api.github.com`. Each call times out after 30 seconds,
 *  and a rate-limited call (403 or 429; see retryWaitSeconds) waits up to a
 *  minute and retries once. A failed call throws an Error carrying the HTTP `status`. Removing a
 *  label the issue no longer has is already the state we want, so that 404 is
 *  not an error. */
export function githubClient(
  token,
  { sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  const once = (method, path, body) =>
    fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  return async (method, path, body) => {
    let res = await once(method, path, body);
    let limited = await rateLimitWait(res);
    if (limited !== null && limited <= 60) {
      await sleep(limited * 1000);
      res = await once(method, path, body);
      limited = await rateLimitWait(res);
    }
    if (method === "DELETE" && res.status === 404) return null;
    if (!res.ok) {
      const err = new Error(
        `${method} ${path}: HTTP ${res.status} ${await res.text()}`,
      );
      err.status = res.status;
      // Still limited after one wait, or asked to wait past a minute: the
      // caller stops writing rather than spend the job's time on refusals.
      err.rateLimited = limited !== null;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  };
}

async function openIssueLabels(request, repo) {
  const out = new Map();
  for (let page = 1; ; page++) {
    const batch = await request(
      "GET",
      `/repos/${repo}/issues?state=open&per_page=100&page=${page}`,
    );
    for (const i of batch)
      if (!i.pull_request)
        out.set(
          i.number,
          i.labels.map((l) => l.name),
        );
    if (batch.length < 100) return out;
  }
}

/** One sync. `request(method, path, body)` talks to GitHub; `pauseMs` spaces
 *  every write out so a large first run stays under GitHub's secondary rate
 *  limit. Returns what it did; `ok` is false when any row or issue failed. */
export async function run({
  markdown,
  repo,
  request,
  dryRun = false,
  pauseMs = 1000,
  log = console.log,
}) {
  const { priorities, errors } = parseBacklogPriorities(markdown);
  for (const e of errors) log(`error: ${e}`);
  if (priorities.size === 0) {
    if (errors.length === 0)
      log("no open backlog row cites an issue; nothing to sync");
    return { ok: errors.length === 0, plan: [], failures: [], errors };
  }
  // A missing P label would be recreated by the add call with GitHub's default
  // color, quietly forking the taxonomy. Refuse to write instead.
  for (const p of PRIORITY_LABELS) {
    try {
      await request("GET", `/repos/${repo}/labels/${p}`);
    } catch (err) {
      const why =
        err?.status === 404
          ? `label ${p} does not exist in ${repo}; run the Sync labels workflow first`
          : `could not check label ${p}: ${err instanceof Error ? err.message : err}`;
      log(`error: ${why}`);
      return { ok: false, plan: [], failures: [], errors: [...errors, why] };
    }
  }
  const open = await openIssueLabels(request, repo);
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
  const write = async (method, path, body) => {
    try {
      await request(method, path, body);
    } finally {
      // Pace failed writes too, so one rate-limit refusal does not turn into
      // a burst of them.
      if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    }
  };
  for (const c of plan) {
    log(
      `#${c.issue}: ${[c.add && `+${c.add}`, ...c.remove.map((l) => `-${l}`)].filter(Boolean).join(" ")}`,
    );
    if (dryRun) continue;
    try {
      // Add first, so a failure partway leaves an extra label for the next run
      // to clear, never an issue with no P label at all.
      if (c.add)
        await write("POST", `/repos/${repo}/issues/${c.issue}/labels`, {
          labels: [c.add],
        });
      for (const l of c.remove)
        await write(
          "DELETE",
          `/repos/${repo}/issues/${c.issue}/labels/${encodeURIComponent(l)}`,
        );
    } catch (err) {
      failures.push(c.issue);
      log(`error: #${c.issue}: ${err instanceof Error ? err.message : err}`);
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
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo)
    throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set");
  const backlog = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../_bmad-output/implementation-artifacts/backlog.md",
  );
  const result = await run({
    markdown: readFileSync(backlog, "utf8"),
    repo,
    request: githubClient(token),
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
