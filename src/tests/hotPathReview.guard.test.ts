import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./guardFiles";

/**
 * The hot-path complexity checklist (`docs/performance/hot-path-review.md`) is
 * applied through hooks that fail quietly: the review skills read it through
 * the team overrides in `_bmad/custom/`, and the resolver drops a malformed
 * override with a warning and exit 0. This guard keeps the page's numbered
 * sections, items and section 1 paths, the clauses of sections 6 and 7 the
 * overrides rely on, the overrides themselves (each fact with the words that
 * make it bite), the skill step anchors the overrides name, and the summaries'
 * links to the page in step, so a rename or a TOML typo fails here instead of
 * silently removing the Hot-Path Auditor from every review. For the summaries
 * it checks the link only, never their wording.
 */

const PAGE = "docs/performance/hot-path-review.md";
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");
/** A TOML file without its comment lines, so a cite or a step name in a comment counts for nothing. */
const readToml = (rel: string) =>
  read(rel)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
const flat = (text: string) => text.replace(/\s+/g, " ");

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

/** Clauses of the page that the overrides and summaries lean on; rewording one must be deliberate. */
const PAGE_CLAUSES = [
  "cannot give a GO or a CONDITIONAL GO on it",
  "the record goes on it as a comment",
  "A finding is never dismissed for being pre-existing",
  "Two kinds are always `patch`",
  "it is `decision_needed` until the owner answers",
];

const SKILL_ROOTS = [".claude/skills", ".agents/skills"];

/** Each overridden skill, where its step files live, the facts its override
 *  must carry with the words each fact needs, and the text each step file must
 *  still contain for the facts that name it to make sense. */
const SKILLS = [
  ...["gds-code-review", "bmad-code-review"].map((name) => ({
    name,
    twin: name.startsWith("gds") ? "bmad-code-review" : "gds-code-review",
    stepDir: "steps",
    facts: {
      "Hot-path gate:": ["{diff_output}", "CHECKPOINT", "Hot-Path Auditor"],
      "Hot-Path Auditor layer:": ["{failed_layers}", "counts as a failed layer"],
      "Hot-path triage:": [
        "{failed_layers}",
        "clean review",
        "never dismissed for being pre-existing",
        "always patch is patch",
        "decision_needed",
      ],
      "Hot-path record:": ["{failed_layers}", "as a comment"],
    } as Record<string, string[]>,
    anchors: {
      "step-01-gather-context.md": ["CHECKPOINT", "{diff_output}"],
      "step-02-review.md": ["{failed_layers}"],
      "step-03-triage.md": ["{failed_layers}", "Clean review", "decision_needed"],
      "step-04-present.md": ["## On Complete"],
    } as Record<string, string[]>,
    review: true,
  })),
  ...["gds-quick-dev", "bmad-quick-dev"].map((name) => ({
    name,
    twin: name.startsWith("gds") ? "bmad-quick-dev" : "gds-quick-dev",
    stepDir: "",
    facts: {
      "Hot-path review:": ["never reject", "step-04-review.md", "step-oneshot.md", "always patch"],
    } as Record<string, string[]>,
    anchors: {
      "step-04-review.md": ["### Classify", "**reject**", "**intent_gap**"],
      "step-oneshot.md": ["### Classify", "**reject**"],
    } as Record<string, string[]>,
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

/** The body of a `## Heading` section, up to the next level-two heading. */
function sectionOf(text: string, heading: string): string | undefined {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** Whether a section 1 path exists; a `*` in the last segment needs one match. */
function pathExists(rel: string): boolean {
  if (!rel.includes("*")) return existsSync(join(repoRoot, rel));
  const dir = dirname(rel);
  const base = rel.slice(dir.length + 1);
  const pattern = new RegExp(`^${base.replace(/[.]/g, "\\.").replace(/\*/g, "[^/]*")}$`);
  return readdirSync(join(repoRoot, dir)).some((name) => pattern.test(name));
}

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

  it("keeps the clauses of sections 6 and 7 the overrides rely on", () => {
    const text = flat(page);
    const missing = PAGE_CLAUSES.filter((clause) => !text.includes(clause));
    expect(missing).toEqual([]);
  });

  it("lists only section 1 paths that exist", () => {
    const table = sectionOf(page, "## 1. When it applies") ?? "";
    const rows = table
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| Surface") && !line.startsWith("| ---"));
    expect(rows.length).toBeGreaterThan(0);
    // Code spans that hold a path (a slash or an extension); `GameApp` and the like are names.
    const paths = rows
      .flatMap((row) => [...row.split("|")[2].matchAll(/`([^`\s]+)`/g)].map((m) => m[1]))
      .filter((span) => span.includes("/") || /\.\w+$/.test(span));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((rel) => !pathExists(rel))).toEqual([]);
  });

  it("keeps the Hot-Path Auditor prompt the overrides launch", () => {
    const quote = flat(
      lines
        .filter((line) => line.startsWith(">"))
        .map((line) => line.replace(/^>\s?/, ""))
        .join(" "),
    );
    expect(quote).toContain("You are the Hot-Path Auditor.");
    expect(quote).toContain("Output the section 6 table with a row for every item");
  });

  for (const skill of SKILLS) {
    it(`${skill.name} override carries its facts and names step anchors that exist`, () => {
      const toml = readToml(`_bmad/custom/${skill.name}.toml`);
      for (const [fact, words] of Object.entries(skill.facts)) {
        const line = toml.split("\n").find((l) => l.trimStart().startsWith(`"${fact}`));
        expect(line, fact).toBeDefined();
        for (const word of words) expect(line, `${fact} ${word}`).toContain(word);
      }
      if (skill.review) expect(toml).toContain(`file:{project-root}/${PAGE}`);

      // The gds and bmad copies differ only in the skill's name.
      const twin = readToml(`_bmad/custom/${skill.twin}.toml`);
      expect(toml.split(skill.name).join("SKILL")).toBe(twin.split(skill.twin).join("SKILL"));

      // Every "section N (Name)" the override cites matches a heading on the page.
      const cites = [...toml.matchAll(/section (\d+) \(([^)]+)\)/g)];
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
        for (const fact of Object.keys(skill.facts)) {
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

  it("keeps the link inside AGENTS.md's Review guidelines and the template's Complexity section", () => {
    expect(sectionOf(read("AGENTS.md"), "## Review guidelines"), "AGENTS.md ## Review guidelines").toContain(PAGE);
    expect(sectionOf(read(".github/PULL_REQUEST_TEMPLATE.md"), "## Complexity"), "template ## Complexity").toContain(
      PAGE,
    );
  });
});
