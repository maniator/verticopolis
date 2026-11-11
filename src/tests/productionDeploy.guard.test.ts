import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./guardFiles";

/**
 * Production deploys from a release tag (#1882): release-tag.yml dispatches
 * .github/workflows/deploy-production.yml, which builds and deploys with the
 * Vercel CLI, and Vercel's own git integration no longer deploys `main`. The
 * deploy job holds the account's Vercel token, so this pins what keeps that
 * token away from untrusted code and what keeps production on the tag path.
 */

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");
const DEPLOY = ".github/workflows/deploy-production.yml";

/** The top-level `on:` block of a workflow, up to the next top-level key. */
function triggerBlock(workflow: string): string {
  const match = /^on:\n((?:[ \t]+.*\n|\n)*)/m.exec(workflow);
  if (!match) throw new Error("the workflow has no top-level on: block");
  return match[1];
}

describe("production deploys from release tags", () => {
  it("turns off Vercel's git deploys for main and leaves every other branch on", () => {
    const config = JSON.parse(read("vercel.json")) as { git?: { deploymentEnabled?: unknown } };
    expect(config.git?.deploymentEnabled).toEqual({ main: false });
  });

  it("starts the deploy only by dispatch, never from a push or a pull request", () => {
    const triggers = triggerBlock(read(DEPLOY));
    const events = [...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
    expect(events).toEqual(["workflow_dispatch"]);
  });

  it("runs in the production environment, one deploy at a time, never cancelling one", () => {
    const deploy = read(DEPLOY);
    expect(deploy).toMatch(/^ {4}environment: production$/m);
    expect(deploy).toMatch(/^concurrency:\n {2}group: production-deploy\n {2}cancel-in-progress: false$/m);
  });

  it("keeps no git credentials in the checkout", () => {
    const deploy = read(DEPLOY);
    const checkouts = deploy.match(/uses: actions\/checkout@/g) ?? [];
    const without = deploy.match(/persist-credentials: false/g) ?? [];
    expect(checkouts.length).toBeGreaterThan(0);
    expect(without.length).toBe(checkouts.length);
  });

  it("installs the Vercel CLI at one exact version", () => {
    const installs = [...read(DEPLOY).matchAll(/npm install --global (\S+)/g)].map((m) => m[1]);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toMatch(/^vercel@\d+\.\d+\.\d+$/);
  });

  it("refuses a commit the release gate would not deploy", () => {
    expect(read(DEPLOY)).toMatch(/VERCEL_ENV=production bash scripts\/vercel-ignore-build\.sh/);
  });

  it("reads the Vercel secrets only in the deploy workflow", () => {
    const others = readdirSync(join(repoRoot, ".github/workflows"))
      .map((name) => `.github/workflows/${name}`)
      .filter((path) => path !== DEPLOY);
    expect(others.length).toBeGreaterThan(0);
    for (const workflow of others) expect(read(workflow), workflow).not.toMatch(/secrets\.VERCEL_/);
    expect(read(DEPLOY)).toMatch(/secrets\.VERCEL_TOKEN/);
  });

  it("is dispatched by release-tag.yml for an app release and for a crate-only release", () => {
    const release = read(".github/workflows/release-tag.yml");
    const dispatches = release.match(/gh workflow run deploy-production\.yml --ref main -f tag=/g) ?? [];
    expect(dispatches).toHaveLength(2);
  });
});
