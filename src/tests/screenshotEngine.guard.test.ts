import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The gallery and its drift gate render on the Rust engine only (#1353). These
// checks pin the wiring so a second, TypeScript render does not drift back in.

const root = resolve(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");

describe("the screenshot gallery's engine", () => {
  it("defaults to the Rust engine and rejects an unknown engine", async () => {
    // A computed path keeps tsc's rootDir (src/) from pulling the script into the program.
    const script = "../../scripts/screenshot-engine.ts";
    const { resolveShotEngine } = (await import(/* @vite-ignore */ script)) as { resolveShotEngine: (raw: string | undefined) => string };
    expect(resolveShotEngine(undefined)).toBe("wasm");
    expect(resolveShotEngine("")).toBe("wasm");
    expect(resolveShotEngine("wasm")).toBe("wasm");
    expect(resolveShotEngine("ts")).toBe("ts");
    expect(() => resolveShotEngine("rust")).toThrow(/not an engine/);
  });

  it("renders once, on the Rust engine, in the reusable capture", () => {
    const capture = read(".github/workflows/screenshot-capture.yml");
    expect(capture).not.toMatch(/inputs\.engine/);
    expect(capture).not.toMatch(/VC_SHOT_ENGINE/);
    expect(capture).toContain("uses: ./.github/actions/engine-wasm\n");
    expect(capture).toContain("uses: ./.github/actions/engine-wasm-download\n");
    // A failed shard never uploads a partial set: the caller would read a missing image as deleted.
    expect(capture).toContain('if [ "$rc" -ne 0 ]; then exit "$rc"; fi');
    expect(capture).not.toContain(".render-failed");
  });

  it("keeps one capture and the required check names in the drift check", () => {
    const drift = read(".github/workflows/pr-drift-check.yml");
    for (const job of ["changes", "capture", "verify-drift", "commit-on-approval", "drift-gate"]) {
      expect(drift, job).toMatch(new RegExp(`^  ${job}:`, "m"));
    }
    for (const gone of ["capture-wasm", "engine-parity"]) expect(drift, gone).not.toMatch(new RegExp(`^  ${gone}:`, "m"));
  });
});
