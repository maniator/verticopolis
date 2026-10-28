import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FUZZ_ENTRIES, PART_NAMES, fuzzKey, fuzzKeyFiles, fuzzKeyParts, importClosure, type PartName } from "./fuzzKey";
import { repoRoot } from "../guardFiles";
import { linkFolder } from "../fixtures/links";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const LOCK = { name: "x", version: "1.0.0", packages: { "": { name: "x", version: "1.0.0" }, "node_modules/dep": { version: "2.0.0" } } };

/** The smallest tree the key reads. */
function tree(): string {
  const root = mkdtempSync(join(tmpdir(), "fuzz-key-"));
  roots.push(root);
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put("engine-rs/Cargo.toml", "[package]\n");
  put("engine-rs/src/lib.rs", "pub fn f() {}\n");
  put("src/engine/a.ts", "export const a = 1;\n");
  put("src/engine/a.test.ts", "export const t = 1;\n");
  put("scripts/fuzz-compare.ts", 'import { helper } from "../src/tests/helper";\nexport const c = helper;\n');
  put("scripts/fuzz-key.ts", "export {};\n");
  put("scripts/fuzz-shrink.ts", "export {};\n");
  put("scripts/fuzz-corpus.ts", "export {};\n");
  put("src/tests/helper.ts", "export const helper = 1;\n");
  put("scripts/wasm-build.ts", "export {};\n");
  put("scripts/build-engine-wasm.sh", "#!/bin/sh\n");
  put(".github/actions/engine-wasm/action.yml", "name: x\n");
  put(".github/workflows/engine-fuzz.yml", "name: fuzz\n");
  put(".nvmrc", "22\n");
  put("tsconfig.json", "{}\n");
  put("package.json", JSON.stringify({ name: "x", version: "1.0.0", scripts: { "wasm:build": "bash scripts/build-engine-wasm.sh" } }));
  put("package-lock.json", JSON.stringify(LOCK));
  put("conformance/fixtures/f.vctower", "tower\n");
  return root;
}

const keyOf = (root: string): string => fuzzKey(fuzzKeyParts(root));
const edit = (root: string, rel: string, text: string) => writeFileSync(join(root, rel), text);

