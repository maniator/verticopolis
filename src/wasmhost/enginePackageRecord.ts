/**
 * The engine package's build record (`engine/BUILD.json`, schema 2) and the
 * pure rules around it: how the file digests become one package id, and how a
 * served record is read back (#985 criterion 5, design in
 * _bmad-output/planning-artifacts/design/design-engine-package-set-consistency-2026-10-15.md).
 *
 * Nothing here hashes: the build passes a Node digest, the page passes
 * `crypto.subtle`, so the rules are the same on both sides and a test can pin
 * them. Keep this file ERASABLE (type-only TypeScript syntax; the rule is
 * spelled out in scripts/screenshot-env.ts): scripts/wasm-build.ts imports it
 * under plain `node`.
 */
import { ENGINE_GLUE, ENGINE_WASM } from "./enginePackageNames.ts";

/** What the record says about one served file. */
export interface EngineFileRecord {
  sha256: string;
  bytes: number;
}

/** The record's `files` block: exactly the glue and the binary. */
export type EngineFiles = Record<string, EngineFileRecord>;

/** `engine/BUILD.json` at schema 2. */
export interface EnginePackageRecord {
  schema: 2;
  /** The hash of the Rust sources (src/wasmhost/packageHash.ts), unchanged. */
  sources: string;
  /** The hash of the canonical JSON of `files`: the id of these exact bytes. */
  package: string;
  files: EngineFiles;
}

/** What the shell is built to run: the record without the sources hash. */
export interface ExpectedEnginePackage {
  package: string;
  files: EngineFiles;
}

/** A SHA-256 as 64 lowercase hex digits. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The text whose SHA-256 is the package id. A newly built object in a fixed
 * key order, no whitespace, so the same two files always give the same id
 * whatever order or spacing a served record used.
 */
export function canonicalFilesJson(files: EngineFiles): string {
  const entry = (name: string) => ({ sha256: files[name].sha256, bytes: files[name].bytes });
  return JSON.stringify({ [ENGINE_GLUE]: entry(ENGINE_GLUE), [ENGINE_WASM]: entry(ENGINE_WASM) });
}

/** The first 12 hex digits of an id, as the failure screen and diagnostics show it. */
export function shortId(id: string): string {
  return id.slice(0, 12);
}

/**
 * The record for a freshly built package. `sha256Hex` takes bytes or text, so
 * the build uses Node's hash and a test can use a fake.
 */
export function engineBuildRecord(
  glue: Uint8Array,
  wasm: Uint8Array,
  sources: string,
  sha256Hex: (data: Uint8Array | string) => string,
): EnginePackageRecord {
  const files: EngineFiles = {
    [ENGINE_GLUE]: { sha256: sha256Hex(glue), bytes: glue.length },
    [ENGINE_WASM]: { sha256: sha256Hex(wasm), bytes: wasm.length },
  };
  return { schema: 2, sources, package: sha256Hex(canonicalFilesJson(files)), files };
}

/** The part of a record the shell compiles in. */
export function expectedOf(record: EnginePackageRecord): ExpectedEnginePackage {
  return { package: record.package, files: { [ENGINE_GLUE]: { ...record.files[ENGINE_GLUE] }, [ENGINE_WASM]: { ...record.files[ENGINE_WASM] } } };
}

function isFileRecord(v: unknown): v is EngineFileRecord {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const r = v as { sha256?: unknown; bytes?: unknown };
  return typeof r.sha256 === "string" && SHA256_HEX.test(r.sha256) && typeof r.bytes === "number" && Number.isSafeInteger(r.bytes) && r.bytes >= 0;
}

/**
 * Reads a record from JSON text, strictly: schema 2, a `package` of 64 hex
 * digits, a `sources` string, and a `files` block naming exactly the glue and
 * the binary with valid digests and byte counts. Unknown keys, at the top
 * level or inside an entry, are ignored (a later field must not strand an
 * older shell, and the package id covers only the digest and size of each
 * file); an unknown file or a missing one is not. Returns why not on failure, never throws.
 */
export function parseEngineRecord(text: string): { ok: true; record: EnginePackageRecord } | { ok: false; why: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, why: "not JSON" };
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, why: "not an object" };
  const r = v as Record<string, unknown>;
  if (r.schema !== 2) return { ok: false, why: "not schema 2" };
  if (typeof r.sources !== "string") return { ok: false, why: "no sources hash" };
  if (typeof r.package !== "string" || !SHA256_HEX.test(r.package)) return { ok: false, why: "bad package id" };
  const files = r.files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) return { ok: false, why: "no files block" };
  const names = Object.keys(files);
  if (names.length !== 2 || !names.includes(ENGINE_GLUE) || !names.includes(ENGINE_WASM)) return { ok: false, why: "files block does not name exactly the glue and the binary" };
  for (const name of names) {
    if (!isFileRecord((files as Record<string, unknown>)[name])) return { ok: false, why: `bad entry for ${name}` };
  }
  const f = files as EngineFiles;
  const entry = (name: string): EngineFileRecord => ({ sha256: f[name].sha256, bytes: f[name].bytes });
  return { ok: true, record: { schema: 2, sources: r.sources, package: r.package, files: { [ENGINE_GLUE]: entry(ENGINE_GLUE), [ENGINE_WASM]: entry(ENGINE_WASM) } } };
}
