// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeBundle, categorize, precacheUrls, sizeOf, wasmSections } from "./bundle";

describe("categorize", () => {
  it.each([
    ["engine/verticopolis_engine_bg.wasm", "wasm-binary"],
    ["engine/verticopolis_engine.js", "wasm-glue"],
    ["engine/BUILD.json", "engine-meta"],
    ["assets/main-CLZ7EXMB.js", "app-js"],
    ["assets/vendor-excalibur-DkRNwGU5.js", "app-js"],
    ["assets/main-CLZ7EXMB.js.map", "sourcemaps"],
    ["assets/ToneAudioEngine-DzE4j51c.js", "audio-js"],
    ["assets/worker-CmhDMPh_.js", "tooling"],
    ["assets/help-LVnGCI5H.js", "non-game-pages"],
    ["assets/helpContent-C9hi3j7j.js", "non-game-pages"],
    ["assets/help-media/a.png", "non-game-pages"],
    ["gallery.html", "non-game-pages"],
    ["sw.js", "service-worker"],
    ["workbox-2fbc6a65.js", "service-worker"],
    ["assets/main-DHmFw8Kh.css", "css"],
    ["index.html", "html"],
    ["audio/voice-talk.mp3", "audio-assets"],
    ["favicon.png", "images"],
    ["font.woff2", "fonts"],
    ["manifest.webmanifest", "other"],
  ])("%s is %s", (path, category) => {
    expect(categorize(path)).toBe(category);
  });
});

describe("precacheUrls", () => {
  it("reads both Workbox entry orders and de-duplicates", () => {
    const sw = 's.precacheAndRoute([{url:"index.html",revision:"abc"},{url:"assets/a.js",revision:null},{revision:"x",url:"/b.png"},{url:"index.html",revision:"abc"}])';
    expect(precacheUrls(sw)).toEqual(["assets/a.js", "b.png", "index.html"]);
  });
});

/** A minimal module: magic, version, a type section, a custom "name" section. */
function module(): Uint8Array {
  const name = new TextEncoder().encode("name");
  const custom = [name.length, ...name, 1, 2, 3];
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 1, 0, 0, custom.length, ...custom]);
}

describe("wasmSections", () => {
  it("sizes each section, custom sections by name", () => {
    expect(wasmSections(module())).toEqual([
      { name: "type", bytes: 3 },
      { name: "custom:name", bytes: 10 },
    ]);
  });
  it("refuses a non-module and a truncated section", () => {
    expect(() => wasmSections(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a wasm module/);
    expect(() => wasmSections(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 9, 0]))).toThrow(/past the end/);
    expect(() => wasmSections(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 0x80]))).toThrow(/truncated/);
    expect(() => wasmSections(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 1]))).toThrow(/too long/);
  });
  it("names an unknown section id", () => {
    expect(wasmSections(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 99, 0]))).toEqual([{ name: "unknown-99", bytes: 2 }]);
  });
});

describe("analyzeBundle", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it("totals the game with and without the WASM files and reads the precache", () => {
    dir = mkdtempSync(join(tmpdir(), "vc-bundle-"));
    mkdirSync(join(dir, "assets"));
    mkdirSync(join(dir, "engine"));
    writeFileSync(join(dir, "index.html"), "<!doctype html>".repeat(10));
    writeFileSync(join(dir, "assets/main-A.js"), "console.log(1);".repeat(50));
    writeFileSync(join(dir, "assets/main-A.js.map"), "{}");
    writeFileSync(join(dir, "engine/verticopolis_engine_bg.wasm"), module());
    writeFileSync(join(dir, "engine/verticopolis_engine.js"), "export {};");
    writeFileSync(join(dir, "sw.js"), 'p([{url:"index.html",revision:"1"},{url:"assets/main-A.js",revision:null},{url:"gone.js",revision:null}])');
    const r = analyzeBundle(dir);
    expect(r.files.map((f) => f.path)).toEqual(["assets/main-A.js", "assets/main-A.js.map", "engine/verticopolis_engine.js", "engine/verticopolis_engine_bg.wasm", "index.html", "sw.js"]);
    expect(r.precache.entries).toBe(3);
    expect(r.precache.missing).toEqual(["gone.js"]);
    expect(r.precache.raw).toBe(750 + 150);
    expect(r.totals.wasmOnly.raw).toBe(10 + module().length);
    expect(r.totals.game.raw - r.totals.gameWithoutWasm.raw).toBe(r.totals.wasmOnly.raw);
    expect(r.totals.everything.raw - r.totals.game.raw).toBe(2); // the source map
    expect(r.byCategory["app-js"]).toMatchObject({ files: 1, raw: 750 });
    expect(r.wasm).toMatchObject({ path: "engine/verticopolis_engine_bg.wasm", customBytes: 10 });
  });
  it("has no wasm entry and no precache when the build has neither", () => {
    dir = mkdtempSync(join(tmpdir(), "vc-bundle-"));
    writeFileSync(join(dir, "index.html"), "x");
    const r = analyzeBundle(dir);
    expect(r.wasm).toBeNull();
    expect(r.precache.entries).toBe(0);
  });
});

describe("sizeOf", () => {
  it("compresses repetitive text well below its raw size", () => {
    const s = sizeOf(Buffer.from("abc".repeat(1000)));
    expect(s.raw).toBe(3000);
    expect(s.gzip).toBeLessThan(100);
    expect(s.brotli).toBeLessThan(100);
  });
});
