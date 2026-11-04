import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LOCK_FILES } from "../build/engineCompat";
import { repoRel, repoRoot, sourceFiles } from "./guardFiles";

/**
 * scripts/vercel-ignore-build.sh decides which commits skip a Vercel build.
 * Skipping a commit that changes the deployed app is the failure to avoid, so
 * three things are pinned here: the table gives the expected answer for named
 * paths, the script turns those answers into exit codes the way Vercel reads
 * them, and nothing the build reaches by import or include sits on a skipped
 * path.
 *
 * The script is bash that Vercel runs on Linux, so the suite does not run on
 * Windows, where `bash` can be a WSL stub.
 */

const SCRIPT = join(repoRoot, "scripts", "vercel-ignore-build.sh");

/** Runs the script's `--classify` mode and returns "build" or "skip" per path. */
function classify(paths: string[]): Map<string, "build" | "skip"> {
  const out = new Map<string, "build" | "skip">();
  // Chunked so a long list never nears the argument limit.
  for (let i = 0; i < paths.length; i += 400) {
    const chunk = paths.slice(i, i + 400);
    const run = spawnSync("bash", [SCRIPT, "--classify", ...chunk], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    for (const line of run.stdout.split("\n")) {
      const space = line.indexOf(" ");
      if (space > 0) out.set(line.slice(space + 1), line.slice(0, space) as "build" | "skip");
    }
  }
  return out;
}

describe.skipIf(process.platform === "win32")("scripts/vercel-ignore-build.sh", () => {
  describe("the path table", () => {
    const BUILDS = [
      // The /help page imports these pictures.
      "docs/screenshots/00-splash.png",
      "docs/screenshots/features/stats-tenancy-modern.png",
      // Build inputs and configs.
      "CHANGELOG.md",
      "package.json",
      "package-lock.json",
      "vite.config.ts",
      "tsconfig.json",
      "vercel.json",
      ".nvmrc",
      ".gitattributes",
      "LICENSE",
      "ASSETS-LICENSE.md",
      "api/anything.ts",
      // The app, the engine crate and what it compiles in.
      "src/main.ts",
      "src/public/sw-navigation-fallback.js",
      "src/engine/facilities.ts",
      "src/tests/portKit/convertedList.ts",
      "engine-rs/src/lib.rs",
      "engine-rs/Cargo.toml",
      "engine-rs/Cargo.lock",
      "conformance/events/catalog.json",
      "conformance/loader-cases.json",
      "conformance/catalog-digests.json",
      ...LOCK_FILES.map((f) => `conformance/${f}`),
      // Scripts the build runs.
      "scripts/vercel-build.sh",
      "scripts/build-engine-wasm.sh",
      "scripts/wasm-build.ts",
      "scripts/verify-precache.ts",
      "scripts/gen-third-party-notices.ts",
      "scripts/engine-bundle.allow.txt",
      // Not listed anywhere, so it builds.
      "some-new-top-level-file.txt",
      "newfolder/file.ts",
    ];
    const SKIPS = [
      "docs/atlas.md",
      "docs/performance/hot-path-review.md",
      "README.md",
      "CONTRIBUTING.md",
      "CLAUDE.md",
      ".github/workflows/test.yml",
      ".github/copilot-instructions.md",
      ".claude/settings.json",
      "_bmad-output/implementation-artifacts/backlog.md",
      "e2e/visual.spec.ts",
      "tools/simtower/README.md",
      ".gitignore",
      "playwright.config.ts",
      "eslint.config.js",
      "src/game/appBoot.test.ts",
      "src/ui/Menu.test.tsx",
      "src/tests/namedFlags.guard.test.ts",
      "src/tests/guardFiles.ts",
      "engine-rs/tests/api.rs",
      "engine-rs/consumer/src/main.rs",
      "engine-rs/API.md",
      "engine-rs/CHANGELOG.md",
      "conformance/fixtures/sixseven_2.vctower",
      "conformance/fuzz-window.json",
      "conformance/scenarios/anything.json",
      "scripts/screenshots.ts",
      "scripts/scenes/anything.ts",
      "scripts/perf-compare.ts",
      "scripts/fuzz-corpus.ts",
      "scripts/posthog-report.mjs",
      "scripts/posthog-report.d.mts",
      "scripts/rollback-rehearsal.ts",
    ];

    it("builds every path that can reach the deployed app or its build checks", () => {
      const got = classify(BUILDS);
      expect(BUILDS.filter((p) => got.get(p) !== "build")).toEqual([]);
    });

    it("skips paths that never reach them", () => {
      const got = classify(SKIPS);
      expect(SKIPS.filter((p) => got.get(p) !== "skip")).toEqual([]);
    });
  });

  describe("the exit codes", () => {
    const roots: string[] = [];
    afterAll(() => {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    });

    const git = (cwd: string, ...args: string[]): string => {
      const run = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" },
      });
      expect(run.status, run.stderr).toBe(0);
      return run.stdout.trim();
    };

    /** A repo whose first commit holds `before`, and a second that applies
     *  `after` (a null value deletes the file). Returns the script's exit
     *  code, with the first commit as Vercel's previous deploy. */
    function exitCode(before: Record<string, string>, after: Record<string, string | null>, previous: "sha" | "none" = "sha"): number | null {
      const root = mkdtempSync(join(tmpdir(), "vc-ignore-build-"));
      roots.push(root);
      git(root, "init", "-q");
      const write = (files: Record<string, string | null>): void => {
        for (const [name, text] of Object.entries(files)) {
          const abs = join(root, name);
          if (text === null) rmSync(abs);
          else {
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, text);
          }
        }
        git(root, "add", "-A");
        git(root, "commit", "-q", "-m", "c");
      };
      write(before);
      const first = git(root, "rev-parse", "HEAD");
      write(after);
      const env = { ...process.env, VERCEL_GIT_PREVIOUS_SHA: previous === "sha" ? first : "" };
      return spawnSync("bash", [SCRIPT], { cwd: root, env, encoding: "utf8" }).status;
    }

    const base = { "src/a.ts": "a", "docs/a.md": "a", "README.md": "a" };

    it("skips (0) when only skipped paths changed", () => {
      expect(exitCode(base, { "docs/a.md": "b", "README.md": "b", ".github/workflows/x.yml": "b", "src/a.test.ts": "b" })).toBe(0);
    });

    it("builds (1) when a built path changed, alone or among skipped ones", () => {
      expect(exitCode(base, { "src/a.ts": "b" })).toBe(1);
      expect(exitCode(base, { "docs/a.md": "b", "src/a.ts": "b" })).toBe(1);
      expect(exitCode(base, { "docs/screenshots/a.png": "b" })).toBe(1);
      expect(exitCode(base, { "CHANGELOG.md": "b" })).toBe(1);
    });

    it("builds when a built file moves into a skipped folder", () => {
      expect(exitCode(base, { "src/a.ts": null, "docs/moved.ts": "a" })).toBe(1);
    });

    it("builds when a commit deletes a built file", () => {
      expect(exitCode(base, { "src/a.ts": null })).toBe(1);
    });

    it("diffs against the parent commit when Vercel gives no previous deploy", () => {
      expect(exitCode(base, { "docs/a.md": "b" }, "none")).toBe(0);
      expect(exitCode(base, { "src/a.ts": "b" }, "none")).toBe(1);
    });

    it("builds when Vercel's previous deploy is not in the clone", () => {
      const root = mkdtempSync(join(tmpdir(), "vc-ignore-build-"));
      roots.push(root);
      git(root, "init", "-q");
      for (const text of ["a", "b"]) {
        writeFileSync(join(root, "README.md"), text);
        git(root, "add", "-A");
        git(root, "commit", "-q", "-m", "c");
      }
      const env = { ...process.env, VERCEL_GIT_PREVIOUS_SHA: "0123456789012345678901234567890123456789" };
      expect(spawnSync("bash", [SCRIPT], { cwd: root, env, encoding: "utf8" }).status).toBe(1);
    });

    it("builds when there is nothing to diff against", () => {
      const root = mkdtempSync(join(tmpdir(), "vc-ignore-build-"));
      roots.push(root);
      git(root, "init", "-q");
      writeFileSync(join(root, "README.md"), "a");
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "only");
      const run = spawnSync("bash", [SCRIPT], { cwd: root, env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: "" }, encoding: "utf8" });
      expect(run.status).toBe(1);
    });
  });

  describe("what the build reaches", () => {
    /** A relative specifier in an import, a dynamic import, a `new URL(...,
     *  import.meta.url)` or an HTML `src` or `href`, with any Vite query. */
    const RELATIVE = [
      /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g,
      /new\s+URL\(\s*["'](\.{1,2}\/[^"']+)["']\s*,\s*import\.meta\.url/g,
      /\b(?:src|href)=["'](\.{1,2}\/[^"']+)["']/g,
    ];

    /** The repo-relative file a specifier names, or null for a generated or
     *  missing one. */
    function resolveSpec(fromRel: string, spec: string): string | null {
      const bare = spec.replace(/[?#].*$/, "");
      const target = posix.normalize(posix.join(posix.dirname(fromRel), bare));
      for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}.mts`, `${target}.mjs`, `${target}/index.ts`, target.replace(/\.js$/, ".ts")]) {
        const abs = resolve(repoRoot, candidate);
        if (existsSync(abs) && !readdirOrNull(abs)) return candidate;
      }
      return null;
    }

    function readdirOrNull(abs: string): string[] | null {
      try {
        return readdirSync(abs);
      } catch {
        return null;
      }
    }

    /** Every repo file the build's entry points reach by following imports. */
    function reachedByBuild(): string[] {
      const entries = [
        "vite.config.ts",
        "src/index.html",
        "src/gallery.html",
        "src/help.html",
        "src/preview.html",
        "scripts/wasm-build.ts",
        "scripts/engine-third-party.ts",
        "scripts/gen-third-party-notices.ts",
        "scripts/prerender-help.ts",
        ...sourceFiles("scripts", [".ts"])
          .map(repoRel)
          .filter((p) => /^scripts\/verify-.*\.ts$/.test(p)),
      ];
      const seen = new Set<string>();
      const queue = [...entries];
      while (queue.length > 0) {
        const file = queue.pop() as string;
        if (seen.has(file)) continue;
        seen.add(file);
        if (!/\.(ts|tsx|mts|mjs|js|html|css)$/.test(file)) continue;
        const text = readFileSync(resolve(repoRoot, file), "utf8");
        for (const pattern of RELATIVE) {
          for (const match of text.matchAll(pattern)) {
            const next = resolveSpec(file, match[1] as string);
            if (next !== null && !seen.has(next)) queue.push(next);
          }
        }
      }
      return [...seen].sort();
    }

    it("follows imports from vite.config.ts and the build scripts, and none lands on a skipped path", () => {
      const reached = reachedByBuild();
      // A sanity floor: a broken scan would reach nothing and pass.
      expect(reached.length).toBeGreaterThan(200);
      expect(reached).toContain("src/tests/portKit/convertedList.ts");
      expect(reached).toContain("docs/screenshots/00b-onboarding-modern.png");
      const got = classify(reached);
      expect(reached.filter((p) => got.get(p) !== "build")).toEqual([]);
    });

    it("builds every file the engine crate includes with include_str! or include_bytes!", () => {
      const INCLUDE = /include_(?:str|bytes)!\(\s*"([^"]+)"\s*\)/g;
      const targets = new Set<string>();
      for (const abs of sourceFiles("engine-rs/src", [".rs"])) {
        const rel = repoRel(abs);
        for (const match of readFileSync(abs, "utf8").matchAll(INCLUDE)) {
          targets.add(posix.normalize(posix.join(posix.dirname(rel), match[1] as string)));
        }
      }
      expect(targets.size).toBeGreaterThan(0);
      const got = classify([...targets]);
      expect([...targets].filter((p) => got.get(p) !== "build")).toEqual([]);
    });
  });
});
