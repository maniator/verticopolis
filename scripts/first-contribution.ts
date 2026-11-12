/**
 * Thanks a person on their first pull request or first issue
 * (`.github/workflows/first-contribution.yml`). The rules are in
 * `src/build/firstContribution.ts`; this file only connects them to GitHub
 * through `gh` and to the message files in the checkout.
 *
 *   node scripts/first-contribution.ts [--dry-run]
 *
 * The event comes from environment variables the workflow sets from the
 * payload (EVENT, NUMBER, AUTHOR, AUTHOR_TYPE, ASSOCIATION, GH_REPO), never
 * from the command line. `gh` is called with an argument list, never through
 * a shell. `--dry-run` prints the comment instead of posting it.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  welcomeFirstContribution,
  type ContributionEvent,
  type ContributionKind,
  type WelcomePort,
} from "../src/build/firstContribution.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const repo = env("GH_REPO");
const event: ContributionEvent = {
  kind: env("EVENT") === "pull_request_target" ? "pull request" : "issue",
  number: Number(env("NUMBER")),
  author: env("AUTHOR"),
  authorType: env("AUTHOR_TYPE"),
  association: env("ASSOCIATION"),
  repo,
};
if (!Number.isInteger(event.number) || event.number <= 0)
  throw new Error(`NUMBER is not an issue number`);

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

const outcome = welcomeFirstContribution(event, port);
console.log(
  outcome.posted
    ? `${outcome.reason[0].toUpperCase()}${outcome.reason.slice(1)}.`
    : `No welcome: ${outcome.reason}.`,
);
