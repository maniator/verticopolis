/**
 * Checks a pull request against the change-note flow (`npm run version:check`,
 * and the test job in CI): a feature PR leaves the versions to the release PR
 * and adds a `.changes` note, and a release PR raises each version by its notes.
 * The rules are in `src/build/versionCheck.ts`.
 *
 *   node scripts/version-check.ts [--base <rev>] [--branch <name>]
 *
 * The base defaults to the merge base with `origin/main` and the branch to the
 * current one. CI passes the merge commit's first parent and the PR's head
 * branch. It reads committed files only, so commit before running it locally.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGES_DIR, isNoteFile } from "../src/build/changeNotes.ts";
import { BOT_BRANCH, RELEASE_BRANCH, checkFeature, checkRelease, type Change, type Tree } from "../src/build/versionCheck.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
const git = (args: string[]): string => run("git", args);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function tree(rev: string): Tree {
  return {
    read(path) {
      try {
        return git(["show", `${rev}:${path}`]);
      } catch {
        return null;
      }
    },
    notes() {
      return git(["ls-tree", "--name-only", rev, `${CHANGES_DIR}/`])
        .split("\n")
        .filter(Boolean)
        .map((p) => p.slice(CHANGES_DIR.length + 1))
        .filter(isNoteFile);
    },
  };
}

const base = arg("--base") ?? git(["merge-base", "origin/main", "HEAD"]).trim();
const branch = arg("--branch") || git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
const changes: Change[] = git(["-c", "core.quotepath=off", "diff", "--name-status", "--no-renames", base, "HEAD"])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, path] = line.split("\t");
    return { status: status[0] as Change["status"], path };
  });

let errors: string[];
if (RELEASE_BRANCH.test(branch)) {
  errors = checkRelease(tree(base), tree("HEAD"), changes);
} else {
  const deployed = new Set<string>();
  const paths = changes.map((c) => c.path);
  for (let i = 0; i < paths.length; i += 500) {
    const out = run("bash", ["scripts/vercel-ignore-build.sh", "--classify", ...paths.slice(i, i + 500)]);
    for (const line of out.split("\n")) if (line.startsWith("build ")) deployed.add(line.slice("build ".length));
  }
  errors = checkFeature(tree(base), tree("HEAD"), changes, deployed, BOT_BRANCH.test(branch));
}

const kind = RELEASE_BRANCH.test(branch) ? "release PR" : "feature PR";
if (errors.length > 0) {
  console.error(`version-check (${kind} ${branch} against ${base.slice(0, 12)}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`version-check: ${kind} ${branch} is consistent with ${base.slice(0, 12)} (${changes.length} changed files).`);
