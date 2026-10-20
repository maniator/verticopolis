import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ENGINE_GLUE, ENGINE_WASM } from "./enginePackageNames";
import { canonicalFilesJson, engineBuildRecord, expectedOf, parseEngineRecord, shortId, type EnginePackageRecord } from "./enginePackageRecord";

const sha = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
const glue = new TextEncoder().encode("export default function init() {}\n");
const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 9, 9]);

function record(): EnginePackageRecord {
  return engineBuildRecord(glue, wasm, "a".repeat(64), sha);
}

describe("engineBuildRecord", () => {
  it("names the glue and the binary by digest and size, and the package by their hash", () => {
    const r = record();
    expect(r.schema).toBe(2);
    expect(r.sources).toBe("a".repeat(64));
    expect(r.files[ENGINE_GLUE]).toEqual({ sha256: sha(glue), bytes: glue.length });
    expect(r.files[ENGINE_WASM]).toEqual({ sha256: sha(wasm), bytes: wasm.length });
    expect(r.package).toBe(sha(canonicalFilesJson(r.files)));
  });

  it("gives the same package id for the same bytes whatever the sources hash", () => {
    expect(engineBuildRecord(glue, wasm, "b".repeat(64), sha).package).toBe(record().package);
  });

  it("changes the package id when either file changes by one byte", () => {
    const g = new Uint8Array(glue);
    g[0] ^= 1;
    const w = new Uint8Array(wasm);
    w[9] ^= 1;
    expect(engineBuildRecord(g, wasm, "a".repeat(64), sha).package).not.toBe(record().package);
    expect(engineBuildRecord(glue, w, "a".repeat(64), sha).package).not.toBe(record().package);
  });
});

describe("canonicalFilesJson", () => {
  it("is fixed key order and no whitespace, whatever order the entries came in", () => {
    const r = record();
    const flipped = { [ENGINE_WASM]: { bytes: r.files[ENGINE_WASM].bytes, sha256: r.files[ENGINE_WASM].sha256 }, [ENGINE_GLUE]: { bytes: r.files[ENGINE_GLUE].bytes, sha256: r.files[ENGINE_GLUE].sha256 } };
    expect(canonicalFilesJson(flipped)).toBe(canonicalFilesJson(r.files));
    expect(canonicalFilesJson(r.files)).toBe(
      `{"${ENGINE_GLUE}":{"sha256":"${sha(glue)}","bytes":${glue.length}},"${ENGINE_WASM}":{"sha256":"${sha(wasm)}","bytes":${wasm.length}}}`,
    );
  });
});

