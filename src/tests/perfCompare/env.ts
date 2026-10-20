import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { cpus, freemem, platform, release, totalmem, arch } from "node:os";
import { join } from "node:path";
import { treeRecord, type TreeRecord } from "./treeRecord";

/** The machine and toolchain a comparison ran on (issue #972). */
export interface Environment {
  commit: string;
  commitShort: string;
  dirty: boolean;
  /** What made it dirty: the status, a hash of the tracked changes and of
   *  each untracked file (see treeRecord.ts). Absent in older results. */
  tree?: TreeRecord;
  branch: string;
  /** origin/main at the run (as last fetched), the merge base with it, and
   *  how many of its commits the measured tree lacks (0: a baseline of it). */
  mainCommit: string | null;
  /** Whether the fetch of origin/main just before the run succeeded (when
   *  not, mainCommit is the ref as last fetched and may be stale). */
  mainFetched: boolean;
  mergeBase: string | null;
  behindMain: number | null;
  os: string;
  kernel: string;
  arch: string;
  cpuModel: string;
  logicalCpus: number;
  totalMemoryBytes: number;
  freeMemoryBytesAtStart: number;
  node: string;
  rust: string | null;
  playwright: string | null;
  appVersion: string;
  engineBuildHash: string | null;
  engineSourceHash: string | null;
  /** SHA-256 of the served engine binary and loader (dist-perf/engine). */
  enginePackage: Record<string, string>;
}

/** `raw` keeps the output byte for byte (a status line starts with a space)
 *  and allows a large diff; otherwise it is trimmed. */
function run(cmd: string, args: string[], cwd: string, raw = false): string | null {
  return runBytes(cmd, args, cwd, raw)?.toString("utf8") ?? null;
}

function runBytes(cmd: string, args: string[], cwd: string, raw: boolean): Buffer | null {
  try {
    // Bounded, and never prompting for credentials, so a git that wants a
    // password or a remote that hangs cannot stall the benchmark.
    // (The user's own SSH settings are left alone; the timeout bounds an
    // SSH prompt.)
    // GIT_DIFF_OPTS changes the diff text, so the record's hash never sees it.
    const { GIT_DIFF_OPTS: _ignored, ...inherited } = process.env;
    const out = execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, maxBuffer: raw ? 256 * 2 ** 20 : undefined, env: { ...inherited, GIT_TERMINAL_PROMPT: "0" } });
    return raw ? out : Buffer.from(out.toString("utf8").trim());
  } catch {
    return null;
  }
}

function osName(): string {
  try {
    const rel = readFileSync("/etc/os-release", "utf8");
    const m = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(rel);
    if (m) return m[1];
  } catch {
    /* not Linux */
  }
  return `${platform()} ${release()}`;
}

/** The files an engine package must hold. */
export const ENGINE_PACKAGE_FILES = ["verticopolis_engine_bg.wasm", "verticopolis_engine.js"] as const;

/** SHA-256 of each file of a build's engine package, by name. */
export function enginePackageDigests(distDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ENGINE_PACKAGE_FILES) {
    const p = join(distDir, "engine", f);
    // A file that cannot be read is left out, so the checks call the
    // package incomplete instead of throwing.
    try {
      if (existsSync(p)) out[f] = createHash("sha256").update(readFileSync(p)).digest("hex");
    } catch {
      /* unreadable: reported as missing */
    }
  }
  return out;
}

/** A build's engine package as the checks see it, read without throwing:
 *  its file digests, and the source hash its BUILD.json records or why
 *  there is none. */
export interface PackageState {
  files: Record<string, string>;
  buildHash: string | null;
  /** Why `buildHash` is null: no BUILD.json, unreadable, or no `sources`. */
  buildProblem: string | null;
}

export function packageState(distDir: string): PackageState {
  const files = enginePackageDigests(distDir);
  const p = join(distDir, "engine", "BUILD.json");
  if (!existsSync(p)) return { files, buildHash: null, buildProblem: "has no BUILD.json" };
  let text: string;
  try {
    text = readFileSync(p, "utf8");
  } catch {
    return { files, buildHash: null, buildProblem: "has a BUILD.json that cannot be read" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { files, buildHash: null, buildProblem: "has a BUILD.json that is not JSON" };
  }
  const sources = (parsed as { sources?: unknown } | null)?.sources;
  if (typeof sources !== "string" || !sources) return { files, buildHash: null, buildProblem: "has a BUILD.json with no sources hash" };
  return { files, buildHash: sources, buildProblem: null };
}

/** The engine package's recorded source hash, from a build directory. */
export function engineBuildHash(distDir: string): string | null {
  return packageState(distDir).buildHash;
}

const MAX_UNTRACKED_BYTES = 256 * 2 ** 20;

/** An untracked file's bytes; a symlink's target text (the link itself is what the tree holds); null for anything else or a file too large to hash. */
export function readUntracked(path: string): Buffer | null {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return Buffer.from(`symlink:${readlinkSync(path)}`);
    if (!st.isFile() || st.size > MAX_UNTRACKED_BYTES) return null;
    return readFileSync(path);
  } catch {
    return null;
  }
}

