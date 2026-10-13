import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cpus, freemem, platform, release, totalmem, arch } from "node:os";
import { join } from "node:path";

/** The machine and toolchain a comparison ran on (issue #972). */
export interface Environment {
  commit: string;
  commitShort: string;
  dirty: boolean;
  branch: string;
  /** origin/main at the run (as last fetched), the merge base with it, and
   *  how many of its commits the measured tree lacks (0: a baseline of it). */
  mainCommit: string | null;
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
}

function run(cmd: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
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

/** The engine package's recorded source hash, from a build directory. */
export function engineBuildHash(distDir: string): string | null {
  const p = join(distDir, "engine", "BUILD.json");
  if (!existsSync(p)) return null;
  return (JSON.parse(readFileSync(p, "utf8")) as { sources?: string }).sources ?? null;
}

export function collectEnvironment(repo: string, distDir: string, sourceHash: string | null): Environment {
  const commit = run("git", ["rev-parse", "HEAD"], repo) ?? "unknown";
  // Untracked files count too: a new source file changes the build.
  const status = run("git", ["status", "--porcelain", "--untracked-files=normal"], repo);
  const mainCommit = run("git", ["rev-parse", "origin/main"], repo);
  const behind = mainCommit ? run("git", ["rev-list", "--count", `HEAD..${mainCommit}`], repo) : null;
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string };
  let playwright: string | null = null;
  try {
    playwright = (JSON.parse(readFileSync(join(repo, "node_modules", "playwright-core", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    playwright = null;
  }
  return {
    commit,
    commitShort: commit.slice(0, 7),
    dirty: status === null ? false : status.length > 0,
    branch: run("git", ["rev-parse", "--abbrev-ref", "HEAD"], repo) ?? "unknown",
    mainCommit,
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