describe("parseEngineRecord", () => {
  it("reads what the build wrote", () => {
    const r = record();
    const parsed = parseEngineRecord(JSON.stringify(r, null, 2));
    expect(parsed).toEqual({ ok: true, record: r });
  });

  it("ignores an unknown top-level key, so a later field does not strand an older shell", () => {
    const parsed = parseEngineRecord(JSON.stringify({ ...record(), builtBy: "ci" }));
    expect(parsed.ok).toBe(true);
  });

  it("ignores an unknown key inside a file entry and drops it from the record", () => {
    const r = record();
    const parsed = parseEngineRecord(JSON.stringify({ ...r, files: { ...r.files, [ENGINE_GLUE]: { ...r.files[ENGINE_GLUE], note: "x" } } }));
    expect(parsed).toEqual({ ok: true, record: r });
  });

  const bad: [string, (r: Record<string, unknown>) => unknown][] = [
    ["schema 1", (r) => ({ ...r, schema: 1 })],
    ["no schema", ({ schema: _s, ...r }) => r],
    ["no sources", ({ sources: _s, ...r }) => r],
    ["a package id that is not 64 hex digits", (r) => ({ ...r, package: "ABC" })],
    ["an uppercase package id", (r) => ({ ...r, package: String(r.package).toUpperCase() })],
    ["no files block", ({ files: _f, ...r }) => r],
    ["a files block that is an array", (r) => ({ ...r, files: [] })],
    ["a missing binary entry", (r) => ({ ...r, files: { [ENGINE_GLUE]: (r.files as Record<string, unknown>)[ENGINE_GLUE] } })],
    ["an extra file entry", (r) => ({ ...r, files: { ...(r.files as object), "snippets/x.js": { sha256: "0".repeat(64), bytes: 1 } } })],
    ["a digest that is not hex", (r) => ({ ...r, files: { ...(r.files as object), [ENGINE_GLUE]: { sha256: "z".repeat(64), bytes: 1 } } })],
    ["a negative byte count", (r) => ({ ...r, files: { ...(r.files as object), [ENGINE_GLUE]: { sha256: "0".repeat(64), bytes: -1 } } })],
    ["a fractional byte count", (r) => ({ ...r, files: { ...(r.files as object), [ENGINE_GLUE]: { sha256: "0".repeat(64), bytes: 1.5 } } })],
    ["a string byte count", (r) => ({ ...r, files: { ...(r.files as object), [ENGINE_GLUE]: { sha256: "0".repeat(64), bytes: "5" } } })],
  ];
  it.each(bad)("refuses %s", (_name, mutate) => {
    const r = mutate({ ...record() } as unknown as Record<string, unknown>);
    expect(parseEngineRecord(JSON.stringify(r)).ok).toBe(false);
  });

  it.each(["", "{", "null", "[]", '"text"', "42"])("refuses the non-record text %j without throwing", (text) => {
    expect(parseEngineRecord(text).ok).toBe(false);
  });
});

describe("the crate entry", () => {
  const crate = { name: "verticopolis-engine", version: "0.2.0" };
  const withCrate = () => engineBuildRecord(glue, wasm, "a".repeat(64), sha, crate);

  it("is written when given and left out when not", () => {
    expect(withCrate().crate).toEqual(crate);
    expect("crate" in record()).toBe(false);
  });

  it("stays out of the package id", () => {
    expect(withCrate().package).toBe(record().package);
  });

  it("round-trips through the parser", () => {
    expect(parseEngineRecord(JSON.stringify(withCrate()))).toEqual({ ok: true, record: withCrate() });
  });

  it("reads a record without one, as an older build wrote it", () => {
    const parsed = parseEngineRecord(JSON.stringify(record()));
    expect(parsed.ok && "crate" in parsed.record).toBe(false);
  });

  it.each([
    ["a string", "0.2.0"],
    ["an array", ["verticopolis-engine", "0.2.0"]],
    ["a missing version", { name: "verticopolis-engine" }],
    ["an empty name", { name: "", version: "0.2.0" }],
    ["a numeric version", { name: "verticopolis-engine", version: 2 }],
    ["null", null],
  ])("treats %s as absent and still loads the package", (_label, bad) => {
    const parsed = parseEngineRecord(JSON.stringify({ ...record(), crate: bad }));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && "crate" in parsed.record).toBe(false);
  });

  it("drops unknown keys inside the entry", () => {
    const parsed = parseEngineRecord(JSON.stringify({ ...record(), crate: { ...crate, extra: 1 } }));
    expect(parsed).toEqual({ ok: true, record: withCrate() });
  });

  it("rides into the part of the record the shell compiles in, beside the package and files", () => {
    expect(expectedOf(withCrate())).toEqual({ package: record().package, files: record().files, crate, sources: record().sources });
    expect("crate" in expectedOf(record())).toBe(false);
  });
});

describe("shortId and expectedOf", () => {
  it("shows the first 12 digits", () => {
    expect(shortId("0123456789abcdef".repeat(4))).toBe("0123456789ab");
  });
  it("keeps the package and the files, and carries the sources hash as a label", () => {
    const r = record();
    expect(expectedOf(r)).toEqual({ package: r.package, files: r.files, sources: r.sources });
  });
});
