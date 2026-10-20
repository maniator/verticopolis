import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { incompleteTreeError, treeRecord, treeSummary, UNREADABLE } from "./treeRecord";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("treeRecord", () => {
  // Stub keyed by the git subcommand; `ls-files-v` is the assume-unchanged listing.
  const key = (args: string[]): string => {
    const sub = args.find((a) => ["status", "diff", "ls-files"].includes(a))!;
    return sub === "ls-files" && args.includes("-v") ? "ls-files-v" : sub;
  };
  const git = (out: Record<string, string | Buffer | null>) => (args: string[]) => out[key(args)] ?? null;
  const clean = { "ls-files-v": "H src/a.ts\0" };

  it("records the porcelain lines, a hash of the tracked changes and a hash of each untracked file", () => {
    const t = treeRecord(
      git({ ...clean, status: " M src/a.ts\n?? src/b.ts\n", diff: "diff --git a/src/a.ts b/src/a.ts\n", "ls-files": "src/z.ts\0src/b.ts\0" }),
      (p) => Buffer.from(`file ${p}`),
    );
    expect(t.porcelain).toEqual([" M src/a.ts", "?? src/b.ts"]);
    expect(t.diffSha256).toBe(sha("diff --git a/src/a.ts b/src/a.ts\n"));
    expect(t.untracked).toEqual([
      { path: "src/b.ts", sha256: sha("file src/b.ts") },
      { path: "src/z.ts", sha256: sha("file src/z.ts") },
    ]);
    expect(t.hidden).toEqual([]);
    expect(t.complete).toBe(true);
  });

  it("hashes git's raw bytes without decoding them", () => {
    const bytes = Buffer.from([0x64, 0xff, 0xfe, 0x0a]);
    const t = treeRecord(git({ ...clean, status: " M a\n", diff: bytes, "ls-files": "" }), () => null);
    expect(t.diffSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("keeps results folders out of every query", () => {
    const seen: string[][] = [];
    treeRecord((args) => (seen.push(args), ""), () => null);
    expect(seen).toHaveLength(4);
    for (const args of seen) expect(args).toContain(":(exclude)docs/performance/results");
  });

  it("pins the diff text against the machine's git configuration", () => {
    const seen: string[][] = [];
    treeRecord((args) => (seen.push(args), ""), () => null);
    const diff = seen.find((a) => a.includes("diff"))!;
    for (const flag of ["--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "-U3", "--inter-hunk-context=0", "--diff-algorithm=myers", "--indent-heuristic", "-O/dev/null", "--ignore-submodules=none"]) expect(diff).toContain(flag);
    // The configuration comes before the subcommand, where git reads -c.
    const before = diff.slice(0, diff.indexOf("diff"));
    for (const setting of ["diff.suppressBlankEmpty=false", "core.compression=-1", "core.quotepath=true"]) expect(before).toContain(setting);
  });

  it("says so when git cannot answer and when a file cannot be read", () => {
    expect(treeRecord(() => null, () => null)).toEqual({ porcelain: null, diffSha256: null, untracked: [], hidden: [], complete: false });
    const t = treeRecord(git({ ...clean, status: "?? x\n", diff: "", "ls-files": "x\0" }), () => null);
    expect(t.untracked).toEqual([{ path: "x", sha256: UNREADABLE }]);
    expect(t.complete).toBe(false);
    expect(treeRecord(git({ ...clean, status: "?? x\n", diff: "", "ls-files": "" }), () => null).complete).toBe(true);
    // A diff, untracked list or flag listing git failed to give is not "no changes".
    expect(treeRecord(git({ ...clean, status: " M a\n", "ls-files": "" }), () => null).complete).toBe(false);
    expect(treeRecord(git({ ...clean, status: " M a\n", diff: "d" }), () => null).complete).toBe(false);
    expect(treeRecord(git({ status: " M a\n", diff: "d", "ls-files": "" }), () => null).complete).toBe(false);
  });

  it("finds tracked files that git was told to stop looking at", () => {
    const t = treeRecord(git({ "ls-files-v": "H ok.ts\0h assumed.ts\0S skipped.ts\0s both.ts\0", status: "", diff: "", "ls-files": "" }), () => null);
    expect(t.hidden).toEqual(["assumed.ts", "both.ts", "skipped.ts"]);
    expect(t.complete).toBe(true);
  });
});

describe("treeSummary", () => {
  const full = { porcelain: [" M a", "?? b"], diffSha256: "d1", untracked: [{ path: "b", sha256: "s1" }], complete: true };
  it("is null without a record, says clean for a clean tree and names everything for a dirty one", () => {
    expect(treeSummary(undefined)).toBeNull();
    expect(treeSummary({ porcelain: [], diffSha256: null, untracked: [], complete: true })).toBe("clean (nothing outside docs/performance/results)");
    // An incomplete record never reads as clean.
    expect(treeSummary({ porcelain: [], diffSha256: null, untracked: [], complete: false })).toBe("git could not finish the working-tree record (the run is void)");
    expect(treeSummary({ porcelain: null, diffSha256: null, untracked: [], complete: false })).toBe("git could not report the working tree (the run is void)");
    expect(treeSummary(full)).toBe("status:  M a; ?? b; tracked changes SHA-256 d1; untracked: b s1");
    expect(treeSummary({ porcelain: ["?? b"], diffSha256: null, untracked: [], complete: true })).toBe("status: ?? b; tracked changes SHA-256 none (no tracked changes)");
  });
  it("does not read a failed diff or an unreadable file as nothing", () => {
    const s = treeSummary({ porcelain: [" M a", "?? b"], diffSha256: null, untracked: [{ path: "b", sha256: UNREADABLE }], complete: false })!;
    expect(s).toContain("tracked changes SHA-256 unavailable (git could not produce the diff)");
    expect(s).toContain(`untracked: b ${UNREADABLE}`);
    expect(s).toContain("the record is incomplete (the run is void)");
  });
  it("flags a dirty run whose record shows nothing", () => {
    expect(treeSummary({ porcelain: [], diffSha256: null, untracked: [], complete: true }, true)).toContain("flagged dirty");
  });
  it("names the files whose edits git hides, and does not call that clean", () => {
    const s = treeSummary({ porcelain: [], diffSha256: null, untracked: [], hidden: ["src/a.ts"], complete: true })!;
    expect(s).toContain("assume-unchanged or skip-worktree: src/a.ts");
    expect(s).not.toContain("clean");
  });
  it("keeps a long list and a pipe from breaking a table row", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ path: `f${i}|x`, sha256: "s" }));
    const s = treeSummary({ ...full, untracked: many })!;
    expect(s).toContain("f0\\|x s");
    expect(s).toContain("and 5 more");
    expect(s).not.toContain("f24");
  });
});

describe("incompleteTreeError", () => {
  const record = { porcelain: [], diffSha256: null, untracked: [], hidden: [], complete: true };
  it("is the validation error for a record git could not finish, and null otherwise", () => {
    expect(incompleteTreeError({ ...record, complete: false })).toMatch(/git could not finish the working-tree record/);
    expect(incompleteTreeError(record)).toBeNull();
    // A run from before the record has none; other checks judge that.
    expect(incompleteTreeError(undefined)).toBeNull();
  });
});
