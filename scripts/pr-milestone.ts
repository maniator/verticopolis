/**
 * Gives pull requests a milestone (`.github/workflows/pr-milestone.yml`). The
 * rules are in `src/build/prMilestone.ts`; this file only connects them to
 * GitHub through `gh`.
 *
 *   node scripts/pr-milestone.ts [--dry-run]           the pull request in PR
 *   node scripts/pr-milestone.ts --sweep [--dry-run]   every open one without
 *
 * GH_REPO and CURRENT_RELEASE come from the workflow, and PR (a number) for a
 * single pull request. The description is read from the API as data, never
 * from the command line. `gh` is called with an argument list, never through
 * a shell. `--dry-run` prints the milestone instead of setting it.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import {
  milestonePullRequest,
  type Milestone,
  type MilestonePort,
} from "../src/build/prMilestone.ts";

const dryRun = process.argv.includes("--dry-run");
const sweep = process.argv.includes("--sweep");

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const repo = env("GH_REPO");
const currentRelease = env("CURRENT_RELEASE");

const gh = (args: string[]): string =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
/** One JSON value per line, so paginated pages need no merging. */
const ghLines = (path: string, jq: string): unknown[] =>
  gh(["api", "--paginate", path, "--jq", jq])
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown);

const milestoneOf = (number: number): number | null => {
  const value = gh([
    "api",
    `repos/${repo}/issues/${number}`,
    "--jq",
    ".milestone.number // empty",
  ]).trim();
  return value === "" ? null : Number(value);
};

let open: Milestone[] | null = null;
const port: MilestonePort = {
  pullMilestone: milestoneOf,
  issueMilestone(issue) {
    try {
      return milestoneOf(issue);
    } catch {
      return null;
    }
  },
  openMilestones() {
    // @json keeps each object on one line; ghLines parses it back.
    open ??= ghLines(
      `repos/${repo}/milestones?state=open&per_page=100`,
      ".[] | {number, title} | @json",
    ) as Milestone[];
    return open;
  },
  setMilestone(pull, milestone) {
    if (dryRun) {
      console.log(`Would set #${pull} to milestone ${milestone}.`);
      return;
    }
    gh([
      "api",
      "-X",
      "PATCH",
      `repos/${repo}/issues/${pull}`,
      "-F",
      `milestone=${milestone}`,
      "--silent",
    ]);
  },
};

/** An open pull request with no milestone, as the issues API lists it. */
interface PullSummary {
  number: number;
  body: string | null;
}

const readPull = (number: number): PullSummary =>
  JSON.parse(
    gh([
      "api",
      `repos/${repo}/pulls/${number}`,
      "--jq",
      "{number, body} | @json",
    ]),
  ) as PullSummary;

const pulls: PullSummary[] = sweep
  ? // The issues endpoint lists pull requests too and filters by milestone.
    (ghLines(
      `repos/${repo}/issues?state=open&milestone=none&per_page=100`,
      ".[] | select(.pull_request != null) | {number, body} | @json",
    ) as PullSummary[])
  : [readPull(Number(env("PR")))];

if (sweep)
  console.log(`${pulls.length} open pull request(s) without a milestone.`);
// One pull request that fails (a GitHub error, a locked thread) must not
// stop the sweep from reaching the older ones, so each is tried on its own
// and the run fails at the end.
let failed = 0;
for (const pull of pulls) {
  try {
    if (!Number.isInteger(pull.number) || pull.number <= 0)
      throw new Error("PR is not a pull request number");
    const outcome = milestonePullRequest(
      { number: pull.number, body: pull.body ?? "" },
      currentRelease,
      port,
    );
    console.log(
      outcome.set === null
        ? `Nothing to do: ${outcome.reason}.`
        : `${outcome.reason}; set.`,
    );
  } catch (error) {
    failed += 1;
    console.log(`::error::#${pull.number}: ${(error as Error).message}`);
  }
}
if (failed > 0) process.exitCode = 1;
