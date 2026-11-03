// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BASELINE_DIST, BASELINE_STAMP, BASELINE_TREE, TS_BASELINE, buildBaseline, type BaselineSteps } from "./baseline";
import { BASELINE_LOCK } from "./baselineLock";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface World {
  /** Whether the clone holds the pinned commit. */
  hasCommit?: boolean;
  /** What `rev-parse HEAD` says in an existing tree. */
  head?: string;
  /** Make `git worktree remove` fail, as it does for a folder git does not know. */
  removeFails?: boolean;
  buildFails?: boolean;
}

/** A repository folder and recording stand-ins for git, the install and the build. */
function setup(world: World = {}) {
  const repo = mkdtempSync(join(tmpdir(), "vc-baseline-build-"));
  made.push(repo);
  const tree = join(repo, BASELINE_TREE);
  const dist = join(repo, BASELINE_DIST);
  const calls: string[] = [];
  const installs: NodeJS.ProcessEnv[] = [];
  const steps: BaselineSteps = {
    git: (cwd, ...args) => {
      const verb = args[0] === "worktree" ? `worktree ${args[1]}` : args[0];
      calls.push(`${verb}${cwd === tree ? " (in tree)" : ""}`);
      if (verb === "cat-file" && world.hasCommit === false) throw new Error("fatal: not a valid object name");
      if (verb === "rev-parse") return world.head ?? "";
      if (verb === "worktree remove" && world.removeFails) throw new Error("fatal: not a working tree");
      if (verb === "worktree add") {
        mkdirSync(tree, { recursive: true });
        writeFileSync(join(tree, ".git"), "gitdir: elsewhere\n");
      }
      return "";
    },
    install: (_tree, env) => {
      calls.push("install");
      installs.push(env);
    },
    build: (_tree, out) => {
      calls.push("build");
      if (world.buildFails) throw new Error("the build failed");
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "index.html"), "<html></html>");
    },
  };
  const log: string[] = [];
  return { repo, tree, dist, calls, installs, steps, log, run: () => buildBaseline(repo, (l) => log.push(l), steps) };
}

/** An earlier run's checkout, with its own `.git` entry. */
function existingTree(tree: string): void {
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(tree, ".git"), "gitdir: elsewhere\n");
}

describe("buildBaseline", () => {
  it("stops before any slow step when the clone lacks the pinned commit", () => {
    const w = setup({ hasCommit: false });
    expect(w.run).toThrow(TS_BASELINE.commit);
    expect(w.calls).toEqual(["cat-file"]);
    expect(existsSync(w.dist)).toBe(false);
    expect(existsSync(join(w.repo, BASELINE_LOCK))).toBe(false); // released even though it threw
  });

  it("checks the commit out, installs, builds and stamps the dist when nothing exists yet", () => {
    const w = setup();
    w.run();
    expect(w.calls).toEqual(["cat-file", "worktree add", "install", "build"]);
    expect(JSON.parse(readFileSync(join(w.dist, BASELINE_STAMP), "utf8"))).toEqual({ commit: TS_BASELINE.commit, appVersion: TS_BASELINE.appVersion });
    expect(w.log.join("\n")).toContain("checking out the TypeScript baseline");
  });

  it("reuses a checkout at the pinned commit, resetting and cleaning what an earlier run left", () => {
    const w = setup({ head: TS_BASELINE.commit });
    existingTree(w.tree);
    w.run();
    expect(w.calls).toEqual(["cat-file", "rev-parse (in tree)", "reset (in tree)", "clean (in tree)", "install", "build"]);
  });

  it("replaces a checkout at another commit", () => {
    const w = setup({ head: "0".repeat(40) });
    existingTree(w.tree);
    w.run();
    expect(w.calls).toEqual(["cat-file", "rev-parse (in tree)", "worktree remove", "worktree prune", "worktree add", "install", "build"]);
  });

  it("removes a leftover folder git does not know as a worktree, and does not ask git about it", () => {
    const w = setup({ removeFails: true });
    mkdirSync(w.tree, { recursive: true });
    writeFileSync(join(w.tree, "stray.txt"), "left over");
    w.run();
    // No `.git` entry in the folder: git would answer for the main checkout, so it is never asked.
    expect(w.calls).toEqual(["cat-file", "worktree remove", "worktree prune", "worktree add", "install", "build"]);
    expect(existsSync(join(w.tree, "stray.txt"))).toBe(false);
  });

  it("clears a stale dist before the build, so an old build cannot ride into the new stamp", () => {
    const w = setup();
    mkdirSync(w.dist, { recursive: true });
    writeFileSync(join(w.dist, "old-chunk.js"), "stale");
    w.run();
    expect(existsSync(join(w.dist, "old-chunk.js"))).toBe(false);
    expect(existsSync(join(w.dist, "index.html"))).toBe(true);
  });

  it("leaves no stamp when the build fails, and releases the lock", () => {
    const w = setup({ buildFails: true });
    mkdirSync(w.dist, { recursive: true });
    writeFileSync(join(w.dist, BASELINE_STAMP), "{}");
    expect(w.run).toThrow("the build failed");
    expect(existsSync(join(w.dist, BASELINE_STAMP))).toBe(false);
    expect(existsSync(join(w.repo, BASELINE_LOCK))).toBe(false);
  });

  it("installs without the caller's engine and tooling variables, with the no-engine switch set", () => {
    const saved = { ...process.env };
    process.env.VC_ENGINE = "ts";
    process.env.NODE_ENV = "production";
    process.env.npm_config_omit = "dev";
    try {
      const w = setup();
      w.run();
      const env = w.installs[0];
      expect(env.VC_ALLOW_NO_ENGINE).toBe("1");
      for (const name of ["VC_ENGINE", "NODE_ENV", "npm_config_omit"]) expect(env[name], name).toBeUndefined();
    } finally {
      for (const k of ["VC_ENGINE", "NODE_ENV", "npm_config_omit"]) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it("refuses a second build while the first holds the lock", () => {
    const w = setup();
    mkdirSync(join(w.repo, BASELINE_LOCK));
    writeFileSync(join(w.repo, BASELINE_LOCK, "pid"), `${process.pid}\n`); // this process is alive
    expect(w.run).toThrow(/another perf run is building the TypeScript baseline/);
    expect(w.calls).toEqual([]); // nothing ran
    expect(existsSync(join(w.repo, BASELINE_LOCK))).toBe(true); // the holder's lock is untouched
  });
});
