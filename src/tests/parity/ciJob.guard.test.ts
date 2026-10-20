import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "../guardFiles";

/**
 * `npm run test:wasm:parity` and the `test-wasm-parity` job in
 * `.github/workflows/test.yml` run the same two projects (#878, #945's "Unit
 * and integration" row). The job splits them across a matrix to run side by
 * side; this keeps the script a developer runs and the job CI runs from
 * drifting apart, keeps both on the real engine (`VC_REQUIRE_WASM=1`), and
 * keeps the job from being skipped or allowed to fail. Whether the job is a
 * required check is branch protection, not the workflow (backlog row
 * `wasm-parity-required-check`, #1082).
 */
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf8");

/** The workflow text without comment lines or trailing comments. */
const withoutComments = (text: string) =>
  text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s+#.*$/, ""))
    .join("\n");

/** The job's lines (after its key, up to the next two-space key) and its steps. */
function jobBlock(workflow: string): { lines: string[]; steps: string[][] } {
  const all = withoutComments(workflow).split("\n");
  const start = all.findIndex((l) => /^ {2}test-wasm-parity:\s*$/.test(l));
  if (start < 0) return { lines: [], steps: [] };
  let end = all.length;
  for (let i = start + 1; i < all.length; i++) {
    if (/^ {2}[\w-]+:/.test(all[i])) {
      end = i;
      break;
    }
  }
  const lines = all.slice(start + 1, end);
  const steps: string[][] = [];
  for (const l of lines) {
    if (/^ {6}- /.test(l)) steps.push([l]);
    else if (steps.length > 0) steps[steps.length - 1].push(l);
  }
  return { lines, steps };
}

describe("the WASM parity CI job", () => {
  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
  const script = scripts["test:wasm:parity"] ?? "";
  const { lines, steps } = jobBlock(read(".github/workflows/test.yml"));
  const job = lines.join("\n");
  const vitestStep = steps.find((s) => s.some((l) => /run: npx vitest run /.test(l))) ?? [];

  it("exists, and the script it mirrors exists", () => {
    expect(script).not.toBe("");
    expect(job).not.toBe("");
  });

  it("runs the projects the script runs", () => {
    const fromScript = [...script.matchAll(/--project (\w+)/g)].map((m) => m[1]).sort();
    const matrix = /project: \[([^\]]+)\]/.exec(job)?.[1] ?? "";
    const fromJob = matrix.split(",").map((p) => p.trim()).filter(Boolean).sort();
    expect(fromScript).toEqual(["integrationWasm", "unitWasm"]);
    expect(fromJob).toEqual(fromScript);
  });

  it("reports the two check names branch protection requires (#1082)", () => {
    // A required check matches the name GitHub shows: the job key plus the
    // matrix value, as long as the job sets no `name:` of its own. Renaming
    // the job, a project or adding a `name:` would leave a required check
    // waiting for a name that never reports.
    expect(job).not.toMatch(/^ {4}name:/m);
    const matrix = /project: \[([^\]]+)\]/.exec(job)?.[1] ?? "";
    const names = matrix
      .split(",")
      .map((p) => `test-wasm-parity (${p.trim()})`)
      .sort();
    expect(names).toEqual(["test-wasm-parity (integrationWasm)", "test-wasm-parity (unitWasm)"]);
  });

  it("is a plain gate: after the engine build, never skipped, never allowed to fail", () => {
    expect(job).toMatch(/^ {4}needs: (engine-wasm|\[[^\]]*\bengine-wasm\b[^\]]*\])$/m);
    expect(job).not.toMatch(/\bif:/); // job level or any step
    expect(job).not.toMatch(/continue-on-error/);
  });

  it("runs the matrix project through vitest, on the real engine, in that step", () => {
    expect(vitestStep.join("\n")).toMatch(/run: npx vitest run --project \$\{\{ matrix\.project \}\}$/m);
    expect(vitestStep.join("\n")).toMatch(/^ {10}VC_REQUIRE_WASM: "1"$/m);
    expect(script).toContain("VC_REQUIRE_WASM=1");
  });

  it("gets the engine package before the tests", () => {
    const at = (needle: RegExp) => steps.findIndex((s) => needle.test(s.join("\n")));
    const engine = at(/uses: \.\/\.github\/actions\/engine-wasm\b/);
    expect(engine).toBeGreaterThanOrEqual(0);
    expect(engine).toBeLessThan(steps.indexOf(vitestStep));
  });
});
