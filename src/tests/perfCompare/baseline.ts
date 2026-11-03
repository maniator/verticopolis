import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildTooling, npmEntry, runNodeCli } from "../perfWorker/build";
import { acquireBaselineLock } from "./baselineLock";
import { startServer, type PerfServer } from "./server";

/**
 * The TypeScript engine's performance baseline (issue #1597). The game no
 * longer plays on the TypeScript engine, so the comparison's TypeScript arm
 * cannot be a mode of the current build. It is a pinned build of the last
 * commit that could: a TypeScript-only tooling build of `TS_BASELINE`, served
 * beside the current Rust build, with the current engine package overlaid at
 * `/engine/` so the package-load side measurements still have a package.
 * The 3.0 performance gate compares the current Rust build with this one.
 * The arm goes away with `src/engine/`.
 */

/** The last `main` commit before the TypeScript engine stopped being playable (merge of #1592, before #1598). */
export const TS_BASELINE = {
  commit: "f3304e3ffa4f633fb72f70b5ff2e0072e611fd34",
  appVersion: "2.77.5",
} as const;

export interface BaselineRecord {
  commit: string;
  appVersion: string;
}

/** Where the baseline commit is checked out (gitignored). */
export const BASELINE_TREE = ".perf-ts-baseline";
/** Where its tooling build lands (gitignored), beside `dist-perf/`. */
export const BASELINE_DIST = "dist-perf-ts";
/** The stamp the build leaves in its dist, so a `--skip-build` run can prove what it serves. */
export const BASELINE_STAMP = ".perf-baseline.json";

/** The shortest commit prefix a build's `version.json` may name; shorter ones match almost anything. */
const MIN_SHA_LENGTH = 7;

/** What is wrong with a baseline build, if anything. Reads only files. */
export function baselineErrors(dist: string): string[] {
  const errors: string[] = [];
  let stamp: Partial<BaselineRecord> = {};
  try {
    stamp = JSON.parse(readFileSync(join(dist, BASELINE_STAMP), "utf8")) as Partial<BaselineRecord>;
  } catch {
    return [`${dist} has no readable ${BASELINE_STAMP}, so which commit it was built from is unknown; run once without --skip-build`];
  }
  if (stamp.commit !== TS_BASELINE.commit) errors.push(`${dist} was built from ${stamp.commit ?? "an unknown commit"}, not the pinned ${TS_BASELINE.commit}; run once without --skip-build`);
  let version: { version?: unknown; sha?: unknown; engineBuild?: unknown } = {};
  try {
    version = JSON.parse(readFileSync(join(dist, "version.json"), "utf8")) as typeof version;
  } catch {
    errors.push(`${dist}/version.json cannot be read`);
    return errors;
  }
  if (version.version !== TS_BASELINE.appVersion) errors.push(`${dist} is app ${String(version.version)}, not the pinned ${TS_BASELINE.appVersion}`);
  if (typeof version.sha !== "string" || version.sha.length < MIN_SHA_LENGTH || !TS_BASELINE.commit.startsWith(version.sha)) errors.push(`${dist}/version.json names commit ${String(version.sha)}, not the pinned ${TS_BASELINE.commit.slice(0, 8)}`);
  if (version.engineBuild !== "switchable") errors.push(`${dist} is a ${String(version.engineBuild)} build; the TypeScript arm needs the switchable build that honors /?engine=ts`);
  if (existsSync(join(dist, "engine"))) errors.push(`${dist}/engine exists; the baseline is a TypeScript-only build, and the engine package is overlaid by the server`);
  return errors;
}

type Git = (repo: string, ...args: string[]) => string;

const git: Git = (repo, ...args) => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of GIT_REPO_ENV) delete env[name];
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env }).trim();
};

/** Fails fast, before any slow build, when the clone does not hold the pinned commit (a shallow clone). */
export function requireBaselineCommit(repo: string, run: Git = git): void {
  try {
    run(repo, "cat-file", "-e", `${TS_BASELINE.commit}^{commit}`);
  } catch {
    throw new Error(`the pinned baseline commit ${TS_BASELINE.commit} is not in this clone; fetch it with \`git fetch origin ${TS_BASELINE.commit}\` (or a full fetch) and run again`);
  }
}

/** Variables of the caller that would change what the pinned build is or which dependencies install. */
const SCRUBBED_ENV = /^(VC_ENGINE|VC_PUBLIC_DIR|VC_TOOLING|NODE_ENV|npm_lifecycle_event|npm_lifecycle_script|npm_config_(omit|production|include|only|dev|ignore_scripts))$/i;

