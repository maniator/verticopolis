import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENGINE_BUILD_RECORD, ENGINE_DIR, ENGINE_GLUE, ENGINE_WASM } from "../wasmhost/enginePackageNames";
import { engineBuildRecord } from "../wasmhost/enginePackageRecord";
import { INTEGRITY_FILES, engineDistProblems, engineIntegrityTransform, integrityOf, manifestIntegrity, readExpectedPackage } from "./enginePackageBuild";

const sha = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
const glue = new TextEncoder().encode("export default async function init() {}\n");
const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 2, 3]);
const record = engineBuildRecord(glue, wasm, "a".repeat(64), sha);

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A directory with an engine package in it, laid out as src/public or dist. */
function pkg(over: { record?: string | null; glue?: Uint8Array; wasm?: Uint8Array } = {}): string {
  dir = mkdtempSync(join(tmpdir(), "vc-pkg-"));
  mkdirSync(join(dir, ENGINE_DIR), { recursive: true });
  writeFileSync(join(dir, ENGINE_DIR, ENGINE_GLUE), over.glue ?? glue);
  writeFileSync(join(dir, ENGINE_DIR, ENGINE_WASM), over.wasm ?? wasm);
  if (over.record !== null) writeFileSync(join(dir, ENGINE_DIR, ENGINE_BUILD_RECORD), over.record ?? JSON.stringify(record));
  return dir;
}

describe("readExpectedPackage", () => {
  it("reads the package id and the file digests of a good record", () => {
    expect(readExpectedPackage(pkg(), "build")).toEqual({ package: record.package, files: record.files });
  });

  it("is null when there is no package folder, in a build or not", () => {
    dir = mkdtempSync(join(tmpdir(), "vc-pkg-"));
    expect(readExpectedPackage(dir, "build")).toBeNull();
    expect(readExpectedPackage(dir, "other")).toBeNull();
  });

  it("stops a build whose package has no record", () => {
    expect(() => readExpectedPackage(pkg({ record: null }), "build")).toThrow(/BUILD\.json is missing/);
  });

  it.each([
    ["an old schema 1 record", JSON.stringify({ sources: "a".repeat(64) })],
    ["text that is not JSON", "not json"],
  ])("stops a build on %s, and tells a dev serve or a test nothing", (_name, text) => {
    const d = pkg({ record: text });
    expect(() => readExpectedPackage(d, "build")).toThrow(/not a usable schema 2 record/);
    expect(readExpectedPackage(d, "other")).toBeNull();
  });

  it("gives a dev serve null for a package with no record", () => {
    expect(readExpectedPackage(pkg({ record: null }), "other")).toBeNull();
  });
});

describe("engineIntegrityTransform", () => {
  const entries = () => [
    { url: `${ENGINE_DIR}${ENGINE_GLUE}`, revision: "r1", size: glue.length },
    { url: `${ENGINE_DIR}${ENGINE_WASM}`, revision: "r2", size: wasm.length },
    { url: `${ENGINE_DIR}${ENGINE_BUILD_RECORD}`, revision: "r3", size: 400 },
    { url: "index.html", revision: "r4", size: 10 },
  ];

  it("adds the integrity of each of the three engine files and leaves the rest alone", () => {
    const d = pkg();
    const { manifest, warnings } = engineIntegrityTransform(d)(entries());
    expect(warnings).toEqual([]);
    expect(manifest[0].integrity).toBe(`sha256-${createHash("sha256").update(glue).digest("base64")}`);
    expect(manifest[1].integrity).toBe(integrityOf(wasm));
    expect(manifest[2].integrity).toBeDefined();
    expect(manifest[3]).toEqual({ url: "index.html", revision: "r4", size: 10 });
  });

  it("matches an entry whatever its prefix or query string", () => {
    const d = pkg();
    const { manifest } = engineIntegrityTransform(d)([{ url: `./${ENGINE_DIR}${ENGINE_GLUE}?v=1`, revision: null, size: 1 }]);
    expect(manifest[0].integrity).toBe(integrityOf(glue));
  });

  it("stops the build when an engine entry has no file to hash", () => {
    const d = pkg();
    rmSync(join(d, ENGINE_DIR, ENGINE_WASM));
    expect(() => engineIntegrityTransform(d)(entries())).toThrow(/cannot carry integrity/);
  });

  it("covers exactly the glue, the binary and BUILD.json", () => {
    expect([...INTEGRITY_FILES].sort()).toEqual([ENGINE_BUILD_RECORD, ENGINE_GLUE, ENGINE_WASM].map((f) => ENGINE_DIR + f).sort());
  });
});

