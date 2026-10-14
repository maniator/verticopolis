import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { engineOptional, precacheFile } from "./precacheEntry";

const DIST = resolve("/build/dist");

describe("precacheFile", () => {
  it("maps a manifest URL to its file under dist/, dropping the query and decoding it", () => {
    expect(precacheFile(DIST, "engine/verticopolis_engine_bg.wasm?__WB_REVISION__=abc")).toBe(resolve(DIST, "engine/verticopolis_engine_bg.wasm"));
    expect(precacheFile(DIST, "assets/a%20b.js#x")).toBe(resolve(DIST, "assets/a b.js"));
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
  ])("refuses %s", (_, url) => {
    expect(() => precacheFile(DIST, url)).toThrow(/precache entry/);
  });
});

describe("engineOptional", () => {
  it("lets a build go without the engine only on the exact opt-in", () => {
    expect(engineOptional({ VC_ALLOW_NO_ENGINE: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes", " 1"]) expect(engineOptional({ VC_ALLOW_NO_ENGINE: v })).toBe(false);
    expect(engineOptional({ VERCEL: "1" })).toBe(false);
  });
});
