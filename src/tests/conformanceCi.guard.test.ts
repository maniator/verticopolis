import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./guardFiles";

/**
 * The engine conformance suite is too slow to share a runner with the coverage
 * run (`holidays-classic` took 61 s of its 60 s limit there), so the `test` job
 * runs coverage without it and runs it in its own step without coverage. This
 * keeps those two steps paired in that job: the file stays out of the coverage
 * run and runs, exactly as written below, on every run.
 */
const FILE = "conformance.integration.test.ts";
const lines = readFileSync(resolve(repoRoot, ".github/workflows/test.yml"), "utf8")
  .split("\n")
  .map((l) => l.replace(/\r$/, ""))
  .filter((l) => !/^\s*#/.test(l))
  .map((l) => l.replace(/\s+#.*$/, ""));

/** The steps (each a list of lines) of the `test` job. */
function testJobSteps(): string[][] {
  const start = lines.findIndex((l) => /^ {2}test:\s*$/.test(l));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^ {2}[\w-]+:/.test(l));
  const steps: string[][] = [];
  for (const l of lines.slice(start + 1, end < 0 ? undefined : end)) {
    if (/^ {6}- /.test(l)) steps.push([l.replace(/^ {6}- /, "")]);
    else if (steps.length > 0) steps[steps.length - 1].push(l.replace(/^ {8}/, ""));
  }
  return steps.map((s) => s.filter((l) => l.trim() !== ""));
}

describe("conformance in the test job", () => {
  const steps = testJobSteps();
  const named = (name: string) => steps.findIndex((s) => s[0] === `name: ${name}`);
  const coverage = steps[named("Run tests")] ?? [];
  const conformance = steps[named("Engine conformance (no coverage)")] ?? [];

  it("is excluded from the coverage run", () => {
    expect(coverage).toEqual(["name: Run tests", `run: npm run test:coverage -- --run --exclude '**/${FILE}'`]);
  });

  it("runs in its own step after the coverage run, with nothing that could make it pass without running", () => {
    expect(named("Engine conformance (no coverage)")).toBeGreaterThan(named("Run tests"));
    // An install step that went missing would make this -1 and pass the
    // ordering check below on its own.
    expect(named("Install dependencies")).toBeGreaterThanOrEqual(0);
    expect(named("Run tests")).toBeGreaterThan(named("Install dependencies"));
    expect(conformance).toEqual([
      "name: Engine conformance (no coverage)",
      "if: ${{ !cancelled() }}",
      // `npm exec --no` never fetches from the registry: the step also runs
      // after a failed install, where `npx` would run an unpinned vitest.
      "run: npm exec --no -- vitest run --project integration conformance.integration",
    ]);
    // The positional filter is a substring match on the file path.
    expect(FILE.startsWith("conformance.integration")).toBe(true);
  });

  it("names a file that exists", () => {
    expect(readFileSync(resolve(repoRoot, "src/tests/integration", FILE), "utf8")).toContain("engine conformance");
  });
});
