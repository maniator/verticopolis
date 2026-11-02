import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const switchableSpecPattern = /engineIdentity|saveWithoutRust|engineStatusRows|atlas|visual|perf/;

// The Playwright suite and the perf gate run on the Rust engine (#1353). The
// TypeScript engine has no lane: no second project, no second set of baselines
// and no smoke leg, so nothing drifts back to dual-engine runs.

const root = resolve(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");

describe("the end-to-end suite's engines", () => {
  const config = read("playwright.config.ts");
  const test = read(".github/workflows/test.yml");

  it("has one switchable project, on the Rust engine", () => {
    expect(config).toContain('name: "chromium-wasm"');
    expect(config).not.toMatch(/name: "chromium"[,\s]/);
    expect(config).toContain('value: "wasm"');
    expect(config).toMatch(/snapshotPathTemplate: ".*\{arg\}-chromium\{-snapshotSuffix\}\{ext\}"/);
    expect(switchableSpecPattern.test("engineIdentity.spec.ts")).toBe(true);
    expect(switchableSpecPattern.test("wasmOnly.spec.ts")).toBe(false);
  });

  it("keeps the switchable lane restricted to switchable-only specs", () => {
    const all = [
      "engineIdentity.spec.ts",
      "saveWithoutRust.spec.ts",
      "engineStatusRows.spec.ts",
      "atlas.spec.ts",
      "visual.spec.ts",
      "perf.spec.ts",
      "wasmOnly.spec.ts",
      "offline.spec.ts",
      "milestones.spec.ts",
    ];
    expect(all.filter((file) => switchableSpecPattern.test(file))).toEqual([
      "engineIdentity.spec.ts",
      "saveWithoutRust.spec.ts",
      "engineStatusRows.spec.ts",
      "atlas.spec.ts",
      "visual.spec.ts",
      "perf.spec.ts",
    ]);
    expect(switchableSpecPattern.test("wasmOnly.spec.ts")).toBe(false);
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
    expect(test).toMatch(/name: Perf gate \(E5-S0\)\n\s+run: npm run perf\n\s+#|name: Perf gate \(E5-S0\)\n\s+run: npm run perf\n\n/);
    expect(read(".github/workflows/update-perf-baseline.yml")).toMatch(/npm run perf:capture\n\n/);
  });
});
