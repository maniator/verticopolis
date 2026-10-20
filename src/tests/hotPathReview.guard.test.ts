import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./guardFiles";

/**
 * The hot-path complexity checklist (`docs/performance/hot-path-review.md`) is
 * applied through hooks that fail quietly: the review skills read it through
 * the team overrides in `_bmad/custom/`, and the resolver drops a malformed
 * override with a warning and exit 0. This guard keeps the page's numbered
 * sections and items, the overrides that cite them, and the summaries that
 * point to the page in step, so a rename or a TOML typo fails here instead of
 * silently removing the Hot-Path Auditor from every review.
 */

const PAGE = "docs/performance/hot-path-review.md";
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const SECTIONS = [
  "## 1. When it applies",
  "## 2. Frequencies and sizes",
  "## 3. The checklist",
  "## 4. Measuring",
  "## 5. The PR complexity note",
  "## 6. Recording the review",
  "## 7. Resolving a finding",
  "## 8. Worked example: the misses #1139 found",
  "## 9. How the review tools apply it",
];

const SKILLS = ["gds-code-review", "bmad-code-review"];
const SKILL_ROOTS = [".claude/skills", ".agents/skills"];

const SUMMARIES = [
  "CLAUDE.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "_bmad-output/project-context.md",
  ".github/copilot-instructions.md",
  ".github/skills/engine-parity-review/SKILL.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
];

describe("hot-path review guard", () => {
  const page = read(PAGE);

  it("keeps the numbered sections the overrides and summaries cite", () => {
    const missing = SECTIONS.filter((h) => !page.split("\n").includes(h));
    expect(missing).toEqual([]);
  });

  it("keeps items HP-1 to HP-12, each once, and a record row for each", () => {
    for (let n = 1; n <= 12; n++) {
      const item = new RegExp(`^\\*\\*HP-${n} `, "gm");
      expect(page.match(item)?.length, `HP-${n} heading`).toBe(1);
      expect(page.includes(`| HP-${n} |`), `HP-${n} record row`).toBe(true);
    }
  });

  for (const skill of SKILLS) {
    it(`${skill} override loads the page and names step files that exist`, () => {
      const toml = read(`_bmad/custom/${skill}.toml`);
      expect(toml).toContain(`file:{project-root}/${PAGE}`);
      const steps = [...toml.matchAll(/steps\/(step-[\w-]+\.md)/g)].map((m) => m[1]);
      expect(steps.length).toBeGreaterThan(0);
      for (const root of SKILL_ROOTS) {
        for (const step of steps) {
          expect(existsSync(join(repoRoot, root, skill, "steps", step)), `${root}/${skill}/steps/${step}`).toBe(true);
        }
      }
      for (const name of ["When it applies", "Resolving a finding"]) {
        expect(toml).toContain(name);
      }
    });
  }

  const python = spawnSync("python3", ["-c", "import tomllib"], { encoding: "utf8" });
  it.skipIf(python.status !== 0)("the resolver merges both overrides over the base facts", () => {
    for (const skill of SKILLS) {
      for (const root of SKILL_ROOTS) {
        const out = spawnSync(
          "python3",
          ["_bmad/scripts/resolve_customization.py", "--skill", join(root, skill), "--key", "workflow"],
          { cwd: repoRoot, encoding: "utf8" },
        );
        expect(out.status, out.stderr).toBe(0);
        const workflow = JSON.parse(out.stdout).workflow as {
          persistent_facts: string[];
          activation_steps_append: string[];
          on_complete: string;
        };
        expect(workflow.persistent_facts).toContain("file:{project-root}/**/project-context.md");
        expect(workflow.persistent_facts).toContain(`file:{project-root}/${PAGE}`);
        expect(workflow.persistent_facts.some((f) => f.startsWith("Hot-Path Auditor layer:"))).toBe(true);
        expect(workflow.activation_steps_append.length).toBeGreaterThan(0);
        expect(workflow.on_complete).toContain(PAGE);
      }
    }
  });

  it("every summary points to the page", () => {
    const missing = SUMMARIES.filter((rel) => !read(rel).includes(PAGE));
    expect(missing).toEqual([]);
  });
});