export function collectEnvironment(repo: string, distDir: string, sourceHash: string | null): Environment {
  const commit = run("git", ["rev-parse", "HEAD"], repo) ?? "unknown";
  // Untracked files count too: a new source file changes the build.
  // Committed-or-not results folders are output, not source, so they never
  // make a tree dirty.
  const status = run("git", ["status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude)docs/performance/results"], repo);
  // Best effort: bring origin/main up to date, then compare with it (as
  // last fetched, when the fetch cannot reach the remote).
  const fetched = run("git", ["fetch", "-q", "origin", "main"], repo) !== null;
  const mainCommit = run("git", ["rev-parse", "origin/main"], repo);
  const behind = mainCommit ? run("git", ["rev-list", "--count", `HEAD..${mainCommit}`], repo) : null;
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string };
  let playwright: string | null = null;
  try {
    playwright = (JSON.parse(readFileSync(join(repo, "node_modules", "playwright-core", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    playwright = null;
  }
  const tree = treeRecord((args) => runBytes("git", args, repo, true), (p) => readUntracked(join(repo, p)));
  // A status that could not be read counts as dirty: unknown is not clean. So
  // does a tracked file git was told to ignore changes in, and the flag with
  // nothing in the record to explain it makes the record incomplete.
  const dirty = status === null || status.length > 0 || (tree.hidden?.length ?? 0) > 0;
  if (dirty && tree.porcelain?.length === 0 && !tree.hidden?.length) tree.complete = false;
  return {
    commit,
    commitShort: commit.slice(0, 7),
    dirty,
    tree,
    branch: run("git", ["rev-parse", "--abbrev-ref", "HEAD"], repo) ?? "unknown",
    mainCommit,
    mainFetched: fetched,
    mergeBase: mainCommit ? run("git", ["merge-base", "HEAD", mainCommit], repo) : null,
    behindMain: behind === null ? null : Number(behind),
    os: osName(),
    kernel: release(),
    arch: arch(),
    cpuModel: cpus()[0]?.model ?? "unknown",
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtStart: freemem(),
    node: process.version,
    rust: run("rustc", ["-V"], repo),
    playwright,
    appVersion: pkg.version,
    engineBuildHash: engineBuildHash(distDir),
    engineSourceHash: sourceHash,
    enginePackage: enginePackageDigests(distDir),
  };
}

/** Proportional set size (kB to bytes) of a process tree on Linux, from
 *  /proc/<pid>/smaps_rollup, counting only descendants whose command name
 *  matches `only` (the browser's processes, not tsx's esbuild service);
 *  null elsewhere or when nothing matched. */
export function processTreePss(rootPid: number, only: RegExp = /./): { bytes: number; processes: number } | null {
  if (platform() !== "linux") return null;
  const parent = new Map<number, number>();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      parent.set(Number(d), ppid);
    } catch {
      /* exited */
    }
  }
  const tree = new Set<number>([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, ppid] of parent) {
      if (!tree.has(pid) && tree.has(ppid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }
  let kb = 0;
  let counted = 0;
  for (const pid of tree) {
    if (pid === rootPid) continue;
    try {
      if (!only.test(readFileSync(`/proc/${pid}/comm`, "utf8").trim())) continue;
      const m = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"));
      if (m) {
        kb += Number(m[1]);
        counted++;
      }
    } catch {
      /* exited or not ours */
    }
  }
  return counted ? { bytes: kb * 1024, processes: counted } : null;
}

/** The tree a build comes from: HEAD and whether anything outside the
 *  results folders differs from it. */
export function buildTree(repo: string): { commit: string; dirty: boolean } {
  const status = run("git", ["status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude)docs/performance/results"], repo);
  return { commit: run("git", ["rev-parse", "HEAD"], repo) ?? "unknown", dirty: status === null ? true : status.length > 0 };
}
