import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * Every integration suite that needs the engine package must be on the
 * `test:wasm:host` list. The main test job runs without the package, and the
 * engine host shards run only that list, so a suite gated on
 * `hasWasmPackage()` and left off it is skipped by every required job and
 * passes without running (review of #2054: the tall lobby suite did).
 * Vitest matches each list entry as a substring of a file's path.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function integrationSuites(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return integrationSuites(path);
    // Forward slashes on every OS, as the list entries and vitest filters use.
    return e.name.endsWith(".integration.test.ts") ? [relative(root, path).split(sep).join("/")] : [];
  });
}

describe("the engine host shards run every suite that needs the engine package", () => {
  const script = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts["test:wasm:host"];
  const filters = script.split(/\s+/).filter((w) => w && !w.startsWith("-") && !["vitest", "run", "integration"].includes(w));

  it("reads a list of suite filters", () => {
    expect(filters.length).toBeGreaterThan(10);
  });

  it("lists every integration suite gated on hasWasmPackage()", () => {
    const gated = integrationSuites(join(root, "src")).filter((f) => readFileSync(join(root, f), "utf8").includes("hasWasmPackage"));
    expect(gated).toContain("src/tests/integration/tallLobbyBuild.integration.test.ts");
    const unlisted = gated.filter((f) => !filters.some((filter) => f.includes(filter)));
    expect(unlisted).toEqual([]);
  });
});
