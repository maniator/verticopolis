import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./guardFiles";
import { versionLine } from "../wasmhost/engineLabel";
import { IDENTITY_FIXTURE } from "../wasmhost/engineIdentity.fixture";

/**
 * The GitHub issue forms (`.github/ISSUE_TEMPLATE/`) are the first thing a
 * player reads when reporting a problem, so they must describe the game as it
 * ships. Since #1875 the Rust engine is the only engine: a form that still asks
 * which engine ran, or offers a TypeScript or fallback answer, sends a reporter
 * looking for something the game no longer shows. A form's labels must exist
 * in `.github/labels.yml`, or GitHub drops them silently and the issue misses
 * triage. The bug report's version placeholder must have the shape of the
 * version line the game draws (`versionLine`), so a reporter can match it.
 */

const TEMPLATE_DIR = resolve(repoRoot, ".github/ISSUE_TEMPLATE");
const forms = readdirSync(TEMPLATE_DIR)
  .filter((f) => f.endsWith(".yml") && f !== "config.yml")
  .map((f) => ({ name: f, text: readFileSync(resolve(TEMPLATE_DIR, f), "utf8") }));

/** Every `- name:` in labels.yml. */
const knownLabels = new Set(
  [...readFileSync(resolve(repoRoot, ".github/labels.yml"), "utf8").matchAll(/^\s*- name:\s*"?([^"\n]+?)"?\s*$/gm)].map((m) => m[1]),
);

/** The `labels: [...]` line of a form. */
function formLabels(text: string): string[] {
  const line = /^labels:\s*\[(.*)\]\s*$/m.exec(text);
  return line ? [...line[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
}

/** A version line with its numbers and hash reduced to placeholders, so two
 *  lines compare by shape. */
const shape = (line: string): string => line.replace(/\b[0-9a-f]{12}\b/g, "HASH").replace(/\d+/g, "N");

describe("issue form guard", () => {
  it("finds the issue forms", () => {
    expect(forms.map((f) => f.name)).toEqual(expect.arrayContaining(["bug_report.yml", "parity_report.yml"]));
  });

  it("reads the label list", () => {
    expect(knownLabels.has("bug")).toBe(true);
    expect(knownLabels.has("needs-triage")).toBe(true);
  });

  it.each(forms)("$name applies only labels that exist", ({ text }) => {
    const labels = formLabels(text);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((l) => !knownLabels.has(l))).toEqual([]);
  });

  it.each(forms)("$name names no TypeScript engine and no engine fallback (#1875)", ({ text }) => {
    expect(text).not.toMatch(/TypeScript/i);
    expect(text).not.toMatch(/\bfall(s|ing)? ?back\b|\bfell back\b/i);
  });

  it("the bug report asks no engine question, since there is one engine", () => {
    const bug = forms.find((f) => f.name === "bug_report.yml")!.text;
    expect(bug).not.toMatch(/^\s*id: engine\s*$/m);
  });

  it("the bug report's version placeholder has the shape of the game's version line", () => {
    const bug = forms.find((f) => f.name === "bug_report.yml")!.text;
    const placeholder = /id: version[\s\S]*?placeholder:\s*"([^"]+)"/.exec(bug)?.[1];
    expect(placeholder).toBeDefined();
    const drawn = versionLine("1.2.3", {
      __vcEngineBoot: {
        identity: JSON.stringify(IDENTITY_FIXTURE),
        binary: { state: "ok", sourceHash: "0123456789abcdef0123456789abcdef" },
      },
    });
    expect(shape(placeholder!)).toBe(shape(drawn));
  });
});
