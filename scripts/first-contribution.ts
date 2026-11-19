/**
 * Thanks a person on their first pull request or first issue
 * (`.github/workflows/first-contribution.yml`). The rules are in
 * `src/build/firstContribution.ts`; this file only connects them to GitHub
 * through `gh` and to the message files in the checkout.
 *
 *   node scripts/first-contribution.ts [--dry-run]
 *   node scripts/first-contribution.ts --sweep [--dry-run]
 *
 * For an opened issue, the event comes from environment variables the
 * workflow sets from the payload (EVENT, NUMBER, AUTHOR, AUTHOR_TYPE,
 * ASSOCIATION, GH_REPO), never from the command line. `--sweep` instead reads
 * every open pull request opened in the last few days from the pulls API and
 * runs the same rules on each: a first-time contributor's pull request comes
 * from a fork, whose `pull_request` run gets no token that can comment, so
 * the workflow sweeps hourly from main instead. `gh` is called with an
 * argument list, never through a shell. `--dry-run` prints the comment
 * instead of posting it.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contributionKind,
  isRecent,
  welcomeFirstContribution,
  type ContributionEvent,
  type ContributionKind,
  type WelcomePort,
} from "../src/build/firstContribution.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const sweep = process.argv.includes("--sweep");

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const repo = env("GH_REPO");

const gh = (args: string[]): string =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
/** One JSON value per line, so paginated pages need no merging. */
const ghLines = (path: string, jq: string): unknown[] =>
  gh(["api", "--paginate", path, "--jq", jq])
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown);

const port: WelcomePort = {
  listAuthorNumbers(kind: ContributionKind, author: string) {
    const which = kind === "pull request" ? "!= null" : "== null";
    return ghLines(
      `repos/${repo}/issues?state=all&creator=${author}&per_page=100`,
      `.[] | select(.pull_request ${which}) | .number`,
    ) as number[];
  },
  readMessage: (path) => readFileSync(resolve(root, path), "utf8"),
  // @json keeps each body on one line; ghLines parses it back to the text.
  listCommentBodies: (number) =>
    ghLines(
      `repos/${repo}/issues/${number}/comments?per_page=100`,
      ".[] | .body | @json",
    ) as string[],
  postComment(number, body) {
    if (dryRun) {
      console.log(`Would post on #${number}:\n${body}`);
      return;
    }
    gh([
      "api",
      "-X",
      "POST",
      `repos/${repo}/issues/${number}/comments`,
      "-f",
      `body=${body}`,
      "--silent",
    ]);
  },
};

/** One open pull request as the pulls API lists it. */
interface PullSummary {
  number: number;
  created_at: string;
  author_association: string;
  user: { login: string; type: string };
}

const events: ContributionEvent[] = sweep
  ? // @json keeps each object on one line; ghLines parses it back.
    (
      ghLines(
        `repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=100`,
        ".[] | {number, created_at, author_association, user: {login: .user.login, type: .user.type}} | @json",
      ) as PullSummary[]
    )
      .filter((pull) => isRecent(pull.created_at, Date.now()))
      .map((pull) => ({
        kind: "pull request",
        number: pull.number,
        author: pull.user.login,
        authorType: pull.user.type,
        association: pull.author_association,
        repo,
      }))
  : [
      {
        kind: contributionKind(env("EVENT")),
        number: Number(env("NUMBER")),
        author: env("AUTHOR"),
        authorType: env("AUTHOR_TYPE"),
        association: env("ASSOCIATION"),
        repo,
      },
    ];

if (sweep)
  console.log(`${events.length} pull request(s) opened in the sweep window.`);
for (const event of events) {
  if (!Number.isInteger(event.number) || event.number <= 0)
    throw new Error(`NUMBER is not an issue number`);
  const outcome = welcomeFirstContribution(event, port);
  console.log(
    outcome.posted
      ? `${outcome.reason[0].toUpperCase()}${outcome.reason.slice(1)}.`
      : `No welcome for #${event.number}: ${outcome.reason}.`,
  );
}
