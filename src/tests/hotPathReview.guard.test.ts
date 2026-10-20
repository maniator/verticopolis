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
 * sections and items, the overrides that cite them, the skill step anchors the
 * overrides name, and the summaries that point to the page in step, so a
 * rename or a TOML typo fails here instead of silently removing the Hot-Path
 * Auditor from every review.
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
  "## 8. Worked example: what the Rust port shipped",
  "## 9. How the review tools apply it",
];

const SKILL_ROOTS = [".claude/skills", ".agents/skills"];

/** Each overridden skill, where its step files live, the facts its override
 *  must carry, and the text each step file must still contain for the facts
 *  that name it to make sense. */
const SKILLS = [
  ...["gds-code-review", "bmad-code-review"].map((name) => ({
    name,
    stepDir: "steps",
    facts: ["Hot-path gate:", "Hot-Path Auditor layer:", "Hot-path triage:", "Hot-path record:"],
    anchors: {
      "step-01-gather-context.md": ["CHECKPOINT", "{diff_output}"],
      "step-02-review.md": ["{failed_layers}"],
      "step-03-triage.md": ["{failed_layers}", "Clean review"],
      "step-04-present.md": ["## On Complete"],
    } as Record<string, string[]>,
    review: true,
  })),
  ...["gds-quick-dev", "bmad-quick-dev"].map((name) => ({
    name,
    stepDir: "",
    facts: ["Hot-path review:"],
    anchors: { "step-04-review.md": ["### Classify", "**reject**"] } as Record<string, string[]>,
    review: false,
  })),
];

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
  const lines = page.split("\n");

  it("keeps the numbered sections the overrides and summaries cite", () => {
    const missing = SECTIONS.filter((h) => !lines.includes(h));
    expect(missing).toEqual([]);
  });

  it("keeps items HP-1 to HP-12, each once, a record row for each, and no others", () => {
    for (let n = 1; n <= 12; n++) {
      const item = new RegExp(`^\\*\\*HP-${n} `, "gm");
      expect(page.match(item)?.length, `HP-${n} heading`).toBe(1);
      expect(page.includes(`| HP-${n} |`), `HP-${n} record row`).toBe(true);
    }
    expect(page.match(/^\*\*HP-\d+ /gm)?.length).toBe(12);
  });

  it("keeps the Hot-Path Auditor prompt the overrides launch", () => {
    expect(page).toContain("> You are the Hot-Path Auditor.");
    expect(page).toContain("Output the section 6 table with a row for every item");
  });

  for (const skill of SKILLS) {
    it(`${skill.name} override carries its facts and names step anchors that exist`, () => {
      const toml = read(`_bmad/custom/${skill.name}.toml`);
      for (const fact of skill.facts) expect(toml, fact).toContain(`"${fact}`);
      if (skill.review) expect(toml).toContain(`file:{project-root}/${PAGE}`);

      // Every "section N (Name)" the override cites matches a heading on the page.
      const cites = [...toml.matchAll(/section (\d) \(([^)]+)\)/g)];
      expect(cites.length).toBeGreaterThan(0);
      for (const [, n, name] of cites) {
        expect(lines, `section ${n} (${name})`).toContain(`## ${n}. ${name}`);
      }

      const steps = [...new Set([...toml.matchAll(/(step-[\w-]+\.md)/g)].map((m) => m[1]))];
      expect(steps.sort()).toEqual(Object.keys(skill.anchors).sort());
      for (const root of SKILL_ROOTS) {
        for (const step of steps) {
          const path = join(root, skill.name, skill.stepDir, step);
          expect(existsSync(join(repoRoot, path)), path).toBe(true);
          const text = read(path);
          for (const anchor of skill.anchors[step]) expect(text, `${path}: ${anchor}`).toContain(anchor);
        }
      }
    });
  }

  // CI must run the resolver; a machine without Python 3.11+ (tomllib) skips locally.
  const python = spawnSync("python3", ["-c", "import tomllib"], { encoding: "utf8" });
  it.skipIf(python.status !== 0 && !process.env.CI)("the resolver merges every override over the base facts", () => {
    for (const skill of SKILLS) {
      for (const root of SKILL_ROOTS) {
        const out = spawnSync(
          "python3",
          ["_bmad/scripts/resolve_customization.py", "--skill", join(root, skill.name), "--key", "workflow"],
          { cwd: repoRoot, encoding: "utf8" },
        );
        expect(out.status, out.stderr).toBe(0);
        const workflow = JSON.parse(out.stdout).workflow as {
          persistent_facts: string[];
          activation_steps_append: string[];
          on_complete: string;
        };
        expect(workflow.persistent_facts).toContain("file:{project-root}/**/project-context.md");
        for (const fact of skill.facts) {
          expect(workflow.persistent_facts.some((f) => f.startsWith(fact)), `${root}/${skill.name}: ${fact}`).toBe(true);
        }
        if (!skill.review) continue;
        expect(workflow.persistent_facts).toContain(`file:{project-root}/${PAGE}`);
        expect(workflow.activation_steps_append.some((s) => s.includes(PAGE))).toBe(true);
        expect(workflow.on_complete).toContain(PAGE);
      }
    }
  });

  it("every summary points to the page", () => {
    const missing = SUMMARIES.filter((rel) => !read(rel).includes(PAGE));
    expect(missing).toEqual([]);
  });
});
