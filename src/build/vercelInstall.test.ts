import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(__dirname, "../../scripts/vercel-install.sh");

let dir: string;
let calls: string;
let project: string;
let bin: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vc-install-"));
  calls = join(dir, "npm-calls.log");
  project = join(dir, "project");
  bin = join(dir, "bin");
  mkdirSync(project);
  mkdirSync(bin);
  writeFileSync(join(project, "package.json"), '{ "name": "p" }\n');
  writeFileSync(join(project, "package-lock.json"), '{ "lockfileVersion": 3 }\n');
  // A stand-in npm: `--version` answers, `ci` logs its arguments and does what
  // npm ci does to node_modules (deletes it, then installs).
  writeFileSync(
    join(bin, "npm"),
    `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo 11.0.0; exit 0; fi
echo "$*" >> "${calls}"
if [ "$1" = "ci" ]; then
  [ -n "\${NPM_FAIL:-}" ] && exit 1
  rm -rf "${project}/node_modules"; mkdir -p "${project}/node_modules/dep"
  echo '{ "installed": true }' > "${project}/node_modules/.package-lock.json"
fi
`,
  );
  chmodSync(join(bin, "npm"), 0o755);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function install(env: Record<string, string> = {}): void {
  execFileSync("bash", [script, project], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VERCEL_ENV: "preview", ...env },
    stdio: "pipe",
  });
}
const npmCalls = (): string[] => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);

describe("scripts/vercel-install.sh", () => {
  it("runs npm ci on a cold cache, then keeps the install while nothing it depends on changed", () => {
    install();
    expect(npmCalls()).toEqual([`ci --prefix ${project} --no-audit --no-fund`]);
    install();
    expect(npmCalls()).toHaveLength(1);
  });

  it("installs again when the lockfile or package.json changes", () => {
    install();
    writeFileSync(join(project, "package-lock.json"), '{ "lockfileVersion": 3, "packages": {} }\n');
    install();
    expect(npmCalls()).toHaveLength(2);
    writeFileSync(join(project, "package.json"), '{ "name": "p", "version": "2.0.0" }\n');
    install();
    expect(npmCalls()).toHaveLength(3);
  });

  it("always runs npm ci outside a preview: production, development or unset", () => {
    install();
    install({ VERCEL_ENV: "production" });
    install({ VERCEL_ENV: "production" });
    install({ VERCEL_ENV: "development" });
    install({ VERCEL_ENV: "" });
    expect(npmCalls()).toHaveLength(5);
  });

  it("installs again when something changed the tree after npm ci (the hidden lockfile moved)", () => {
    install();
    // What Vercel's own post-build install does to a cached tree.
    writeFileSync(join(project, "node_modules/.package-lock.json"), '{ "installed": true, "changed": 2 }\n');
    install();
    expect(npmCalls()).toHaveLength(2);
    install();
    expect(npmCalls()).toHaveLength(2);
  });

  it("leaves no stamp after a failed install, so the next build installs again", () => {
    install();
    writeFileSync(join(project, "package-lock.json"), '{ "lockfileVersion": 3, "x": 1 }\n');
    expect(() => install({ NPM_FAIL: "1" })).toThrow();
    expect(existsSync(join(project, "node_modules/.vc-install-stamp"))).toBe(false);
    install();
    expect(npmCalls()).toHaveLength(3);
  });
});