/** Variables that would point git at another repository than the one it is run in. */
const GIT_REPO_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] as const;

/** The steps `buildBaseline` takes outside the filesystem: git, the dependency install and the build itself.
 *  They are parameters so a test can drive the branches without a network, a clone or a build. */
export interface BaselineSteps {
  git: Git;
  install: (tree: string, env: NodeJS.ProcessEnv) => void;
  build: (tree: string, dist: string, env: NodeJS.ProcessEnv) => void;
}

const REAL_STEPS: BaselineSteps = {
  git,
  install: (tree, env) => runNodeCli(npmEntry(env), ["ci", "--no-audit", "--no-fund"], tree, env),
  build: buildTooling,
};

/** Check out the pinned commit, install its dependencies and build it into `dist-perf-ts/`, holding the baseline lock throughout. */
export function buildBaseline(repo: string, log: (line: string) => void, steps: BaselineSteps = REAL_STEPS): void {
  const release = acquireBaselineLock(repo);
  try {
    buildLocked(repo, log, steps);
  } finally {
    release();
  }
}

function buildLocked(repo: string, log: (line: string) => void, steps: BaselineSteps): void {
  const { git } = steps;
  const tree = join(repo, BASELINE_TREE);
  const dist = join(repo, BASELINE_DIST);
  requireBaselineCommit(repo, git);
  if (existsSync(tree)) {
    let head = "";
    try {
      // A worktree has its own `.git` entry. Without one, git would walk up and answer for the main checkout.
      if (existsSync(join(tree, ".git"))) head = git(tree, "rev-parse", "HEAD");
    } catch {
      // Not a usable checkout; replaced below.
    }
    if (head === TS_BASELINE.commit) {
      // The right commit, but an earlier run or a hand edit may have left changes behind: the stamp must describe the pinned sources.
      git(tree, "reset", "--hard", TS_BASELINE.commit);
      git(tree, "clean", "-fdx");
    } else {
      try {
        git(repo, "worktree", "remove", "--force", tree);
      } catch {
        // A leftover folder git does not know as a worktree; removed below.
      }
      rmSync(tree, { recursive: true, force: true });
      git(repo, "worktree", "prune");
    }
  }
  if (!existsSync(tree)) {
    log(`baseline: checking out the TypeScript baseline ${TS_BASELINE.commit.slice(0, 8)} (app ${TS_BASELINE.appVersion}) into ${BASELINE_TREE}/`);
    git(repo, "worktree", "add", "--detach", "--force", tree, TS_BASELINE.commit);
  }
  log("baseline: installing the baseline's dependencies (npm ci)");
  const env: NodeJS.ProcessEnv = { ...process.env, VC_ALLOW_NO_ENGINE: "1" };
  for (const name of Object.keys(env)) if (SCRUBBED_ENV.test(name)) delete env[name];
  steps.install(tree, env);
  log(`baseline: TypeScript-only tooling build of the baseline into ${BASELINE_DIST}/`);
  // A stale dist from an earlier pin or a failed build must not survive into this one's stamp.
  rmSync(dist, { recursive: true, force: true });
  steps.build(tree, dist, env);
  const record: BaselineRecord = { commit: TS_BASELINE.commit, appVersion: TS_BASELINE.appVersion };
  writeFileSync(join(dist, BASELINE_STAMP), JSON.stringify(record) + "\n");
}

/** Throws unless `dist-perf-ts/` holds a usable baseline build: a build is there and its stamp, version and shape match the pin. */
export function requireBaselineDist(distTs: string): void {
  if (!existsSync(join(distTs, "index.html"))) throw new Error(`no build at ${distTs}; run without --skip-build`);
  const problems = baselineErrors(distTs);
  if (problems.length) throw new Error(`the TypeScript baseline build cannot be used:\n  - ${problems.join("\n  - ")}`);
}

/** The servers a run measures from: the current timed build for Rust, and, when a TypeScript arm runs, the pinned baseline
 *  with the current engine package overlaid at `/engine` so the package-load side measurements have a package in that origin. */
export async function startArmServers(distPerf: string, distTs: string, needsBaseline: boolean): Promise<Partial<Record<"ts" | "wasm", PerfServer>>> {
  const wasm = await startServer(distPerf);
  if (!needsBaseline) return { wasm };
  try {
    return { wasm, ts: await startServer(distTs, 0, { prefix: "/engine", dir: join(distPerf, "engine") }) };
  } catch (e) {
    await wasm.close();
    throw e;
  }
}
