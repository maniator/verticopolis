import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Engine path list guard for `.github/workflows/engine-rs.yml` (#1044).
 *
 * The workflow names the engine's files twice: the `push.paths` filter, and
 * the `case` list in the `changes` job that decides whether a PR runs the
 * required `engine-rs` check. If a path lands in one list and not the other,
 * a PR touching only that file would skip the required check and pass it
 * unchecked. This test keeps the two lists identical, with each `**` glob in
 * `push.paths` written as `*` in the shell `case` list (a `case` `*` already
 * crosses `/`).
 */

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(
  here,
  "..",
  "..",
  ".github",
  "workflows",
  "engine-rs.yml",
);

function pushPaths(yaml: string): string[] {
  const block =
    /\n {2}push:\n {4}branches: \[main\]\n {4}paths:\n((?: {6}- "[^"]+"\n)+)/.exec(
      yaml,
    );
  if (!block) throw new Error("engine-rs.yml: push.paths block not found");
  return [...block[1].matchAll(/- "([^"]+)"/g)].map((m) =>
    m[1].replace(/\*\*$/, "*"),
  );
}

function casePaths(yaml: string): string[] {
  return [
    ...yaml.matchAll(/^ +case "\$f" in (\S+)\) engine=true ;; esac$/gm),
  ].map((m) => m[1]);
}

describe("engine-rs.yml engine path lists", () => {
  const yaml = readFileSync(workflowPath, "utf8");

  it("finds both lists", () => {
    expect(pushPaths(yaml).length).toBeGreaterThan(30);
    expect(casePaths(yaml).length).toBeGreaterThan(30);
  });

  it("names the same paths in the push filter and the PR changes job", () => {
    expect(casePaths(yaml)).toEqual(pushPaths(yaml));
  });

  it("uses only trailing ** globs, which map to a case *", () => {
    for (const p of pushPaths(yaml))
      expect(p.replace(/\/\*$/, "")).not.toMatch(/\*/);
  });

  it("fails when a path is missing from one list", () => {
    const dropped = yaml.replace(
      /^ +case "\$f" in \.nvmrc\) engine=true ;; esac\n/m,
      "",
    );
    expect(casePaths(dropped)).not.toEqual(pushPaths(dropped));
  });
});
