import { describe, expect, it } from "vitest";
import { globCovers, readWorkboxGlob } from "./workboxGlob";

describe("readWorkboxGlob", () => {
  it("reads the brace list of extensions", () => {
    const glob = readWorkboxGlob('globPatterns: ["**/*.{js,css,wasm}"],')!;
    expect([...glob.extensions]).toEqual(["js", "css", "wasm"]);
    expect(globCovers(glob, "engine/verticopolis_engine_bg.wasm")).toBe(true);
    expect(globCovers(glob, "engine/BUILD.json")).toBe(false);
  });

  it("reads a single file added by its own path, without matching its whole extension", () => {
    const glob = readWorkboxGlob('globPatterns: ["**/*.{js,wasm}", "engine/BUILD.json"],')!;
    expect(globCovers(glob, "engine/BUILD.json")).toBe(true);
    expect(globCovers(glob, "engine/THIRD-PARTY.json")).toBe(false);
    expect(glob.extensions.has("json")).toBe(false);
  });

  it("refuses a shape it does not understand", () => {
    expect(readWorkboxGlob("no glob here")).toBeNull();
    expect(readWorkboxGlob('globPatterns: ["assets/**/*.js"],')).toBeNull();
    expect(readWorkboxGlob("globPatterns: [],")).toBeNull();
  });
});
