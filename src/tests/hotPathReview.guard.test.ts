import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./guardFiles";
import {
  AUTO_MERGE,
  NOT_HOT,
  PAGE,
  PAGE_CLAUSES,
  PROMPT,
  SECTIONS,
  SKILL_HOOKS,
  SKILL_ROOTS,
  SKILLS,
  SUMMARIES,
  SURFACES,
} from "./hotPathReview.rules";

/**
 * The hot-path complexity checklist (`docs/performance/hot-path-review.md`) is
 * applied through hooks that fail quietly: the review skills read it through
 * the team overrides in `_bmad/custom/`, and the resolver drops a malformed
 * override with a warning and exit 0. This guard pins what those hooks lean
 * on, so a rename, a TOML typo, or a removed or reworded clause fails here
 * instead of silently weakening every review:
 *
 * - the page's numbered sections, items HP-1 to HP-12 with one record row
 *   each, the section 1 surfaces, their paths and the not-hot-path list, the
 *   clauses of sections 1, 3 to 7 and 9 that the overrides and summaries lean
 *   on, and the auditor prompt;
 * - each override fact once, inside `persistent_facts`, with its load-bearing
 *   phrases, plus `on_complete`, the activation step, no prepend step, the
 *   empty base `on_complete` it replaces, the gds and bmad copies identical,
 *   and the step-file text the facts name;
 * - the `CLAUDE.md` auto-merge rule.
 *
 * It checks phrases, so an added exception sentence passes it; catching that
 * is the review's job. For the other summaries it checks the link only.
 */

