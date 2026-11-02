import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard the CI-only worker policy for the wasm-only Playwright lane.
 *
 * The lane runs with two workers only on CI when `PW_WASM_ONLY=1`; all other
 * runs stay on the local single-worker default. This keeps the faster job while
 * leaving the default local developer experience unchanged and avoids a YAML-only
 * policy that could drift.
 */

describe("playwright wasm-only worker policy", () => {
  it("keeps the default single worker locally and only doubles on CI wasm-only runs", () => {
    const source = readFileSync(resolve(__dirname, "..", "..", "playwright.config.ts"), "utf8");
    expect(source).toMatch(/workers:\s*process\.env\.CI\s*&&\s*process\.env\.PW_WASM_ONLY\s*===\s*["']1["']\s*\?\s*2\s*:\s*1/);
  });
});
