import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FORMS_DATE,
  demoteFieldHeadings,
  hasFormLayout,
  modeFromLabels,
  reshapeIssueBody,
} from "./issueBackfill";
import {
  NO_RESPONSE,
  answers,
  checkIssueBody,
  parseIssueForm,
} from "./issueForms";

const FORM_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.github/ISSUE_TEMPLATE",
);
const form = (stem: string) =>
  parseIssueForm(readFileSync(resolve(FORM_DIR, `${stem}.yml`), "utf8"));
const bug = form("bug_report");
const feature = form("feature_request");
const task = form("task");

const ORIGINAL = [
  "Deferred from the review of #1948.",
  "",
  "### Details",
  "",
  "```md",
  "### kept inside a fence",
  "```",
  "",
  "- a list item",
].join("\n");

describe("reshapeIssueBody", () => {
  it("puts the whole original under the first required text field", () => {
    const out = reshapeIssueBody(ORIGINAL, ["bug", "P2"], bug);
    const got = answers(out);
    expect(got.get("What happened?")).toBe(demoteFieldHeadings(ORIGINAL));
    for (const line of ORIGINAL.split("\n").filter((l) => l.trim()))
      expect(out).toContain(line.replace(/^### Details$/, "#### Details"));
  });

  it("gives every field its heading, n/a for required ones and no response for the rest", () => {
    const got = answers(reshapeIssueBody(ORIGINAL, ["bug"], bug));
    const na = `n/a: filed before the issue forms (${FORMS_DATE}). The original report is under "What happened?".`;
    expect(got.get("Build version")).toBe(na);
    expect(got.get("Browser")).toBe(na);
    expect(got.get("Console errors")).toBe(NO_RESPONSE);
    expect(got.get("Before submitting")).toBe(NO_RESPONSE);
    expect(got.get("Game mode")).toBe(NO_RESPONSE);
  });

  it("passes the form check except for the checkboxes nobody ticked", () => {
    for (const [f, labels] of [
      [bug, ["bug"]],
      [feature, ["enhancement"]],
      [task, ["chore"]],
    ] as const) {
      const problems = checkIssueBody(
        reshapeIssueBody(ORIGINAL, [...labels], f),
        f,
      );
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.every((p) => p.includes("does not tick"))).toBe(true);
    }
  });

  it("answers a game-mode dropdown from the mode labels", () => {
    const pick = (labels: string[]) =>
      answers(reshapeIssueBody("x", labels, feature)).get(
        "Which game mode should this target?",
      );
    expect(pick(["enhancement", "modern"])).toMatch(/^Modern: /);
    expect(pick(["enhancement", "classic"])).toMatch(/^Classic: /);
    expect(pick(["enhancement", "classic", "modern"])).toBe(
      "Both / mode-agnostic",
    );
    expect(pick(["enhancement"])).toMatch(/^n\/a: filed before/);
    expect(
      answers(reshapeIssueBody("x", ["bug", "classic"], bug)).get("Game mode"),
    ).toBe("Classic");
  });

  it("marks an empty original as n/a instead of leaving the field blank", () => {
    expect(
      answers(reshapeIssueBody("  ", ["task"], task)).get("What and why"),
    ).toMatch(/^n\/a: filed before/);
  });

  it("leaves a reshaped body alone on a second run", () => {
    expect(hasFormLayout(ORIGINAL, bug)).toBe(false);
    expect(hasFormLayout(reshapeIssueBody(ORIGINAL, ["bug"], bug), bug)).toBe(
      true,
    );
  });
});

describe("modeFromLabels", () => {
  it("finds no choice for a dropdown without mode options", () => {
    expect(
      modeFromLabels(["classic"], ["Desktop", "Mobile / tablet"]),
    ).toBeUndefined();
  });
});
