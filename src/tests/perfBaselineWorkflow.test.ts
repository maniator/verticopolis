import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { repoRoot } from "./guardFiles";
import { MIN_MINT_PASSES } from "./perfBaseline";

/**
 * update-perf-baseline.yml (#900): the step that decides which engine a run
 * mints, how many passes it takes and whether it may commit, run as the
 * workflow runs it, plus the wiring of the job that measures and commits.
 */
const lines = readFileSync(resolve(repoRoot, ".github/workflows/update-perf-baseline.yml"), "utf8")
  .split("\n")
  .map((l) => l.replace(/\r$/, ""));

/** The lines of one job, from its key to the next job's. */
function job(name: string): string[] {
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^ {2}[\w-]+:\s*$/.test(l));
  return lines.slice(start, end < 0 ? undefined : end);
}

/** The lines of the step named `name` (or with that id) in a job. */
function step(jobLines: string[], name: string): string[] {
  const start = jobLines.findIndex((l) => l === `      - name: ${name}` || l === `      - id: ${name}`);
  if (start < 0) return [];
  const end = jobLines.findIndex((l, i) => i > start && /^ {6}- /.test(l));
  return jobLines.slice(start, end < 0 ? undefined : end);
}

/** A step's `run: |` block as the script the runner executes. */
function script(stepLines: string[]): string {
  const at = stepLines.findIndex((l) => l === "        run: |");
  if (at < 0) return "";
  const body: string[] = [];
  for (const l of stepLines.slice(at + 1)) {
    if (l.trim() !== "" && !l.startsWith("          ")) break;
    body.push(l.slice(10));
  }
  return body.join("\n");
}

