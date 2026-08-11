import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Single-copy guard for the BMAD/BMGD skill library.
 *
 * The library used to be committed twice, byte for byte: once as
 * `.claude/skills/` (the only place Claude Code discovers project skills) and
 * once as `.agents/skills/` (the path `.github/agents/*.agent.md` hands to
 * Copilot). That was 515 duplicated files and about 5MB in every clone, and the
 * two copies could drift apart silently.
 *
 * `.agents/skills/` now holds the only copy and `.claude/skills` is a symlink
 * to it. A tool that "helpfully" materializes the symlink, or a Windows commit
 * made without symlink support, would restore the duplicate without anyone
 * noticing, so this asserts on git's recorded index rather than on the working
 * tree: mode 120000 is a symlink no matter what the checkout looks like
 * locally.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // No git, or not a checkout (a source tarball, a vendored copy). Nothing to
    // guard in that case, so the tests below skip rather than fail.
    return null;
  }
}

const index = git("ls-files", "-s", "--", ".claude", ".agents/skills");
const entries = (index ?? "")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [meta, path] = line.split("\t");
    return { mode: meta.split(" ")[0], path };
  });

describe.skipIf(index === null)("BMAD/BMGD skills are committed exactly once", () => {
  it("tracks `.claude/skills` as a symlink, not a directory of files", () => {
    const claudeEntries = entries.filter((e) => e.path.startsWith(".claude/"));
    expect(claudeEntries.map((e) => e.path)).toEqual([".claude/skills"]);
    expect(claudeEntries[0]?.mode).toBe("120000");
  });

  it("points that symlink at the real tree", () => {
    const blob = git("cat-file", "-p", ":.claude/skills");
    expect(blob?.trim()).toBe("../.agents/skills");
  });

  it("keeps the real tree under `.agents/skills`", () => {
    const real = entries.filter((e) => e.path.startsWith(".agents/skills/"));
    expect(real.length).toBeGreaterThan(100);
  });
});
