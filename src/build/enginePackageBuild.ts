/**
 * Build-time halves of the engine package check (#985 criterion 5), kept out
 * of vite.config.ts so unit tests can pin them: the expected package the
 * shell is compiled with, and the Workbox `integrity` the three engine
 * precache entries carry. Node only; never imported by the app.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ENGINE_BUILD_RECORD, ENGINE_DIR, ENGINE_GLUE, ENGINE_WASM } from "../wasmhost/enginePackageNames.ts";
import { canonicalFilesJson, expectedOf, parseEngineRecord, type ExpectedEnginePackage } from "../wasmhost/enginePackageRecord.ts";

/**
 * What `__ENGINE_PACKAGE__` is for a build: the record of `src/public/engine/`,
 * or null.
 *
 * - A production build (`mode: "build"`) needs it. A missing package folder is
 *   null, and scripts/verify-precache.ts enforces the opt-in rule afterwards
 *   (`missingEngine` in src/precacheEntry.ts); a record that is missing from a
 *   package that exists, unreadable, or not schema 2 stops the build here.
 * - Anything else (a dev serve, Vitest) is always null and reads nothing, so
 *   `npm test` runs with no Rust toolchain and a dev session never stops for a
 *   stale package. Dev and test skip the byte check.
 */
export function readExpectedPackage(publicDir: string, mode: "build" | "other"): ExpectedEnginePackage | null {
  if (mode === "other") return null;
  const dir = resolve(publicDir, ENGINE_DIR);
  const file = resolve(dir, ENGINE_BUILD_RECORD);
  if (!existsSync(file)) {
    if (!existsSync(dir)) return null;
    throw new Error(`${ENGINE_DIR}${ENGINE_BUILD_RECORD} is missing from a package that exists; rebuild it with npm run wasm:build`);
  }
  const parsed = parseEngineRecord(readFileSync(file, "utf8"));
  if (!parsed.ok) throw new Error(`${ENGINE_DIR}${ENGINE_BUILD_RECORD} is not a usable schema 2 record (${parsed.why}); rebuild the package with npm run wasm:build`);
  return expectedOf(parsed.record);
}

/** The Workbox `integrity` value for some bytes. */
export function integrityOf(bytes: Uint8Array): string {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

/** The engine files whose precache entries carry `integrity`, as manifest URLs. */
export const INTEGRITY_FILES: readonly string[] = [ENGINE_GLUE, ENGINE_WASM, ENGINE_BUILD_RECORD].map((f) => ENGINE_DIR + f);

interface ManifestEntry {
  url: string;
  revision: string | null;
  size: number;
  integrity?: string;
}

/**
 * A Workbox `manifestTransform`: adds `integrity` to the three engine entries,
 * computed from the files in the build output. The browser then rejects a
 * body that differs from the build's own bytes, during install and on a
 * precache-miss fetch, so a mixed set cannot enter the precache. Every other
 * entry is unchanged. An engine entry whose file is not under `distDir` stops
 * the build rather than ship without a check.
 */
export function engineIntegrityTransform(distDir: string | (() => string)) {
  return (entries: ManifestEntry[]): { manifest: ManifestEntry[]; warnings: string[] } => ({
    manifest: entries.map((e) => {
      const url = e.url.split(/[?#]/)[0].replace(/^\.?\//, "");
      if (!INTEGRITY_FILES.includes(url)) return e;
      const dir = typeof distDir === "function" ? distDir() : distDir;
      const file = resolve(dir, url);
      if (!existsSync(file)) throw new Error(`precache entry ${url} has no file under ${dir}, so it cannot carry integrity`);
      return { ...e, integrity: integrityOf(readFileSync(file)) };
    }),
    warnings: [],
  });
}

/** `key: "value"` in a flat object literal, quoted or bare key, either quote,
 *  and only as a whole key (`url`, not `baseurl`). The value is group 2. */
const KEY = (key: string) => new RegExp(`(?:^|[{,\\s])["']?${key}["']?\\s*:\\s*(["'])(.*?)\\1`);

/** The `integrity` each engine entry in a generated precache manifest carries,
 *  by URL. The manifest text is the array `precacheAndRoute(` is called with;
 *  an entry is a flat `{url:"...",revision:"...",integrity:"..."}` object in
 *  any key order. */
export function manifestIntegrity(manifest: string): Map<string, string | undefined> {
  const found = new Map<string, string | undefined>();
  for (const m of manifest.matchAll(/\{[^{}]*\}/g)) {
    const url = KEY("url").exec(m[0])?.[2]?.replace(/^\.?\//, "");
    if (!url) continue;
    found.set(url, KEY("integrity").exec(m[0])?.[2]);
  }
  return found;
}

/**
 * What is wrong with the engine package in a built `dist/`, as sentences (an
 * empty list means it is sound): `dist/engine/BUILD.json` must be a schema 2
 * record whose entries match the glue and binary beside it, whose `package`
 * is the hash of its own files block, and each of the three engine precache
 * entries must carry the `integrity` of the file in `dist/`.
 */
export function engineDistProblems(distDir: string, manifest: string): string[] {
  const problems: string[] = [];
  const recordFile = resolve(distDir, ENGINE_DIR, ENGINE_BUILD_RECORD);
  if (!existsSync(recordFile)) return [`dist/${ENGINE_DIR}${ENGINE_BUILD_RECORD} is missing`];
  const parsed = parseEngineRecord(readFileSync(recordFile, "utf8"));
  if (!parsed.ok) return [`dist/${ENGINE_DIR}${ENGINE_BUILD_RECORD} is not a usable schema 2 record (${parsed.why})`];
  const { record } = parsed;
  const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
  for (const name of [ENGINE_GLUE, ENGINE_WASM]) {
    const file = resolve(distDir, ENGINE_DIR, name);
    if (!existsSync(file)) {
      problems.push(`dist/${ENGINE_DIR}${name} is missing`);
      continue;
    }
    const bytes = readFileSync(file);
    if (bytes.length !== record.files[name].bytes) problems.push(`dist/${ENGINE_DIR}${name} is ${bytes.length} bytes; BUILD.json says ${record.files[name].bytes}`);
    if (sha(bytes) !== record.files[name].sha256) problems.push(`dist/${ENGINE_DIR}${name} does not match the digest in BUILD.json`);
  }
  if (sha(canonicalFilesJson(record.files)) !== record.package) problems.push(`BUILD.json's package id is not the hash of its own files block`);
  const integrity = manifestIntegrity(manifest);
  for (const url of INTEGRITY_FILES) {
    const file = resolve(distDir, url);
    if (!integrity.has(url)) {
      problems.push(`precache entry ${url} is missing from the manifest, so the installed worker would not cache it with the rest of the package`);
      continue;
    }
    const have = integrity.get(url);
    if (!have) problems.push(`precache entry ${url} carries no integrity, so a body from another build could enter the precache`);
    else if (existsSync(file) && have !== integrityOf(readFileSync(file))) problems.push(`precache entry ${url} carries an integrity that is not the digest of the file in dist/`);
  }
  return problems;
}
