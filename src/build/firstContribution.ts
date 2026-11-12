/**
 * Thanks a person on their first pull request or first issue in the
 * repository (`scripts/first-contribution.ts`, run by
 * `.github/workflows/first-contribution.yml`). The messages live in
 * `.github/welcome/` and point to CONTRIBUTING.md and the "good first issue"
 * and "help wanted" lists, so a new contributor can find more to work on.
 *
 * "First" means the author has no earlier pull request (or, for an issue, no
 * earlier issue) here, open or closed. Only lower numbers count, so a person
 * who opens two at once is welcomed on the first of them, never on neither.
 * Owners, members, collaborators and bots are never welcomed, and a thread
 * that already carries the marker line is never welcomed twice.
 */

export type ContributionKind = "pull request" | "issue";

/** The opening event, as the workflow reads it from the GitHub payload. */
export interface ContributionEvent {
  kind: ContributionKind;
  number: number;
  author: string;
  /** `user.type` on the payload: "User", "Bot" or "Organization". */
  authorType: string;
  /** `author_association` on the payload, such as OWNER or FIRST_TIME_CONTRIBUTOR. */
  association: string;
  /** `owner/name`, for the links in the message. */
  repo: string;
}

/** What the welcome needs from GitHub and the checkout. */
export interface WelcomePort {
  /** Numbers of every item of `kind` the author opened here, open or closed. */
  listAuthorNumbers(kind: ContributionKind, author: string): number[];
  /** The text of a message file in the checkout. */
  readMessage(path: string): string;
  /** The body of every comment already on the thread. */
  listCommentBodies(number: number): string[];
  postComment(number: number, body: string): void;
}

export interface WelcomeOutcome {
  posted: boolean;
  reason: string;
}

/** The first line of every message, which marks a thread as welcomed. */
export const WELCOME_MARKER = "<!-- first-contribution-welcome -->";

export const WELCOME_MESSAGES: Readonly<Record<ContributionKind, string>> = {
  "pull request": ".github/welcome/first-pr.md",
  issue: ".github/welcome/first-issue.md",
};

/** Associations that already belong to the project. */
const INSIDERS: ReadonlySet<string> = new Set([
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
]);

/** GitHub logins: letters, digits and single hyphens, up to 39 characters. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** Why this event gets no welcome before anything is looked up, or null. */
export function skipBeforeLookup(event: ContributionEvent): string | null {
  if (INSIDERS.has(event.association))
    return `${event.author} is ${event.association}`;
  if (event.authorType === "Bot" || event.author.endsWith("[bot]"))
    return `${event.author} is a bot`;
  if (!LOGIN.test(event.author)) return `unexpected login '${event.author}'`;
  return null;
}

/** The message with the author's login and the repository filled in. */
export function renderWelcome(
  template: string,
  author: string,
  repo: string,
): string {
  return template.split("{login}").join(author).split("{repo}").join(repo);
}

export function welcomeFirstContribution(
  event: ContributionEvent,
  port: WelcomePort,
): WelcomeOutcome {
  const skip = skipBeforeLookup(event);
  if (skip) return { posted: false, reason: skip };

  const earlier = port
    .listAuthorNumbers(event.kind, event.author)
    .filter((n) => n < event.number);
  if (earlier.length > 0) {
    return {
      posted: false,
      reason: `${event.author} has ${earlier.length} earlier ${event.kind}(s) here`,
    };
  }

  const template = port.readMessage(WELCOME_MESSAGES[event.kind]);
  const marker = template.split("\n")[0];
  if (marker !== WELCOME_MARKER) {
    throw new Error(
      `${WELCOME_MESSAGES[event.kind]} must start with ${WELCOME_MARKER}`,
    );
  }
  const welcomed = port
    .listCommentBodies(event.number)
    .some((body) => body.split(/\r?\n/).includes(marker));
  if (welcomed)
    return {
      posted: false,
      reason: `#${event.number} already has the welcome`,
    };

  port.postComment(
    event.number,
    renderWelcome(template, event.author, event.repo),
  );
  return {
    posted: true,
    reason: `welcomed ${event.author} on their first ${event.kind}, #${event.number}`,
  };
}
