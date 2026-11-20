/**
 * Gives a pull request a milestone (`scripts/pr-milestone.ts`, run by
 * `.github/workflows/pr-milestone.yml`), like every issue has one (see "How
 * items flow" in `_bmad-output/implementation-artifacts/backlog.md`).
 *
 * A pull request takes the open milestone of the first issue it closes
 * ("Closes #123" and the other closing words in its description). One that
 * closes no issue, or only issues in Triage, Backlog or a closed milestone,
 * goes to the current release milestone. It never assigns a closed milestone,
 * never overwrites a milestone a person set, and reads the live state again
 * right before writing, since GitHub has no compare-and-set.
 */

export interface Milestone {
  number: number;
  title: string;
}

/** What the rules need from GitHub. */
export interface MilestonePort {
  /** The milestone number the pull request has now, or null. */
  pullMilestone(pull: number): number | null;
  /**
   * The milestone number of an issue the pull request closes, or null when
   * it has none or cannot be read (moved to another repository, deleted).
   */
  issueMilestone(issue: number): number | null;
  /** Every open milestone. */
  openMilestones(): Milestone[];
  setMilestone(pull: number, milestone: number): void;
}

export interface MilestoneOutcome {
  /** The milestone set, or null when nothing was written. */
  set: number | null;
  reason: string;
}

/** Milestones a pull request never inherits from the issue it closes. */
const HOLDING: ReadonlySet<string> = new Set(["Triage", "Backlog"]);

/** At most this many closed issues are looked up per pull request. */
export const MAX_CLOSED_ISSUES = 20;

/**
 * The issues a description closes, in order, each once: "closes #1",
 * "Fixes: #2", "resolved #3" and the other forms GitHub links.
 */
export function closedIssueNumbers(body: string): number[] {
  const found: number[] = [];
  const closing = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[: ]+#(\d+)/gi;
  for (const match of body.matchAll(closing)) {
    const number = Number(match[1]);
    if (!found.includes(number)) found.push(number);
    if (found.length === MAX_CLOSED_ISSUES) break;
  }
  return found;
}

export function milestonePullRequest(
  pull: { number: number; body: string },
  currentRelease: string,
  port: MilestonePort,
): MilestoneOutcome {
  const existing = port.pullMilestone(pull.number);
  if (existing !== null)
    return {
      set: null,
      reason: `#${pull.number} already has milestone ${existing}`,
    };

  const open = port.openMilestones();
  const titleOf = (number: number | null): string | undefined => open.find((m) => m.number === number)?.title;

  let target: number | null = null;
  let reason = "";
  for (const issue of closedIssueNumbers(pull.body)) {
    const milestone = port.issueMilestone(issue);
    const title = titleOf(milestone);
    if (milestone !== null && title !== undefined && !HOLDING.has(title)) {
      target = milestone;
      reason = `#${pull.number} closes #${issue}, milestone ${milestone} (${title})`;
      break;
    }
  }
  if (target === null) {
    const current = open.find((m) => m.title === currentRelease);
    if (!current)
      throw new Error(
        `CURRENT_RELEASE '${currentRelease}' is not an open milestone; update it in .github/workflows/pr-milestone.yml`,
      );
    target = current.number;
    reason = `#${pull.number} closes no issue with a milestone; using ${currentRelease} (${target})`;
  }

  const meanwhile = port.pullMilestone(pull.number);
  if (meanwhile !== null)
    return {
      set: null,
      reason: `#${pull.number} got milestone ${meanwhile} in the meantime`,
    };
  port.setMilestone(pull.number, target);
  return { set: target, reason };
}
