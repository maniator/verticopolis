import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { labelSyncArgs, parseLabelList } from "./labelList";

const LIST = `# A comment: with a colon.
labels:
  # --- type ---
  - name: bug
    color: "d73a4a"
    description: Something isn't working
  - name: closes with TS removal
    color: "5319e7"
    description: "Priority 1: work next"

# Manual alternative:
#   gh label create bug -c d73a4a -d "x" --force
`;

describe("parseLabelList", () => {
  it("reads each name, color and description, colors staying strings", () => {
    expect(parseLabelList(LIST)).toEqual([
      { name: "bug", color: "d73a4a", description: "Something isn't working" },
      {
        name: "closes with TS removal",
        color: "5319e7",
        description: "Priority 1: work next",
      },
    ]);
  });

  it("reads the same list with Windows line endings", () => {
    expect(parseLabelList(LIST.replace(/\n/g, "\r\n"))).toEqual(
      parseLabelList(LIST),
    );
  });

  it("refuses an entry without a six-digit color or a description", () => {
    expect(() =>
      parseLabelList(
        'labels:\n  - name: a\n    color: "red"\n    description: x\n',
      ),
    ).toThrow(/"a" \(line 2\)/);
    expect(() =>
      parseLabelList('labels:\n  - name: a\n    color: "aaaaaa"\n'),
    ).toThrow(/needs a quoted six-digit color and a description/);
  });

  it("refuses an entry it cannot read instead of skipping it", () => {
    const ok = '  - name: a\n    color: "aaaaaa"\n    description: x\n';
    for (const bad of [
      "  - name:",
      "  - name:   ",
      "  - title: b",
      "    - name: b",
    ])
      expect(() => parseLabelList(`labels:\n${ok}${bad}\n`)).toThrow(
        /line 5 starts an entry/,
      );
  });

  it("refuses a duplicate name and an empty list", () => {
    const one = '  - name: a\n    color: "aaaaaa"\n    description: x\n';
    expect(() => parseLabelList(`labels:\n${one}${one}`)).toThrow(
      /"a" is listed twice/,
    );
    expect(() => parseLabelList("labels:\n")).toThrow(/no labels found/);
  });

  it("reads the repository's list, every issue-form label included", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const names = parseLabelList(
      readFileSync(resolve(root, ".github/labels.yml"), "utf8"),
    ).map((l) => l.name);
    expect(names).toEqual(
      expect.arrayContaining(["bug", "task", "needs-triage", "needs-form"]),
    );
  });
});

describe("labelSyncArgs", () => {
  it("creates or updates the label with its color and description", () => {
    expect(
      labelSyncArgs({
        name: "good first issue",
        color: "7057ff",
        description: "Hi",
      }),
    ).toEqual([
      "label",
      "create",
      "good first issue",
      "--color",
      "7057ff",
      "--description",
      "Hi",
      "--force",
    ]);
  });
});
