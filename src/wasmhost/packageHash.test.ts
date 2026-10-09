import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { engineSourceHash } from "./packageHash";

const ROOT = resolve(import.meta.dirname, "../..");
const BUILD = resolve(ROOT, "src/public/engine/BUILD.json");

describe("the served engine package", () => {
  it("was built from the Rust sources in the tree (run npm run wasm:build and commit src/public/engine after a Rust change)", () => {
    expect(existsSync(BUILD), "src/public/engine/BUILD.json is missing: run npm run wasm:build").toBe(true);
    const built = JSON.parse(readFileSync(BUILD, "utf8")) as { sources: string };
    expect(built.sources).toBe(engineSourceHash(resolve(ROOT, "engine-rs")));
  });

  it("ships the loader and the binary beside the app", () => {
    for (const f of ["verticopolis_engine.js", "verticopolis_engine_bg.wasm"]) {
      expect(existsSync(resolve(ROOT, "src/public/engine", f)), f).toBe(true);
    }
  });
});
