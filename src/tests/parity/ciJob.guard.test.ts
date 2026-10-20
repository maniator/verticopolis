import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "../guardFiles";

/**
 * `npm run test:wasm:parity` and the `test-wasm-parity` job in
 * `.github/workflows/test.yml` run the same two projects (#878, #945's "Unit
 * and integration" row). The job splits them across a matrix to run side by
 * side; this keeps the script a developer runs and the job CI runs from
 * drifting apart, and keeps both on the real engine (`VC_REQUIRE_WASM=1`).
 */
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf8");

describe("the WASM parity CI job", () => {
  const script = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts["test:wasm:parity"];
  const workflow = read(".github/workflows/test.yml");
  // The job's block: from its key to the next two-space key (any name, a trailing comment allowed).
  const job = /\n {2}test-wasm-parity:[^\n]*\n([\s\S]*?)(?=\n {2}[\w-]+:[^\n]*\n|$)/.exec(workflow)?.[1] ?? "";

  it("exists", () => {
    expect(job).not.toBe("");
  });

  it("runs the projects the script runs", () => {
    const fromScript = [...script.matchAll(/--project (\w+)/g)].map((m) => m[1]).sort();
    const matrix = /project: \[([^\]]+)\]/.exec(job)?.[1] ?? "";
    const fromJob = matrix.split(",").map((p) => p.trim()).filter(Boolean).sort();
    expect(fromScript).toEqual(["integrationWasm", "unitWasm"]);
    expect(fromJob).toEqual(fromScript);
  });

  it("is a plain gate: after the engine build, never skipped, never allowed to fail", () => {
    expect(job).toMatch(/(^|\n) {4}needs: engine-wasm\n/);
    expect(job).not.toMatch(/(^|\n) {4}if:/);
    expect(job).not.toMatch(/continue-on-error/);
  });

  it("runs the matrix project through vitest", () => {
    expect(job).toMatch(/run: npx vitest run --project \$\{\{ matrix\.project \}\}\n/);
  });

  it("requires the real engine in both", () => {
    expect(script).toContain("VC_REQUIRE_WASM=1");
    expect(job).toMatch(/VC_REQUIRE_WASM: "1"/);
    expect(job).toMatch(/uses: \.\/\.github\/actions\/engine-wasm/);
  });
});
