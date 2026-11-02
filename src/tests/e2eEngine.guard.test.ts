import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DUAL_LANE_SPECS,
  SWITCHABLE_LANE_SPECS,
  SWITCHABLE_ONLY_SPECS,
  runsInSwitchable,
  runsInWasmOnly,
} from "./playwrightLaneSelection";

// The Playwright suite and the perf gate run on the Rust engine (#1353). The
// TypeScript engine has no lane: no second project, no second set of baselines
// and no smoke leg, so nothing drifts back to dual-engine runs.

const root = resolve(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");
const e2eSpecs = (): string[] =>
  readdirSync(resolve(root, "e2e"))
    .filter((name) => name.endsWith(".spec.ts"))
    .sort();
const asSpecs = (names: readonly string[]): string[] => names.map((name) => `${name}.spec.ts`).sort();
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const fromJob = (workflow: string, jobName: string): string => {
  const escaped = jobName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = workflow.match(new RegExp(`\\n  ${escaped}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|$)`));
  return match?.[1] ?? "";
};

describe("the end-to-end suite's engines", () => {
  const config = read("playwright.config.ts");
  const workflow = read(".github/workflows/test.yml");
  const e2eJob = fromJob(workflow, "e2e");
  const wasmOnlyJob = fromJob(workflow, "e2e-wasm-only");

  it("has one switchable project, on the Rust engine", () => {
    expect(config).toContain('name: "chromium-wasm"');
    expect(config).not.toMatch(/name: "chromium"[,\s]/);
    expect(config).toContain('value: "wasm"');
    expect(config).toMatch(/snapshotPathTemplate: ".*\{arg\}-chromium\{-snapshotSuffix\}\{ext\}"/);
    expect(config).toContain('from "./src/tests/playwrightLaneSelection"');
  });

  it("keeps the effective lane selection locked for every discovered e2e spec", () => {
    const discovered = e2eSpecs();
    const switchable = discovered.filter(runsInSwitchable);
    const wasmOnly = discovered.filter(runsInWasmOnly);
    const allCovered = unique([...switchable, ...wasmOnly]).sort();
    const both = switchable.filter((spec) => wasmOnly.includes(spec));
    const switchableOnly = switchable.filter((spec) => !wasmOnly.includes(spec)).sort();
    const wasmOnlyOnly = wasmOnly.filter((spec) => !switchable.includes(spec)).sort();

    expect(allCovered).toEqual(discovered);
    expect(switchableOnly).toEqual(asSpecs(SWITCHABLE_ONLY_SPECS));
    expect(both.sort()).toEqual(asSpecs(DUAL_LANE_SPECS));
    expect(switchable).toEqual(asSpecs(SWITCHABLE_LANE_SPECS));
    expect(wasmOnlyOnly).toContain("wasmOnly.spec.ts");
    expect(wasmOnlyOnly).toContain("milestones.spec.ts");
  });

  it("keeps the real Playwright lane wiring and CI ownership in place", () => {
    expect(config).toContain('testIgnore: [/wasmOnly\\.spec\\.ts/, GENERAL_SPEC_PATTERN]');
    expect(config).toContain('testIgnore: [/visual\\.spec\\.ts/, SWITCHABLE_ONLY_SPEC_PATTERN]');
    expect(workflow).toMatch(/\n {2}e2e:\n/);
    expect(workflow).toMatch(/\n {2}e2e-wasm-only:\n/);

    expect(e2eJob).toContain("- name: Run end-to-end tests");
    expect(e2eJob).toContain("run: npm run e2e");
    expect(e2eJob).toContain("- name: Perf gate (E5-S0)");
    expect(e2eJob).toContain("run: npm run perf");
    expect(e2eJob).not.toContain("- name: Upload milestone screenshots");

    expect(wasmOnlyJob).toContain("- name: Build (wasm-only, player)");
    expect(wasmOnlyJob).toContain("- name: Build (wasm-only, tooling)");
    expect(wasmOnlyJob).toContain("- name: The bundle guard catches a TypeScript step loop import");
    expect(wasmOnlyJob).toContain("run: npx playwright test --grep-invert @perf");
    expect(wasmOnlyJob).toContain("PW_WASM_ONLY: \"1\"");
    expect(wasmOnlyJob).toContain("- name: Upload milestone screenshots");
    expect(wasmOnlyJob).toContain("name: milestone-screenshots");
    expect(wasmOnlyJob).toContain("path: e2e/output/milestones/");
    expect(wasmOnlyJob).toContain("if-no-files-found: error");
    expect(read("e2e/perf.spec.ts")).toContain("test.describe.configure({ retries: 0 });");
  });

  it("keeps the parity-leg switches gone", () => {
    for (const rel of ["playwright.config.ts", ".github/workflows/test.yml", ".github/workflows/pr-drift-check.yml", ".github/workflows/update-visual-baselines.yml"]) {
      expect(read(rel), rel).not.toContain("PW_WASM_VISUAL");
    }
    expect(read(".github/workflows/pr-drift-check.yml")).not.toContain("engine-parity-visual:");
    expect(read(".github/workflows/update-visual-baselines.yml")).not.toMatch(/^ {2}engine-parity:/m);
  });

  it("has no TypeScript engine lane: no switch, no smoke test, no script, no perf pin", () => {
    for (const rel of ["playwright.config.ts", ".github/workflows/test.yml", ".github/workflows/update-perf-baseline.yml", "e2e/helpers.ts"]) {
      expect(read(rel), rel).not.toMatch(/PW_ENGINE|chromium-ts|TS_PROJECT|ts-smoke/);
    }
    expect(JSON.parse(read("package.json")).scripts["e2e:ts"]).toBeUndefined();
    expect(workflow).toMatch(/name: Perf gate \(E5-S0\)\n\s+run: npm run perf\n\s+#|name: Perf gate \(E5-S0\)\n\s+run: npm run perf\n\n/);
    expect(read(".github/workflows/update-perf-baseline.yml")).toMatch(/npm run perf:capture\n\n/);
  });
});
