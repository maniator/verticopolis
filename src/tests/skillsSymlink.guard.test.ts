import { describe, expect, it } from "vitest";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { repoRoot } from "./guardFiles";

/**
 * One copy of the agent skills (#827). Claude Code reads skills only from
 * `.claude/skills` and GitHub Copilot from `.agents/skills`, so the tree used
 * to be committed twice and drifted (a skill added to one copy only). Now
 * `.agents/skills` holds the skills and `.claude/skills` is a committed symlink
 * to it, which Claude Code follows.
 *
 * A checkout where git wrote the link as a plain file (Windows without
 * `core.symlinks`) fails the first test, with the fix in its message, rather
 * than leaving Claude Code with no skills and no warning.
 */

const LINK = join(repoRoot, ".claude", "skills");
const TARGET = "../.agents/skills";

describe("the skills symlink", () => {
  it("is a symlink on disk, pointing at the one copy", () => {
    const stat = lstatSync(LINK);
    expect(
      stat.isSymbolicLink(),
      ".claude/skills is not a symlink here. On Windows, enable Developer Mode, run `git config core.symlinks true`, then `git checkout -- .claude/skills`. See AGENTS.md.",
    ).toBe(true);
    expect(readlinkSync(LINK).replace(/\\/g, "/")).toBe(TARGET);
  });

  it("is committed as a symlink, so no copy of the skills comes back under .claude", () => {
    // Mode 120000 is git's symlink entry. A real directory would list its
    // files here instead.
    const entries = execFileSync("git", ["ls-files", "-s", "--", ".claude/skills"], { cwd: repoRoot, encoding: "utf8" })
      .trim()
      .split("\n");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^120000 [0-9a-f]+ 0\t\.claude\/skills$/);
  });

  it("reaches the review skills both tools run", () => {
    for (const skill of ["gds-code-review", "bmad-code-review", "stand-in-pr-review"]) {
      expect(existsSync(join(LINK, skill, "SKILL.md")), skill).toBe(true);
    }
  });
});
