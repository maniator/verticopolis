import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Playwright suite runs on the Rust engine (#1353). The TypeScript engine is
// a flag on the same project (PW_ENGINE=ts), not a second project or a second
// set of baselines, so players still on it keep a smoke test and nothing else
// drifts back to dual-engine legs.

const root = resolve(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");

describe("the end-to-end suite's engines", () => {
  const config = read("playwright.config.ts");
  const test = read(".github/workflows/test.yml");

  it("has one project per engine setting, and the Rust one is the default", () => {
    expect(config).toContain('name: TS_ENGINE ? "chromium-ts" : "chromium-wasm"');
    expect(config).not.toMatch(/name: "chromium"[,\s]/);
    expect(config).toContain('value: TS_ENGINE ? "ts" : "wasm"');
    // The visual baselines are the Rust engine's: the TypeScript run never reads them.
    expect(config).toMatch(/testIgnore: TS_ENGINE \? \[\/visual\\\.spec\\\.ts\//);
    expect(config).toMatch(/snapshotPathTemplate: ".*\{arg\}-chromium\{-snapshotSuffix\}\{ext\}"/);
  });

  it("keeps the parity-leg switches gone", () => {
    for (const rel of ["playwright.config.ts", ".github/workflows/test.yml", ".github/workflows/pr-drift-check.yml", ".github/workflows/update-visual-baselines.yml"]) {
      expect(read(rel), rel).not.toContain("PW_WASM_VISUAL");
    }
    expect(read(".github/workflows/pr-drift-check.yml")).not.toContain("engine-parity-visual:");
    expect(read(".github/workflows/update-visual-baselines.yml")).not.toMatch(/^ {2}engine-parity:/m);
  });

  it("runs the TypeScript smoke test and the TypeScript perf baseline in CI", () => {
    expect(test).toContain("npm run e2e:ts -- --grep @ts-smoke");
    expect(test).toMatch(/name: Perf gate \(E5-S0\)\n\s+run: npm run perf\n\s+env:\n\s+PW_ENGINE: "ts"/);
    expect(read(".github/workflows/update-perf-baseline.yml")).toMatch(/npm run perf:capture\n\s+env:\n\s+PW_ENGINE: "ts"/);
    expect(JSON.parse(read("package.json")).scripts["e2e:ts"]).toBe("cross-env PW_ENGINE=ts playwright test --grep-invert @perf");
  });

  it("tags at least one existing test @ts-smoke and adds no TypeScript-only spec file", () => {
    const specs = readdirSync(resolve(root, "e2e")).filter((f) => f.endsWith(".spec.ts"));
    const tagged = specs.filter((f) => read(`e2e/${f}`).includes('tag: "@ts-smoke"'));
    expect(tagged.length).toBeGreaterThan(0);
    expect(specs.filter((f) => /ts|typescript/i.test(f.replace(/\.spec\.ts$/, "")) && !/ts-?smoke/.test(f)).filter((f) => /^(ts|typescript)/i.test(f))).toEqual([]);
  });
});
