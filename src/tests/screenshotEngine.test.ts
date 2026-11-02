import { describe, expect, it } from "vitest";

// Check the screenshot engine resolver's behavior directly, rather than
// asserting the text or arrangement of GitHub Actions workflow YAML.

describe("screenshot engine selection", () => {
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
});
