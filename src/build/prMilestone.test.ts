import { describe, expect, it, vi } from "vitest";
import {
  MAX_CLOSED_ISSUES,
  closedIssueNumbers,
  milestonePullRequest,
  type Milestone,
  type MilestonePort,
} from "./prMilestone";

const OPEN: Milestone[] = [
  { number: 7, title: "5.x" },
  { number: 3, title: "Triage" },
  { number: 4, title: "Backlog" },
  { number: 9, title: "5.1.0" },
];

function port(
  answers: {
    pull?: (number | null)[];
    issues?: Record<number, number | null>;
    open?: Milestone[];
  } = {},
) {
  const pullAnswers = [...(answers.pull ?? [null, null])];
  return {
    pullMilestone: vi.fn<MilestonePort["pullMilestone"]>(
      () => pullAnswers.shift() ?? null,
    ),
    issueMilestone: vi.fn<MilestonePort["issueMilestone"]>(
      (issue) => answers.issues?.[issue] ?? null,
    ),
    openMilestones: vi.fn<MilestonePort["openMilestones"]>(
      () => answers.open ?? OPEN,
    ),
    setMilestone: vi.fn<MilestonePort["setMilestone"]>(),
  };
}

describe("closedIssueNumbers", () => {
  it("reads every closing word GitHub links, once each, in order", () => {
    expect(
      closedIssueNumbers(
        "Closes #12, fixes: #3 and Resolved #44.\nclose #12 again; fixed #5, resolves #6",
      ),
    ).toEqual([12, 3, 44, 5, 6]);
  });

  it("ignores a bare reference and a word that only contains a closing word", () => {
    expect(closedIssueNumbers("See #12. Enclosed #13. Prefixes #14")).toEqual(
      [],
    );
  });

  it("stops after the cap", () => {
    const body = Array.from({ length: 30 }, (_, i) => `closes #${i + 1}`).join(
      " ",
    );
    expect(closedIssueNumbers(body)).toHaveLength(MAX_CLOSED_ISSUES);
  });
});

describe("milestonePullRequest", () => {
  it("leaves a pull request that already has a milestone alone", () => {
    const p = port({ pull: [9] });
    const outcome = milestonePullRequest(
      { number: 10, body: "closes #1" },
      "5.x",
      p,
    );
    expect(outcome.set).toBeNull();
    expect(p.issueMilestone).not.toHaveBeenCalled();
    expect(p.setMilestone).not.toHaveBeenCalled();
  });

  it("takes the open milestone of the first closed issue that has a real one", () => {
    const p = port({ issues: { 1: 3, 2: 99, 5: 9 } });
    const outcome = milestonePullRequest(
      { number: 10, body: "closes #1, fixes #2, resolves #5" },
      "5.x",
      p,
    );
    // #1 sits in Triage and #2's milestone is closed (not in the open list).
    expect(outcome.set).toBe(9);
    expect(p.setMilestone).toHaveBeenCalledWith(10, 9);
    expect(outcome.reason).toContain("closes #5");
  });

  it("falls back to the current release when no closed issue has a usable milestone", () => {
    const p = port({ issues: { 1: 4 } });
    const outcome = milestonePullRequest(
      { number: 10, body: "closes #1, closes #2" },
      "5.x",
      p,
    );
    expect(outcome.set).toBe(7);
    expect(p.setMilestone).toHaveBeenCalledWith(10, 7);
  });

  it("fails when the current release is not an open milestone", () => {
    const p = port();
    expect(() =>
      milestonePullRequest({ number: 10, body: "" }, "4.x", p),
    ).toThrow("CURRENT_RELEASE '4.x'");
    expect(p.setMilestone).not.toHaveBeenCalled();
  });

  it("does not overwrite a milestone a person set while it was looking", () => {
    const p = port({ pull: [null, 9] });
    const outcome = milestonePullRequest({ number: 10, body: "" }, "5.x", p);
    expect(outcome.set).toBeNull();
    expect(outcome.reason).toContain("in the meantime");
    expect(p.setMilestone).not.toHaveBeenCalled();
  });
});
