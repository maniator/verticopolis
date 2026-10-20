import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./guardFiles";

/**
 * The engine conformance suite is too slow to share a runner with the coverage
 * run (`holidays-classic` took 61 s of its 60 s limit there), so the `test` job
 * runs coverage without it and runs it in its own step without coverage. This
 * keeps those two steps paired: the file stays excluded from exactly one and
 * runs in the other, on every run.
 */
const workflow = readFileSync(resolve(repoRoot, ".github/workflows/test.yml"), "utf8")
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");
const FILE = "conformance.integration.test.ts";

describe("conformance in the test job", () => {
  it("is excluded from the coverage run", () => {
    expect(workflow).toContain(`run: npm run test:coverage -- --run --exclude '**/${FILE}'`);
  });

  it("runs in its own step, without coverage, even after an earlier step failed", () => {
    const step = workflow.split("\n      - ").find((s) => s.startsWith("name: Engine conformance (no coverage)")) ?? "";
    expect(step).toContain("if: ${{ !cancelled() }}");
    expect(step).toContain("run: npx vitest run --project integration conformance.integration");
    expect(step).not.toMatch(/--coverage|test:coverage/);
  });

  it("names a file that exists, and no other step excludes it", () => {
    expect(readFileSync(resolve(repoRoot, "src/tests/integration", FILE), "utf8")).toContain("engine conformance");
    expect(workflow.split(FILE).length - 1).toBe(1);
  });
});