describe("manifestIntegrity", () => {
  it("reads integrity from minified entries in any key order and with ./ prefixes", () => {
    const m = `[{url:"a.js",revision:"1"},{revision:"2",integrity:"sha256-x",url:"./engine/b.wasm"},{"url":"c.png","revision":null,"integrity":'sha256-y'}]`;
    const got = manifestIntegrity(m);
    expect(got.get("a.js")).toBeUndefined();
    expect(got.has("a.js")).toBe(true);
    expect(got.get("engine/b.wasm")).toBe("sha256-x");
    expect(got.get("c.png")).toBe("sha256-y");
  });
});

describe("engineDistProblems", () => {
  /** A manifest with the three engine entries carrying the right integrity. */
  function manifestFor(d: string, over: Record<string, string | null> = {}): string {
    const entry = (name: string, bytes: Uint8Array) => {
      const url = ENGINE_DIR + name;
      const integrity = url in over ? over[url] : integrityOf(bytes);
      return `{url:"${url}",revision:"r"${integrity === null ? "" : `,integrity:"${integrity}"`}}`;
    };
    void d;
    return `[${entry(ENGINE_GLUE, glue)},${entry(ENGINE_WASM, wasm)},${entry(ENGINE_BUILD_RECORD, new TextEncoder().encode(JSON.stringify(record)))}]`;
  }

  it("finds nothing wrong with a consistent package", () => {
    const d = pkg();
    expect(engineDistProblems(d, manifestFor(d))).toEqual([]);
  });

  it("reports a binary that is not the one BUILD.json describes", () => {
    const d = pkg({ wasm: new Uint8Array([9, 9, 9]) });
    const problems = engineDistProblems(d, manifestFor(d));
    expect(problems.join("\n")).toContain("BUILD.json says");
    expect(problems.join("\n")).toContain("does not match the digest");
  });

  it("reports a glue with the right size and other bytes", () => {
    const other = new Uint8Array(glue);
    other[0] ^= 1;
    const d = pkg({ glue: other });
    expect(engineDistProblems(d, manifestFor(d)).join("\n")).toContain(`${ENGINE_GLUE} does not match the digest in BUILD.json`);
  });

  it("reports a package id that is not the hash of its files block", () => {
    const d = pkg({ record: JSON.stringify({ ...record, package: "e".repeat(64) }) });
    expect(engineDistProblems(d, manifestFor(d)).join("\n")).toContain("package id is not the hash");
  });

  it("reports a missing or unusable record", () => {
    expect(engineDistProblems(pkg({ record: null }), "[]")[0]).toContain("is missing");
    expect(engineDistProblems(pkg({ record: "{}" }), "[]")[0]).toContain("not a usable schema 2 record");
  });

  it("reports an engine entry with no integrity, and one with the wrong integrity", () => {
    const d = pkg();
    expect(engineDistProblems(d, manifestFor(d, { [`${ENGINE_DIR}${ENGINE_WASM}`]: null })).join("\n")).toContain("carries no integrity");
    expect(engineDistProblems(d, manifestFor(d, { [`${ENGINE_DIR}${ENGINE_GLUE}`]: "sha256-AAAA" })).join("\n")).toContain("not the digest of the file in dist/");
  });
});

describe("the other readers of BUILD.json", () => {
  // Schema 2 keeps `sources` as it was, so these readers need no change. A
  // reader that starts depending on another field should be added to the
  // design's list (section 8) and to this one.
  const root = join(import.meta.dirname, "../..");
  it.each([
    "scripts/gen-third-party-notices.ts",
    "src/build/rustNotices.ts",
    "src/tests/perfCompare/env.ts",
    ".github/actions/engine-wasm/action.yml",
    ".github/actions/engine-wasm-download/action.yml",
  ])("%s reads only `sources`", (file) => {
    const text = readFileSync(join(root, file), "utf8");
    expect(text).toContain("BUILD.json");
    expect(text).toContain("sources");
  });

  it("a schema 2 record still carries the sources hash they read", () => {
    expect(record.sources).toBe("a".repeat(64));
  });
});