describe("the differential's window key", () => {
  it("is stable and has one part per input group", () => {
    const root = tree();
    const parts = fuzzKeyParts(root);
    expect(Object.keys(parts).sort()).toEqual([...PART_NAMES].sort());
    for (const p of Object.values(parts)) expect(p).toMatch(/^[0-9a-f]{64}$/);
    expect(keyOf(root)).toBe(keyOf(root));
  });

  it("moves exactly the part an input belongs to", () => {
    const root = tree();
    const base = keyOf(root);
    const baseParts = fuzzKeyParts(root);
    const moved = (rel: string, text: string): PartName[] => {
      const original = readFileSync(join(root, rel), "utf8");
      edit(root, rel, text);
      const after = fuzzKeyParts(root);
      expect(keyOf(root)).not.toBe(base);
      edit(root, rel, original);
      expect(keyOf(root)).toBe(base);
      return PART_NAMES.filter((n) => after[n] !== baseParts[n]);
    };
    expect(moved("engine-rs/src/lib.rs", "pub fn g() {}\n")).toEqual(["engine"]);
    expect(moved("engine-rs/Cargo.toml", "[package]\nname = \"x\"\n")).toEqual(["engine"]);
    expect(moved("src/engine/a.ts", "export const a = 2;\n")).toEqual(["srcEngine"]);
    expect(moved("src/tests/helper.ts", "export const helper = 2;\n")).toEqual(["scripts"]);
    expect(moved("scripts/fuzz-compare.ts", "export {};\n")).toEqual(["scripts"]);
    expect(moved("tsconfig.json", '{"a":1}\n')).toEqual(["scripts"]);
    expect(moved("scripts/wasm-build.ts", "export const w = 1;\n")).toEqual(["wasmBuild"]);
    expect(moved("scripts/build-engine-wasm.sh", "#!/bin/sh\necho\n")).toEqual(["wasmBuild"]);
    expect(moved(".github/actions/engine-wasm/action.yml", "name: y\n")).toEqual(["wasmBuild"]);
    expect(moved("package.json", JSON.stringify({ scripts: { "wasm:build": "other" } }))).toEqual(["wasmBuild"]);
    expect(moved(".nvmrc", "24\n")).toEqual(["pins"]);
    expect(moved(".github/workflows/engine-fuzz.yml", "name: other\n")).toEqual(["pins"]);
    expect(moved("conformance/fixtures/f.vctower", "changed\n")).toEqual(["fixtures"]);
    const lock = { ...LOCK, packages: { ...LOCK.packages, "node_modules/dep": { version: "2.0.1" } } };
    expect(moved("package-lock.json", JSON.stringify(lock))).toEqual(["pins"]);
  });

  it("moves when a file is added, removed or renamed", () => {
    const root = tree();
    const base = keyOf(root);
    writeFileSync(join(root, "conformance/fixtures/g.vctower"), "tower\n");
    expect(keyOf(root)).not.toBe(base);
    rmSync(join(root, "conformance/fixtures/g.vctower"));
    expect(keyOf(root)).toBe(base);
    rmSync(join(root, "conformance/fixtures/f.vctower"));
    writeFileSync(join(root, "conformance/fixtures/renamed.vctower"), "tower\n");
    expect(keyOf(root)).not.toBe(base);
  });

  it("does not depend on where the tree sits, its line endings, dotfiles or symlinks", () => {
    const a = tree();
    const b = tree();
    expect(keyOf(a)).toBe(keyOf(b));
    writeFileSync(join(b, "src/engine/a.ts"), "export const a = 1;\r\n");
    expect(keyOf(b)).toBe(keyOf(a));
    writeFileSync(join(b, "conformance/fixtures/.DS_Store"), "junk");
    linkFolder(join(b, "conformance/fixtures"), join(b, "conformance/fixtures/loop"));
    expect(keyOf(b)).toBe(keyOf(a));
    unlinkSync(join(b, "conformance/fixtures/loop"));
  });

  it("leaves a version bump, an engine test file and unrelated files alone", () => {
    const root = tree();
    const base = keyOf(root);
    const lock = { ...LOCK, version: "1.1.0", packages: { ...LOCK.packages, "": { name: "x", version: "1.1.0" } } };
    edit(root, "package-lock.json", JSON.stringify(lock));
    edit(root, "package.json", JSON.stringify({ name: "x", version: "1.1.0", scripts: { "wasm:build": "bash scripts/build-engine-wasm.sh" } }));
    edit(root, "src/engine/a.test.ts", "export const t = 2;\n");
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs/notes.md"), "notes\n");
    expect(keyOf(root)).toBe(base);
  });

  it("follows every relative import form, skips prose that shows one, and fails closed on a missing file", () => {
    const root = tree();
    for (const f of ["a", "b", "c", "d", "e"]) writeFileSync(join(root, `src/tests/${f}.ts`), "export {};\n");
    mkdirSync(join(root, "src/tests/dir"), { recursive: true });
    writeFileSync(join(root, "src/tests/dir/index.ts"), "export {};\n");
    edit(
      root,
      "scripts/fuzz-compare.ts",
      [
        "// matches src/*.ts and imports { gone } from './gone'",
        'const glob = "src/*";',
        'import { helper } from "../src/tests/helper";',
        'export * from "../src/tests/a";',
        'import type { T } from "../src/tests/b";',
        'const lazy = () => import("../src/tests/c");',
        'import d = require("../src/tests/d.js");',
        'import "../src/tests/dir";',
        "/* from './also-gone' */",
        'export const c = helper;',
        "",
      ].join("\n"),
    );
    expect(importClosure(root, ["scripts/fuzz-compare.ts"])).toEqual([
      "scripts/fuzz-compare.ts",
      "src/tests/a.ts",
      "src/tests/b.ts",
      "src/tests/c.ts",
      "src/tests/d.ts",
      "src/tests/dir/index.ts",
      "src/tests/helper.ts",
    ]);
    edit(root, "scripts/fuzz-compare.ts", 'import { gone } from "./gone";\n');
    expect(() => fuzzKeyParts(root)).toThrow(/cannot resolve "\.\/gone"/);
  });

  it("names a listed directory that is missing", () => {
    const root = tree();
    rmSync(join(root, "conformance/fixtures"), { recursive: true });
    expect(() => fuzzKeyParts(root)).toThrow(/conformance\/fixtures is listed but missing/);
  });

  it("names a listed file that is missing", () => {
    const root = tree();
    rmSync(join(root, ".nvmrc"));
    expect(() => fuzzKeyParts(root)).toThrow(/\.nvmrc is listed but missing/);
  });
});

describe("the real tree's key", () => {
  it("computes, and its WASM build part matches the engine-wasm action's hand-kept list", () => {
    const parts = fuzzKeyParts(repoRoot);
    for (const p of Object.values(parts)) expect(p).toMatch(/^[0-9a-f]{64}$/);
    // The action keys its package cache on a hand-written list of files; the
    // key computes the same set from the import graph. They must agree.
    const action = readFileSync(join(repoRoot, ".github/actions/engine-wasm/action.yml"), "utf8");
    const listed = /scripts=\$\(\{ cat ([^;]+);/.exec(action)?.[1].trim().split(/\s+/) ?? [];
    expect(listed.length).toBeGreaterThan(5);
    const computed = fuzzKeyFiles(repoRoot).wasmBuild;
    expect(computed.filter((f) => f !== ".github/actions/engine-wasm/action.yml").sort()).toEqual(
      listed.filter((f) => f !== ".github/actions/engine-wasm/action.yml").sort(),
    );
  });

  it("lists every script the nightly workflow runs as an entry", () => {
    const workflow = readFileSync(join(repoRoot, ".github/workflows/engine-fuzz.yml"), "utf8");
    const run = [...workflow.matchAll(/\b(scripts\/[\w-]+\.ts)\b/g)].map((m) => m[1]);
    expect(run.length).toBeGreaterThan(0);
    for (const script of new Set(run)) expect(FUZZ_ENTRIES).toContain(script);
  });

  it("covers the scripts the nightly runs and the fixtures", () => {
    const files = fuzzKeyFiles(repoRoot);
    expect(files.scripts).toEqual(expect.arrayContaining(["scripts/fuzz-compare.ts", "scripts/fuzz-key.ts", "src/tests/conformance/fuzzKey.ts", "src/tests/conformance/scenario.ts", "tsconfig.json"]));
    expect(files.scripts.some((f) => f.startsWith("src/engine/"))).toBe(false);
    expect(files.srcEngine.some((f) => f.endsWith(".test.ts"))).toBe(false);
    expect(files.fixtures.length).toBeGreaterThan(0);
  });
});
