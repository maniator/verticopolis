import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { missingEngine, precacheFile } from "./precacheEntry";

const DIST = resolve("/build/dist");

describe("precacheFile", () => {
  it("maps a manifest URL to its file under dist/, dropping the query and decoding it", () => {
    expect(precacheFile(DIST, "engine/verticopolis_engine_bg.wasm?__WB_REVISION__=abc")).toBe(resolve(DIST, "engine/verticopolis_engine_bg.wasm"));
    expect(precacheFile(DIST, "assets/a%20b.js#x")).toBe(resolve(DIST, "assets/a b.js"));
    expect(precacheFile(DIST, "./index.html")).toBe(resolve(DIST, "index.html"));
    // A name that only starts with dots is a file, not a parent segment.
    expect(precacheFile(DIST, "..foo.js")).toBe(resolve(DIST, "..foo.js"));
  });

  it.each([
    ["an absolute path", "/etc/passwd"],
    ["a backslash path", "\\\\host\\share"],
    ["a scheme", "https://example.com/a.js"],
    ["a file scheme", "file:///etc/passwd"],
    ["a parent segment", "../secret.js"],
    ["a nested parent segment", "assets/../../secret.js"],
    ["an encoded parent segment", "assets/%2e%2e/%2e%2e/secret.js"],
    ["an encoded slash escape", "..%2Fsecret.js"],
    ["an empty path", "?only=query"],
    ["a malformed escape", "assets/%E0%A4%A.js"],
    ["a NUL byte", "assets/a%00.js"],
    ["a drive letter", "C:/secret.js"],
    ["a lone parent", ".."],
  ])("refuses %s", (_, url) => {
    expect(() => precacheFile(DIST, url)).toThrow(/precache entry/);
  });
});

describe("missingEngine", () => {
  it("lets any build with the engine go on", () => {
    expect(missingEngine({}, true)).toBeNull();
    expect(missingEngine({ VERCEL: "1" }, true)).toBeNull();
  });

  it("stops a build without the engine unless it opts in with exactly 1", () => {
    expect(missingEngine({}, false)).toMatch(/no engine package/);
    expect(missingEngine({ VC_ALLOW_NO_ENGINE: "1" }, false)).toBeNull();
    for (const v of ["", "0", "true", "yes", " 1"]) {
      expect(missingEngine({ VC_ALLOW_NO_ENGINE: v }, false)).toMatch(/only "1" opts in/);
    }
  });

  it("stops a deploy without the engine even when it opts in", () => {
    expect(missingEngine({ VERCEL: "1" }, false)).toMatch(/a deploy must ship the WASM engine/);
    expect(missingEngine({ VERCEL: "1", VC_ALLOW_NO_ENGINE: "1" }, false)).toMatch(/does not apply/);
  });
});
