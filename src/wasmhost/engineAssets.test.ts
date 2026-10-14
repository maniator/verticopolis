import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENGINE_THIRD_PARTY } from "../build/rustNotices";
import {
  ENGINE_BUILD_ONLY_FILES,
  ENGINE_BUILD_RECORD,
  ENGINE_DIR,
  ENGINE_GLUE,
  ENGINE_PACKAGE,
  ENGINE_RUNTIME_FILES,
  ENGINE_THIRD_PARTY_RECORD,
  ENGINE_WASM,
  glueLoads,
} from "./engineAssets";
import { enginePackageUrl } from "./startWasmHost";

/**
 * ENGINE_PACKAGE is what scripts/verify-precache.ts checks against the
 * service worker's manifest, so an installed game starts the engine offline
 * (#985) only if the list is complete and marks every file the game fetches.
 * These tests fail when the app source fetches an engine file the list does
 * not mark as fetched, or when the package build writes a file the list does
 * not classify.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const ROOT = resolve(SRC, "..");
const PACKAGE = resolve(SRC, "public", "engine");
const NAMES = ENGINE_PACKAGE.map((f) => f.name);

/** Every regular file under `dir`, recursively, as `/`-separated paths relative to it. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, resolve(e.parentPath, e.name)).split("\\").join("/"));
}

/** Source text without its comments, so prose that names a file (packageHash.ts
 *  mentions BUILD.json) does not count as a fetch. A `//` after a colon is
 *  kept (a URL in a string). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** An engine package file named in code: the files wasm-bindgen writes, the
 *  two records, or anything under `engine/`. */
const ENGINE_NAME = /\bverticopolis_engine[\w.-]*\.(?:js|wasm)\b|\bBUILD\.json\b|\bTHIRD-PARTY\.json\b|(?<![\w./-])engine\/[\w.-]+\.(?:js|wasm|json)\b/g;

