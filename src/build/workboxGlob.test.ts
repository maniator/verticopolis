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
    // Entries it cannot read make the whole read fail.
    expect(readWorkboxGlob(`globPatterns: ["**/*.{js,wasm}", 'engine/BUILD.json'],`)).toBeNull();
    expect(readWorkboxGlob('globPatterns: ["**/*.{js,wasm}", ...extra],')).toBeNull();
    expect(readWorkboxGlob('globPatterns: ["**/*.[jt]s", "engine/BUILD.json"],')).toBeNull();
    // A second globPatterns is never read in place of a first it cannot read.
    expect(readWorkboxGlob(`globPatterns: ['x'], globPatterns: ["**/*.{js}"],`)).toBeNull();
  });

  it("fails fast on a malformed list", () => {
    // Entries with no commas between them once made the match backtrack for
    // minutes; the read must stay quick and refuse it.
    const malformed = "globPatterns: [" + '\n          "**/*.{js}"'.repeat(30) + "\n x";
    const started = performance.now();
    expect(readWorkboxGlob(malformed)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
