import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NO_RESPONSE,
  TASK_TYPE_LABELS,
  answers,
  checkIssueBody,
  formForLabels,
  parseIssueForm,
  type IssueForm,
} from "./issueForms";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FORM_DIR = resolve(root, ".github/ISSUE_TEMPLATE");
const realForms = readdirSync(FORM_DIR)
  .filter((f) => f.endsWith(".yml") && f !== "config.yml")
  .map((f) => ({ file: f, text: readFileSync(resolve(FORM_DIR, f), "utf8") }));

const FORM = `name: 🧪 Sample
description: A sample form.
labels: ["bug", "needs-triage"]
body:
  - type: markdown
    attributes:
      value: |
        Intro text: with a colon.
  - type: input
    id: version
    attributes:
      label: Build version
      description: >-
        Folded text
        over two lines.
      placeholder: "v1"
    validations:
      required: true
  - type: textarea
    id: notes
    attributes:
      label: "Anything else?"
  - type: dropdown
    id: mode
    attributes:
      label: Game mode
      options:
        - Classic
        - Modern
    validations:
      required: true
  - type: checkboxes
    id: checks
    attributes:
      label: Before submitting
      options:
        - label: I tried the live build.
        - label: I searched existing issues.
          required: true
`;

const sample = parseIssueForm(FORM);

const body = (parts: Record<string, string | undefined>): string =>
  Object.entries(parts)
    .filter(([, text]) => text !== undefined)
    .map(([heading, text]) => `### ${heading}\n\n${text}`)
    .join("\n\n");

const filled = (overrides: Record<string, string | undefined> = {}): string =>
  body({
    "Build version": "v1.2.3",
    "Anything else?": NO_RESPONSE,
    "Game mode": "Classic",
    "Before submitting":
      "- [ ] I tried the live build.\n- [X] I searched existing issues.",
    ...overrides,
  });

describe("parseIssueForm", () => {
  it("reads the name, labels and every field", () => {
    expect(sample.name).toBe("🧪 Sample");
    expect(sample.labels).toEqual(["bug", "needs-triage"]);
    expect(
      sample.fields.map((f) => [
        f.type,
        f.id,
        f.label,
        f.required,
        f.requiredOptions,
      ]),
    ).toEqual([
      ["markdown", "", "", false, []],
      ["input", "version", "Build version", true, []],
      ["textarea", "notes", "Anything else?", false, []],
      ["dropdown", "mode", "Game mode", true, []],
      [
        "checkboxes",
        "checks",
        "Before submitting",
        false,
        ["I searched existing issues."],
      ],
    ]);
  });

  it("throws on a form it cannot read", () => {
    expect(() => parseIssueForm("name: Empty\nlabels: []\nbody:\n")).toThrow(
      /cannot read/,
    );
    expect(() =>
      parseIssueForm(
        "name: X\nbody:\n  - type: input\n    id: a\n    attributes:\n      description: no label\n",
      ),
    ).toThrow(/without a label/);
  });

  it.each(realForms)(
    "reads $file with labels and labeled fields",
    ({ text }) => {
      const form = parseIssueForm(text);
      expect(form.labels.length).toBeGreaterThan(0);
      const asked = form.fields.filter((f) => f.type !== "markdown");
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((f) => f.label.length > 0 && f.id.length > 0)).toBe(
        true,
      );
    },
  );
});

describe("answers", () => {
  it("keys each answer by its ### heading and skips headings in code fences", () => {
    const got = answers(
      "### One\n\nfirst\n\n```\n### Not a field\n```\n\n### Two\n\nsecond",
    );
    expect([...got.keys()]).toEqual(["One", "Two"]);
    expect(got.get("One")).toContain("### Not a field");
    expect(got.get("Two")).toBe("second");
  });
});

describe("checkIssueBody", () => {
  it("passes a body written from the form", () => {
    expect(checkIssueBody(filled(), sample)).toEqual([]);
  });

  it("passes the same body with Windows line endings", () => {
    expect(checkIssueBody(filled().replace(/\n/g, "\r\n"), sample)).toEqual([]);
  });

  it("names each missing section, optional ones included", () => {
    expect(
      checkIssueBody(
        filled({ "Game mode": undefined, "Anything else?": undefined }),
        sample,
      ),
    ).toEqual([
      'missing section "### Anything else?"',
      'missing section "### Game mode"',
    ]);
  });

  it("flags a required field left empty or with no response", () => {
    for (const empty of ["", NO_RESPONSE]) {
      expect(
        checkIssueBody(filled({ "Build version": empty }), sample),
      ).toEqual(['"### Build version" is required but has no answer']);
    }
  });

  it("flags a required checkbox left unticked", () => {
    const unticked =
      "- [x] I tried the live build.\n- [ ] I searched existing issues.";
    expect(
      checkIssueBody(filled({ "Before submitting": unticked }), sample),
    ).toEqual([
      '"### Before submitting" does not tick "- [x] I searched existing issues."',
    ]);
  });

  it("fails a free-form body with no form sections", () => {
    expect(
      checkIssueBody("Some notes about a bug.\n\n## Details\n\nMore.", sample),
    ).toHaveLength(4);
  });
});

describe("formForLabels", () => {
  const form = (name: string, labels: string[]): IssueForm => ({
    name,
    labels,
    fields: [],
  });
  const forms = [
    form("parity", ["parity", "classic", "needs-triage"]),
    form("bug", ["bug", "needs-triage"]),
    form("feature", ["enhancement", "needs-triage"]),
    form("task", ["task", "needs-triage"]),
  ];

  it("picks the first form in order whose type label the issue carries", () => {
    expect(formForLabels(["bug", "parity", "P2"], forms)?.name).toBe("parity");
    expect(formForLabels(["enhancement", "modern"], forms)?.name).toBe(
      "feature",
    );
  });

  it("files every internal-work label under the Task form", () => {
    for (const label of TASK_TYPE_LABELS)
      expect(formForLabels([label, "P3"], forms)?.name).toBe("task");
  });

  it("finds no form for an issue with no type label", () => {
    expect(formForLabels(["P3", "ui", "classic"], forms)).toBeUndefined();
  });
});
