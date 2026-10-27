import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveShotEngine } from "../../scripts/screenshot-engine.ts";

/**
 * The committed gallery is the Rust engine's (#1353): the generator hosts the
 * tower on the WASM engine unless told otherwise, the reusable capture
 * defaults to it, and in the drift check the required gate works from that
 * render while the TypeScript engine is only the report-only parity leg. These
 * pins keep a later edit from quietly handing the committed pixels back to
 * the TypeScript engine, or making the parity leg a gate.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** The text of one top-level job of a workflow, up to the next job. */
function job(yaml: string, name: string): string {
  const start = yaml.search(new RegExp(`^ {2}${name}:\\s*$`, "m"));
  expect(start, `job ${name} must exist`).toBeGreaterThan(-1);
  const rest = yaml.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][a-z0-9-]*:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("the screenshot generator's engine", () => {
  it("is the Rust engine unless the TypeScript parity leg asks for it", () => {
    expect(resolveShotEngine(undefined)).toBe("wasm");
    expect(resolveShotEngine("")).toBe("wasm");
    expect(resolveShotEngine(" wasm ")).toBe("wasm");
    expect(resolveShotEngine("ts")).toBe("ts");
  });

  it("refuses a typo instead of rendering one engine under the other's label", () => {
    expect(() => resolveShotEngine("rust")).toThrow(/not an engine/);
    expect(() => resolveShotEngine("TS")).toThrow(/not an engine/);
  });
});

describe("the drift check's engines", () => {
  const capture = read(".github/workflows/screenshot-capture.yml");
  const drift = read(".github/workflows/pr-drift-check.yml");

  it("renders on the Rust engine by default and names the TypeScript artifacts apart", () => {
    expect(capture).toMatch(/engine:\n(?: {8}.*\n)+? {8}required: false\n {8}default: wasm\n/);
    expect(capture).toContain("inputs.engine == 'ts' && 'engine-ts-' || ''");
    // Only the Rust leg stops at a failed render; the parity leg uploads what rendered.
    expect(capture).toContain('[ "$VC_SHOT_ENGINE" = "wasm" ]');
  });

  it("gates and commits from the Rust capture, and only reports from the TypeScript one", () => {
    const rust = job(drift, "capture");
    expect(rust).not.toMatch(/engine:/);
    expect(job(drift, "capture-ts")).toMatch(/engine: ts\b/);
    for (const gated of ["verify-drift", "commit-on-approval", "drift-gate"]) {
      const text = job(drift, gated);
      expect(text, `${gated} reads the Rust capture`).toMatch(/needs: .*\bcapture\b/);
      expect(text, `${gated} must not wait on the TypeScript leg`).not.toContain("capture-ts");
    }
    expect(job(drift, "engine-parity")).toMatch(/needs: \[changes, capture, capture-ts\]/);
  });
});
