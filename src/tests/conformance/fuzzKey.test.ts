import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PART_NAMES, fuzzKey, fuzzKeyFiles, fuzzKeyParts, importClosure, type KeyParts } from "./fuzzKey";
import { repoRoot } from "../guardFiles";

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

  it("moves when any input moves", () => {
    const root = tree();
    const base = keyOf(root);
    const moves = (rel: string, text: string): KeyParts => {
      const before = fuzzKeyParts(root);
      const original = readFileSync(join(root, rel), "utf8");
      edit(root, rel, text);
      const after = fuzzKeyParts(root);
      expect(keyOf(root)).not.toBe(base);
      edit(root, rel, original);
      expect(keyOf(root)).toBe(base);
      return Object.fromEntries(PART_NAMES.map((n) => [n, before[n] === after[n] ? "same" : "moved"])) as KeyParts;
    };
    expect(moves("engine-rs/src/lib.rs", "pub fn g() {}\n")).toMatchObject({ engine: "moved", srcEngine: "same" });
    expect(moves("src/engine/a.ts", "export const a = 2;\n")).toMatchObject({ srcEngine: "moved", engine: "same" });
    expect(moves("src/tests/helper.ts", "export const helper = 2;\n")).toMatchObject({ scripts: "moved" });
    expect(moves("scripts/fuzz-compare.ts", "export {};\n")).toMatchObject({ scripts: "moved" });
    expect(moves("tsconfig.json", '{"a":1}\n')).toMatchObject({ scripts: "moved" });
    expect(moves("scripts/wasm-build.ts", "export const w = 1;\n")).toMatchObject({ wasmBuild: "moved" });
    expect(moves("scripts/build-engine-wasm.sh", "#!/bin/sh\necho\n")).toMatchObject({ wasmBuild: "moved" });
    expect(moves("package.json", JSON.stringify({ scripts: { "wasm:build": "other" } }))).toMatchObject({ wasmBuild: "moved" });
    expect(moves(".nvmrc", "24\n")).toMatchObject({ pins: "moved" });
    expect(moves(".github/workflows/engine-fuzz.yml", "name: other\n")).toMatchObject({ pins: "moved" });
    expect(moves("conformance/fixtures/f.vctower", "changed\n")).toMatchObject({ fixtures: "moved" });
    const lock = { ...LOCK, packages: { ...LOCK.packages, "node_modules/dep": { version: "2.0.1" } } };
    expect(moves("package-lock.json", JSON.stringify(lock))).toMatchObject({ pins: "moved" });
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

  it("follows relative imports, skips prose that shows one, and fails closed on a missing file", () => {
    const root = tree();
    edit(root, "scripts/fuzz-compare.ts", '// import { gone } from "./gone";\n/* from "./also-gone" */\nimport { helper } from "../src/tests/helper";\nexport const c = helper;\n');
    expect(importClosure(root, ["scripts/fuzz-compare.ts"])).toEqual(["scripts/fuzz-compare.ts", "src/tests/helper.ts"]);
    edit(root, "scripts/fuzz-compare.ts", 'import { gone } from "./gone";\n');
    expect(() => fuzzKeyParts(root)).toThrow(/cannot resolve "\.\/gone"/);
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

  it("covers the scripts the nightly runs and the fixtures", () => {
    const files = fuzzKeyFiles(repoRoot);
    expect(files.scripts).toEqual(expect.arrayContaining(["scripts/fuzz-compare.ts", "scripts/fuzz-key.ts", "src/tests/conformance/fuzzKey.ts", "src/tests/conformance/scenario.ts", "tsconfig.json"]));
    expect(files.scripts.some((f) => f.startsWith("src/engine/"))).toBe(false);
    expect(files.srcEngine.some((f) => f.endsWith(".test.ts"))).toBe(false);
    expect(files.fixtures.length).toBeGreaterThan(0);
  });
});
