import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The engine's npm package (`@<owner>/verticopolis-engine` on GitHub
 * Packages) ships its own README, `packages/verticopolis-engine/README.md`, which
 * `release-tag.yml` copies into the package with the browser build's
 * declarations. Without it the package page shows the repository's README.
 * This guard keeps the copy in the workflow, and keeps every binding call the
 * README names a real export of the declared binding
 * (`src/dualrun/engine.d.ts`), so a rename or a removal fails here until the
 * README follows.
 */
const root = resolve(__dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const readme = read("packages/verticopolis-engine/README.md");
// Read so a missing file fails here, not in the release run that copies it.
const webDeclarations = read("packages/verticopolis-engine/web.d.ts");
const workflow = read(".github/workflows/release-tag.yml");
const declared = read("src/dualrun/engine.d.ts");

const exportsDeclared = new Set([
  ...[...declared.matchAll(/^ {4}(?:static )?(\w+)\(/gm)].map((m) => m[1]!),
  ...[...declared.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]!),
]);

/** Calls the README names: `name(` in an inline code span, `Engine.name(`,
 *  and `engine.name(` in the examples. */
function namedCalls(text: string): string[] {
  const names = new Set<string>();
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    for (const call of span[1]!.matchAll(/(?:^|[\s,.])(\w+)\(/g)) names.add(call[1]!);
  }
  for (const call of text.matchAll(/\b(?:engine|Engine)\.(\w+)\(/g)) names.add(call[1]!);
  return [...names].sort();
}

// Names the README writes as calls that are not binding exports.
const notBinding = new Set(["init", "initSync", "require", "stringify", "URL"]);

describe("engine package README", () => {
  it("is packed into the published package with the browser declarations", () => {
    expect(webDeclarations).toContain('export * from "../node/verticopolis_engine";');
    expect(workflow).toContain("cp packages/verticopolis-engine/README.md npm/README.md");
    expect(workflow).toContain("cp packages/verticopolis-engine/web.d.ts npm/web/verticopolis_engine.d.ts");
  });

  it("names only calls the binding exports", () => {
    const calls = namedCalls(readme).filter((name) => !notBinding.has(name));
    expect(calls.length).toBeGreaterThan(30);
    expect(calls.filter((name) => !exportsDeclared.has(name))).toEqual([]);
  });
});
