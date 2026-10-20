import { createHash } from "node:crypto";

/**
 * What a run's working tree held beyond its commit (protocol section 3,
 * step 5). A dirty tree voids a run except RUN-0a's declared patch, so the
 * results say what git reports as dirty: the porcelain status, a SHA-256 of
 * the tracked changes (`git diff HEAD --binary`), a SHA-256 of each untracked
 * file, and the tracked files git was told to ignore changes in. The
 * results folders under docs/performance/results are output and stay out of it.
 * Ignored files and a `core.fileMode=false` mode change are outside what git
 * reports, so they are outside the record too.
 */
export interface TreeRecord {
  /** `git status --porcelain` lines; null when git could not say. */
  porcelain: string[] | null;
  /** SHA-256 of the tracked changes against HEAD; null when there are none (see `complete` for a diff git could not produce). */
  diffSha256: string | null;
  untracked: { path: string; sha256: string }[];
  /** Tracked files marked assume-unchanged or skip-worktree: git hides edits to them from status and diff, so any entry makes the tree dirty. Absent in records made before this check. */
  hidden?: string[];
  /** False when git could not produce the diff, the untracked list or the flag list, or a file could not be read: the record then proves nothing and the run is void. */
  complete: boolean;
}

/** Recorded in place of a hash for a file that could not be read (a pipe, a dangling link, a directory, a file too large to hash). */
export const UNREADABLE = "unreadable";

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

const EXCLUDE = [":(exclude)docs/performance/results"];

/**
 * Settings that change the diff text, fixed through `-c` before the
 * subcommand and flags so the common ones (context lines, the diff algorithm,
 * colors, renames, prefixes) cannot differ. (`GIT_DIFF_OPTS` is removed from
 * git's environment by the caller.) Some configuration still changes the
 * output, such as a diff driver from `core.attributesFile` or
 * `.git/info/attributes`. The hash covers git's raw output bytes, so `git
 * diff <these flags> | sha256sum` reproduces it on the same machine. Line
 * endings stay as git reports them: with `core.autocrlf=true` git normalizes
 * tracked files to LF before diffing, but untracked files are hashed as the
 * raw bytes on disk, so a CRLF checkout can hash its untracked files
 * differently from an LF one. The hash identifies a tree on one machine under
 * one git configuration; it is not promised to match another machine's.
 */
const DIFF_CONFIG = ["-c", "diff.suppressBlankEmpty=false", "-c", "core.compression=-1", "-c", "core.quotepath=true"];
const DIFF_FLAGS = ["--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "-U3", "--inter-hunk-context=0", "--diff-algorithm=myers", "--indent-heuristic", "-O/dev/null", "--ignore-submodules=none"];

const text = (out: Buffer | string | null): string | null => (out === null ? null : out.toString());

/** `git` runs git with literal arguments and returns its stdout unmodified (bytes or text), or
 *  null on failure; `read` returns a file's bytes, or null when unreadable. */
export function treeRecord(git: (args: string[]) => Buffer | string | null, read: (path: string) => Buffer | null): TreeRecord {
  const status = text(git(["status", "--porcelain", "--untracked-files=normal", "--", ".", ...EXCLUDE]));
  const diff = git([...DIFF_CONFIG, "diff", "HEAD", ...DIFF_FLAGS, "--", ".", ...EXCLUDE]);
  const others = text(git(["ls-files", "--others", "--exclude-standard", "-z", "--", ".", ...EXCLUDE]));
  // `ls-files -v` tags a cached file H, one marked skip-worktree S, and an
  // assume-unchanged one in lower case (h, s). Status and diff cannot see
  // edits to the last two.
  const tagged = text(git(["ls-files", "-v", "-z", "--", ".", ...EXCLUDE]));
  const hidden = (tagged ?? "")
    .split("\0")
    .filter((e) => e.length > 2 && (e[0] === "S" || (e[0] >= "a" && e[0] <= "z")))
    .map((e) => e.slice(2))
    .sort();
  const untracked = (others ?? "")
    .split("\0")
    .filter(Boolean)
    .sort()
    .map((path) => {
      const bytes = read(path);
      return { path, sha256: bytes ? sha256(bytes) : UNREADABLE };
    });
  return {
    porcelain: status === null ? null : status.split("\n").filter(Boolean),
    diffSha256: diff && diff.length ? sha256(diff) : null,
    untracked,
    hidden,
    complete: status !== null && diff !== null && others !== null && tagged !== null && untracked.every((u) => u.sha256 !== UNREADABLE),
  };
}

const SHOWN_UNTRACKED = 20;
const cell = (x: string): string => x.replace(/\|/g, "\\|");

/**
 * One line for a report, null only for a run without a record (older
 * results). A clean tree says so only when the record is complete; an
 * incomplete record says it proves nothing. `dirty` is the run's own flag:
 * when it disagrees with the record, the line says that too.
 */
export function treeSummary(t: TreeRecord | undefined, dirty?: boolean): string | null {
  if (!t) return null;
  if (t.porcelain === null) return "git could not report the working tree (the run is void)";
  const hidden = t.hidden?.length ? `changes hidden from git status by assume-unchanged or skip-worktree: ${t.hidden.slice(0, SHOWN_UNTRACKED).map(cell).join("; ")}${t.hidden.length > SHOWN_UNTRACKED ? `; and ${t.hidden.length - SHOWN_UNTRACKED} more` : ""}` : null;
  if (t.porcelain.length === 0 && !hidden) {
    if (dirty) return "the run was flagged dirty but git status shows nothing outside docs/performance/results (the record is incomplete, the run is void)";
    return t.complete ? "clean (nothing outside docs/performance/results)" : "git could not finish the working-tree record (the run is void)";
  }
  const parts = [t.porcelain.length ? `status: ${cell(t.porcelain.join("; "))}` : "status shows nothing"];
  parts.push(`tracked changes SHA-256 ${t.diffSha256 ?? (t.complete ? "none (no tracked changes)" : "unavailable (git could not produce the diff)")}`);
  if (t.untracked.length) {
    const shown = t.untracked.slice(0, SHOWN_UNTRACKED).map((u) => `${cell(u.path)} ${u.sha256}`).join("; ");
    parts.push(`untracked: ${shown}${t.untracked.length > SHOWN_UNTRACKED ? `; and ${t.untracked.length - SHOWN_UNTRACKED} more` : ""}`);
  }
  if (hidden) parts.push(hidden);
  if (!t.complete) parts.push("the record is incomplete (the run is void)");
  return parts.join("; ");
}

/** The validation error for a working-tree record git could not finish, or null. A run without a record (an older harness) is judged elsewhere. */
export const incompleteTreeError = (t: TreeRecord | undefined): string | null => (t && !t.complete ? "git could not finish the working-tree record, so the run cannot be tied to a tree" : null);