const read = (rel: string) =>
  readFileSync(join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");
/** A TOML file without its comment lines, so a cite or a step name in a comment counts for nothing. */
const readToml = (rel: string) =>
  read(rel)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
const flat = (text: string) => text.replace(/\s+/g, " ");

/** The body of a `## Heading` section, up to the next level-two heading. */
function sectionOf(text: string, heading: string): string | undefined {
  const lines = text.split("\n").map((line) => line.trimEnd());
  const start = lines.indexOf(heading);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** The code spans in a piece of Markdown, in order. */
const spans = (text: string) =>
  [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** Whether a repo path exists; `*` may stand for part of any segment. */
function pathExists(rel: string): boolean {
  const walk = (dir: string, parts: string[]): boolean => {
    if (parts.length === 0 || (parts.length === 1 && parts[0] === ""))
      return true;
    const [head, ...rest] = parts;
    if (!head.includes("*")) {
      const next = join(dir, head);
      return (
        existsSync(next) &&
        (rest.length === 0 || statSync(next).isDirectory()) &&
        walk(next, rest)
      );
    }
    const pattern = new RegExp(
      `^${head.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
    return readdirSync(dir).some(
      (name) => pattern.test(name) && walk(join(dir, name), rest),
    );
  };
  return walk(repoRoot, rel.split("/"));
}

/** The lines of a TOML array `key = [ ... ]`, without the brackets. */
function tomlArray(toml: string, key: string): string[] {
  const lines = toml.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${key} = [`);
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && line.trim() === "]");
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .map((line) => line.trim());
}

describe("hot-path review guard", () => {
  const page = read(PAGE);
  const lines = page.split("\n").map((line) => line.trimEnd());

  it("keeps the numbered sections the overrides and summaries cite", () => {
    expect(SECTIONS.filter((h) => !lines.includes(h))).toEqual([]);
  });

  it("keeps items HP-1 to HP-12, each once, a record row for each, and no others", () => {
    const record = sectionOf(page, "## 6. Recording the review") ?? "";
    for (let n = 1; n <= 12; n++) {
      const item = new RegExp(`^\\*\\*HP-${n} `, "gm");
      expect(page.match(item)?.length, `HP-${n} heading`).toBe(1);
      const row = new RegExp(`^\\| HP-${n} \\|`, "gm");
      expect(record.match(row)?.length, `HP-${n} record row`).toBe(1);
    }
    expect(page.match(/^\*\*HP-\d+ /gm)?.length).toBe(12);
    expect(record.match(/^\| HP-\d+ \|/gm)?.length).toBe(12);
  });

  it("keeps the clauses the overrides rely on, each under its own heading", () => {
    for (const [heading, clauses] of Object.entries(PAGE_CLAUSES)) {
      const text = flat(sectionOf(page, heading) ?? "");
      expect(
        clauses.filter((clause) => !text.includes(clause)),
        heading,
      ).toEqual([]);
    }
  });

  it("keeps section 1's surfaces, their paths and the not-hot-path list, and every path exists", () => {
    const section = sectionOf(page, "## 1. When it applies") ?? "";
    const rows = section
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("| ") &&
          !line.startsWith("| Surface") &&
          !line.startsWith("| ---"),
      )
      .map((line) => line.split("|").map((cell) => cell.trim()));
    // A path is a span with a slash or a file extension; `GameApp` and the like are names.
    const isPath = (span: string) =>
      span.includes("/") || /\.(rs|ts|sh|toml|lock)$/.test(span);
    const table = Object.fromEntries(
      rows.map((cells) => [cells[1], spans(cells[2]).filter(isPath)]),
    );
    expect(table).toEqual(SURFACES);

    // The list runs from its lead-in to the paragraph on build files; both are pinned clauses.
    const prose = flat(section);
    const from = prose.indexOf("apart from these");
    const to = prose.indexOf("The build files in the table do count");
    expect(from >= 0 && to > from, "not-hot-path list bounds").toBe(true);
    expect(spans(prose.slice(from, to))).toEqual(NOT_HOT);

    const paths = [
      ...Object.values(SURFACES).flat(),
      ...NOT_HOT.filter((p) => p.includes("/")),
    ];
    expect(paths.filter((rel) => !pathExists(rel))).toEqual([]);
  });

  it("keeps the Hot-Path Auditor prompt as one blockquote in section 9", () => {
    const section = (
      sectionOf(page, "## 9. How the review tools apply it") ?? ""
    ).split("\n");
    const quoted = section.map((line) => line.startsWith(">"));
    const blocks = quoted.filter((q, i) => q && !quoted[i - 1]).length;
    expect(blocks, "blockquotes in section 9").toBe(1);
    const prompt = flat(
      section
        .filter((line) => line.startsWith(">"))
        .map((line) => line.replace(/^>\s?/, ""))
        .join(" "),
    );
    expect(PROMPT.filter((sentence) => !prompt.includes(sentence))).toEqual([]);
  });

  for (const skill of SKILLS) {
    it(`${skill.name} override carries its facts and names step anchors that exist`, () => {
      const toml = readToml(`_bmad/custom/${skill.name}.toml`);
      const facts = tomlArray(toml, "persistent_facts");
      for (const [fact, words] of Object.entries(skill.facts)) {
        expect(toml.split(`"${fact}`).length - 1, `${fact} appears once`).toBe(
          1,
        );
        const line = facts.find((l) => l.startsWith(`"${fact}`));
        expect(line, `${fact} inside persistent_facts`).toBeDefined();
        for (const word of words)
          expect(line, `${fact} ${word}`).toContain(word);
      }
      if (skill.stepDir)
        expect(facts).toContain(`"file:{project-root}/${PAGE}",`);

      expect(tomlArray(toml, "activation_steps_prepend"), "prepend").toEqual(
        [],
      );
      // on_complete replaces the base value, so the base must stay empty.
      for (const root of SKILL_ROOTS)
        expect(read(join(root, skill.name, "customize.toml"))).toContain(
          'on_complete = ""',
        );
      const onComplete = toml
        .split("\n")
        .filter((l) => l.startsWith("on_complete = "));
      expect(onComplete.length, "on_complete").toBe(1);
      for (const word of skill.onComplete)
        expect(onComplete[0], `on_complete ${word}`).toContain(word);
      const activation = tomlArray(toml, "activation_steps_append").join(" ");
      for (const word of skill.activation)
        expect(activation, `activation ${word}`).toContain(word);

      // The gds and bmad copies differ only in the skill's name.
      const twin = readToml(`_bmad/custom/${skill.twin}.toml`);
      expect(toml.split(skill.name).join("SKILL")).toBe(
        twin.split(skill.twin).join("SKILL"),
      );

      // Every "section N (Name)" the override cites matches a heading on the page.
      const cites = [...toml.matchAll(/section (\d+) \(([^)]+)\)/g)];
      expect(cites.length).toBeGreaterThan(0);
      for (const [, n, name] of cites) {
        expect(lines, `section ${n} (${name})`).toContain(`## ${n}. ${name}`);
      }

      const steps = [
        ...new Set([...toml.matchAll(/(step-[\w-]+\.md)/g)].map((m) => m[1])),
      ];
      expect(steps.sort()).toEqual(Object.keys(skill.anchors).sort());
      for (const root of SKILL_ROOTS) {
        const hooks = read(join(root, skill.name, "SKILL.md"));
        for (const hook of SKILL_HOOKS)
          expect(hooks, `${root}/${skill.name}/SKILL.md: ${hook}`).toContain(
            hook,
          );
        for (const step of steps) {
          const path = join(root, skill.name, skill.stepDir, step);
          expect(existsSync(join(repoRoot, path)), path).toBe(true);
          const text = read(path);
          for (const anchor of skill.anchors[step])
            expect(text, `${path}: ${anchor}`).toContain(anchor);
        }
      }
    });
  }

  // CI must run the resolver; a machine without Python 3.11+ (tomllib) skips locally.
  const python = spawnSync("python3", ["-c", "import tomllib"], {
    encoding: "utf8",
  });
  it.skipIf(python.status !== 0 && !process.env.CI)(
    "the resolver merges every override over the base facts",
    () => {
      for (const skill of SKILLS) {
        for (const root of SKILL_ROOTS) {
          const out = spawnSync(
            "python3",
            [
              "_bmad/scripts/resolve_customization.py",
              "--skill",
              join(root, skill.name),
              "--key",
              "workflow",
            ],
            { cwd: repoRoot, encoding: "utf8" },
          );
          expect(out.status, out.stderr).toBe(0);
          const workflow = JSON.parse(out.stdout).workflow as {
            persistent_facts: string[];
            activation_steps_prepend?: string[];
            activation_steps_append: string[];
            on_complete: string;
          };
          // Catches a prepend step in any TOML form, which tomlArray cannot.
          expect(workflow.activation_steps_prepend ?? [], "prepend").toEqual([]);
          expect(workflow.persistent_facts).toContain(
            "file:{project-root}/**/project-context.md",
          );
          for (const fact of Object.keys(skill.facts)) {
            expect(
              workflow.persistent_facts.filter((f) => f.startsWith(fact)),
              `${root}/${skill.name}: ${fact}`,
            ).toHaveLength(1);
          }
          expect(workflow.on_complete).toContain(PAGE);
          if (!skill.stepDir) continue;
          expect(workflow.persistent_facts).toContain(
            `file:{project-root}/${PAGE}`,
          );
          expect(
            workflow.activation_steps_append.some((s) => s.includes(PAGE)),
          ).toBe(true);
        }
      }
    },
  );

  it("every summary points to the page", () => {
    expect(SUMMARIES.filter((rel) => !read(rel).includes(PAGE))).toEqual([]);
  });

  it("keeps the CLAUDE.md auto-merge rule that waits for a running review", () => {
    const text = flat(read("CLAUDE.md"));
    expect(AUTO_MERGE.filter((clause) => !text.includes(clause))).toEqual([]);
  });

  it("keeps the link inside AGENTS.md's Review guidelines and the template's Complexity section", () => {
    expect(
      sectionOf(read("AGENTS.md"), "## Review guidelines"),
      "AGENTS.md ## Review guidelines",
    ).toContain(PAGE);
    expect(
      sectionOf(read(".github/PULL_REQUEST_TEMPLATE.md"), "## Complexity"),
      "template ## Complexity",
    ).toContain(PAGE);
  });
});