describe("ENGINE_PACKAGE", () => {
  it("lists each file once, and fetches the glue and the binary", () => {
    expect(new Set(NAMES).size).toBe(NAMES.length);
    expect(ENGINE_RUNTIME_FILES).toEqual([ENGINE_DIR + ENGINE_GLUE, ENGINE_DIR + ENGINE_WASM]);
    expect([...ENGINE_RUNTIME_FILES, ...ENGINE_BUILD_ONLY_FILES].sort()).toEqual(NAMES.map((n) => ENGINE_DIR + n).sort());
  });

  it("names the third-party record the notices build reads", () => {
    expect(ENGINE_THIRD_PARTY_RECORD).toBe(ENGINE_THIRD_PARTY);
  });

  it("loads the glue from a file it marks as fetched", () => {
    const url = new URL(enginePackageUrl("/", "https://example.test/play"));
    expect(ENGINE_RUNTIME_FILES).toContain(url.pathname.slice(1));
  });

  it("marks every engine file the app source names as fetched", () => {
    // Node-only code (the build helpers and the test harnesses under
    // src/tests/) reads build-only files on purpose; everything else is
    // app code, where naming a package file means fetching it.
    const nodeOnly = (f: string) => f.startsWith("build/") || f.startsWith("tests/") || f === "wasmhost/engineAssets.ts" || f === "wasmhost/packageHash.ts";
    const named = new Map<string, string>();
    const built: string[] = [];
    for (const f of filesUnder(SRC)) {
      if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f) || f.endsWith(".d.ts") || f.startsWith("public/") || nodeOnly(f)) continue;
      const text = code(readFileSync(resolve(SRC, f), "utf8"));
      for (const m of text.matchAll(ENGINE_NAME)) named.set(m[0], f);
      // A package path assembled at run time can't be checked against the
      // list; build it from the engineAssets.ts constants instead.
      if (/`[^`]*\bengine\/[^`]*\$\{[^`]*`|["']engine\/["']\s*\+/.test(text)) built.push(f);
    }
    const fetched = new Set(ENGINE_RUNTIME_FILES.flatMap((p) => [p, p.slice(ENGINE_DIR.length)]));
    expect([...named].filter(([name]) => !fetched.has(name)).map(([name, f]) => `${name} (in ${f})`)).toEqual([]);
    expect(built).toEqual([]);
  });

  it("holds only fetched file types the workbox glob precaches, and keeps .json out of it", () => {
    const config = readFileSync(resolve(ROOT, "vite.config.ts"), "utf8");
    const glob = /globPatterns:\s*\["\*\*\/\*\.\{([\w,]+)\}"\]/.exec(config);
    expect(glob, "vite.config.ts globPatterns changed shape; update this test").not.toBeNull();
    const exts = new Set(glob![1].toLowerCase().split(","));
    for (const f of ENGINE_RUNTIME_FILES) expect(exts.has(f.slice(f.lastIndexOf(".") + 1)), f).toBe(true);
    // A blanket `json` would precache the build-only records (and version.json).
    expect(exts.has("json")).toBe(false);
  });
});

describe("the engine package build", () => {
  const script = readFileSync(resolve(ROOT, "scripts", "wasm-build.ts"), "utf8");

  it("writes into the package only files the list classifies", () => {
    // Every file the script writes or copies into the package directory names
    // a constant from engineAssets.ts; a literal or a new constant is a file
    // this list would not know about.
    const exported: Record<string, string> = { ENGINE_GLUE, ENGINE_WASM, ENGINE_BUILD_RECORD, ENGINE_THIRD_PARTY, ENGINE_THIRD_PARTY_RECORD };
    const writes = [...script.matchAll(/(?:writeFileSync|copyFileSync\([^,]+,)\s*\(?\s*resolve\(\s*web\s*,\s*([^)]+)\)/g)].map((m) => m[1].trim());
    expect(writes.length).toBeGreaterThan(0);
    for (const arg of writes) {
      const name = /^["'`]/.test(arg) ? arg.slice(1, -1) : exported[arg];
      expect(NAMES, `wasm-build.ts writes ${arg} into src/public/engine/`).toContain(name);
    }
  });

  it("checks what wasm-bindgen leaves in the package against the list", () => {
    // wasm-bindgen's own output (a `snippets/` folder, a new helper file) is
    // not visible in the script's text, so the script compares the folder
    // with ENGINE_PACKAGE after writing it and throws on a difference.
    expect(script).toMatch(/import \{[^}]*\bENGINE_PACKAGE\b[^}]*\} from "\.\.\/src\/wasmhost\/engineAssets\.ts"/);
    expect(script).toMatch(/readdirSync\(web,/);
    expect(script).toMatch(/does not list/);
  });
});

describe.skipIf(!existsSync(resolve(PACKAGE, ENGINE_GLUE)))("the built engine package", () => {
  it("holds exactly the files the list classifies", () => {
    expect(filesUnder(PACKAGE).sort()).toEqual([...NAMES].sort());
  });

  it("has a glue that loads only files the list marks as fetched", () => {
    const loads = glueLoads(readFileSync(resolve(PACKAGE, ENGINE_GLUE), "utf8"));
    expect(loads).toContain(ENGINE_WASM);
    for (const f of loads) expect(ENGINE_RUNTIME_FILES, f).toContain(ENGINE_DIR + f);
  });
});

describe("glueLoads", () => {
  it("finds files loaded beside the glue, and nothing from elsewhere", () => {
    const glue = [
      "module_or_path = new URL('verticopolis_engine_bg.wasm', import.meta.url);",
      'import { a } from "./snippets/x/inline0.js";',
      'const b = await import("./lazy.js");',
      'import { c } from "some-package";',
      'fetch("https://example.test/other.wasm");',
    ].join("\n");
    expect(glueLoads(glue)).toEqual(["lazy.js", "snippets/x/inline0.js", "verticopolis_engine_bg.wasm"]);
    expect(glueLoads("export function f() {}")).toEqual([]);
  });
});