const engineStep = script(step(job("resolve-image"), "engine"));
const bash = spawnSync("bash", ["-c", "true"]).status === 0;
const scratch = mkdtempSync(join(tmpdir(), "perf-baseline-workflow-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let runs = 0;
/** Run the engine step with these variables, as GitHub runs a `run:` step
 *  (`bash -e`), and read what it wrote to GITHUB_OUTPUT. */
function decide(env: Record<string, string>): { status: number | null; outputs: Record<string, string>; text: string } {
  const output = join(scratch, `out-${runs++}`);
  const r = spawnSync("bash", ["-e", "-c", engineStep], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: output, EVENT: "push", INPUT_ENGINE: "", INPUT_PASSES: "", INPUT_DRY_RUN: "", MESSAGE: "", REF_NAME: "claude/branch", REF_TYPE: "branch", ...env },
  });
  let outputs: Record<string, string> = {};
  try {
    outputs = Object.fromEntries(
      readFileSync(output, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
  } catch {
    /* the step refused before writing anything */
  }
  return { status: r.status, outputs, text: `${r.stdout}${r.stderr}` };
}

describe("update-perf-baseline.yml, which engine a run mints", () => {
  it("has the step's script to run", () => {
    expect(engineStep).toMatch(/GITHUB_OUTPUT/);
  });

  it.skipIf(!bash)("mints the engine a push names, five passes, committing", () => {
    expect(decide({ MESSAGE: "Mint it\n\n[update-perf-baseline:wasm]" })).toMatchObject({ status: 0, outputs: { engine: "wasm", project: "chromium-wasm", passes: "5", dry_run: "false" } });
    expect(decide({ MESSAGE: "[update-perf-baseline:ts] on purpose" }).outputs).toEqual({ engine: "ts", project: "chromium", passes: "5", dry_run: "false" });
  });

  it.skipIf(!bash)("refuses a push that names no engine, both engines, or another name", () => {
    for (const MESSAGE of ["[update-perf-baseline]", "[update-perf-baseline:ts] and [update-perf-baseline:wasm]", "[update-perf-baseline:rust]"]) {
      const r = decide({ MESSAGE });
      expect(r.status, MESSAGE).not.toBe(0);
      expect(r.outputs, MESSAGE).toEqual({});
      expect(r.text, MESSAGE).toMatch(/name exactly one engine/);
    }
  });

  it.skipIf(!bash)(`takes a dispatch's engine and passes, from ${MIN_MINT_PASSES} to 10`, () => {
    const dispatch = (INPUT_PASSES: string, more: Record<string, string> = {}) => decide({ EVENT: "workflow_dispatch", INPUT_ENGINE: "wasm", INPUT_PASSES, INPUT_DRY_RUN: "false", ...more });
    expect(dispatch("7").outputs).toEqual({ engine: "wasm", project: "chromium-wasm", passes: "7", dry_run: "false" });
    expect(dispatch("10").status).toBe(0);
    for (const passes of ["1", "4", "11", "20", "5.5", "five", ""]) {
      const r = dispatch(passes);
      expect(r.status, passes).not.toBe(0);
      expect(r.text, passes).toMatch(/passes must be a whole number from 5 to 10/);
    }
    // The workflow's lower bound is the mint script's.
    expect(MIN_MINT_PASSES).toBe(5);
  });

  it.skipIf(!bash)("refuses a committing run on main or a tag, and lets a dry run go anywhere", () => {
    const base = { EVENT: "workflow_dispatch", INPUT_ENGINE: "ts", INPUT_PASSES: "5" };
    expect(decide({ ...base, INPUT_DRY_RUN: "false", REF_NAME: "main" })).toMatchObject({ status: 1, outputs: {} });
    expect(decide({ ...base, INPUT_DRY_RUN: "false", REF_NAME: "v3.0.0", REF_TYPE: "tag" })).toMatchObject({ status: 1, outputs: {} });
    expect(decide({ ...base, INPUT_DRY_RUN: "true", REF_NAME: "main" }).outputs).toEqual({ engine: "ts", project: "chromium", passes: "5", dry_run: "true" });
    // A push cannot ask for a dry run, so it always commits.
    expect(decide({ MESSAGE: "[update-perf-baseline:ts]", INPUT_DRY_RUN: "true" }).outputs.dry_run).toBe("false");
  });
});

describe("update-perf-baseline.yml, the jobs that measure and commit", () => {
  const update = job("update");

  it("builds the engine only after the run's engine is resolved", () => {
    expect(job("engine-wasm")).toContain("    needs: resolve-image");
    expect(update).toContain("    needs: [resolve-image, engine-wasm]");
  });

  it("measures the named project one pass at a time and mints from those passes", () => {
    expect(step(update, "Measure the engine")).toContain('        run: npm run perf:capture -- --project="$PROJECT" --repeat-each="$PASSES" --workers=1');
    expect(step(update, "Measure the engine")).toContain("          PERF_PASSES_DIR: perf-passes");
    expect(script(step(update, "Mint the entry from the passes"))).toMatch(/if \[ "\$DRY_RUN" = "true" \]; then flag="--dry-run"; fi\nnpx tsx scripts\/perf-baseline-mint\.ts "\$ENGINE" perf-passes "\$PASSES" \$flag/);
  });

  it("commits nothing on a dry run, and pushes only what it committed", () => {
    expect(step(update, "Commit refreshed baseline")).toContain("        if: needs.resolve-image.outputs.dry_run != 'true'");
    expect(step(update, "Push refreshed baseline")).toContain("        if: steps.commit.outputs.committed == 'true'");
    expect(script(step(update, "Commit refreshed baseline"))).toMatch(/git add e2e\/perf\/baseline\.json\n/);
  });

  it("keeps the passes even when the mint fails, under a name a re-run can reuse", () => {
    const keep = step(update, "Keep the passes");
    expect(keep).toContain("        if: always()");
    expect(keep).toContain("          overwrite: true");
  });

  it("fails a push whose rebase conflicts instead of reporting the remote tip as pushed", () => {
    expect(script(step(update, "Push refreshed baseline"))).toMatch(/if ! git -C "\$pushdir" .* rebase FETCH_HEAD; then[\s\S]*exit 1/);
  });
});
