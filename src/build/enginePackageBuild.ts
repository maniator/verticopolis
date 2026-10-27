/**
 * Build-time halves of the engine package check (#985 criterion 5), kept out
 * of vite.config.ts so unit tests can pin them: the expected package the
 * shell is compiled with, and the Workbox `integrity` the three engine
 * precache entries carry. Node only; never imported by the app.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { DEV_SKIP_MARKER, ENGINE_BUILD_RECORD, ENGINE_DIR, ENGINE_GLUE, ENGINE_WASM } from "../wasmhost/enginePackageNames.ts";
import { canonicalFilesJson, expectedOf, parseEngineRecord, type ExpectedEnginePackage } from "../wasmhost/enginePackageRecord.ts";

/** A text file as the page reads it: the page's TextDecoder drops a leading
 *  byte order mark, so the build does too. */
const readText = (file: string): string => readFileSync(file, "utf8").replace(/^\uFEFF/, "");

/**
 * What `__ENGINE_PACKAGE__` is for a build: the record of `src/public/engine/`,
 * or null.
 *
 * - A production build (`mode: "build"`) needs it. A missing package folder is
 *   null, and scripts/verify-precache.ts enforces the opt-in rule afterwards
 *   (`missingEngine` in src/precacheEntry.ts); a record that is missing from a
 *   package that exists, unreadable, or not schema 2 stops the build here.
 *   A leftover folder with a bad record stops a VC_ALLOW_NO_ENGINE=1 build too
 *   (verify-precache.ts would stop it afterwards anyway); delete the folder.
 * - Anything else (a dev serve, Vitest) is always null and reads nothing, so
 *   `npm test` runs with no Rust toolchain and a dev session never stops for a
 *   stale package. Dev and test skip the byte check.
 */
export function readExpectedPackage(publicDir: string, mode: "build" | "other"): ExpectedEnginePackage | null {
  if (mode === "other") return null;
  const dir = resolve(publicDir, ENGINE_DIR);
  const file = resolve(dir, ENGINE_BUILD_RECORD);
  if (!existsSync(file)) {
    // An empty folder counts as no package, as scripts/verify-precache.ts counts it.
    if (!existsSync(dir) || readdirSync(dir).length === 0) return null;
    throw new Error(`${ENGINE_DIR}${ENGINE_BUILD_RECORD} is missing from a package that exists; rebuild it with npm run wasm:build`);
  }
  const parsed = parseEngineRecord(readText(file));
  if (!parsed.ok) throw new Error(`${ENGINE_DIR}${ENGINE_BUILD_RECORD} is not a usable schema 2 record (${parsed.why}); rebuild the package with npm run wasm:build`);
  return { ...expectedOf(parsed.record), revisions: revisionsOf(dir) };
}

/**
 * Added to an engine file's MD5 to make its precache revision. Workbox keys an
 * entry `url?__WB_REVISION__=<revision>` and, on install, trusts an entry that
 * is already cached: a worker from before the integrity attribute may have
 * stored a mixed set under the plain MD5 keys, and a new worker whose files
 * have the same MD5 would keep it. A revision no earlier worker used makes the
 * first integrity-checked worker fetch all three files and lets its activation
 * drop the old keys (design section 8). Change the suffix only for a new reason
 * to retire every stored engine entry.
 */
export const ENGINE_REVISION_SUFFIX = "-i2";

/** The precache revision of an engine file's bytes. */
export function engineRevision(bytes: Uint8Array): string {
  return `${createHash("md5").update(bytes).digest("hex")}${ENGINE_REVISION_SUFFIX}`;
}

/** The precache revision of each engine file under `engineDir`, which the
 *  transform below writes into the manifest and Repair uses to name the
 *  entry's cache key. */
export function revisionsOf(engineDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [ENGINE_GLUE, ENGINE_WASM, ENGINE_BUILD_RECORD]) {
    const file = resolve(engineDir, name);
    if (existsSync(file)) out[name] = engineRevision(readFileSync(file));
  }
  return out;
}

/** The `revision` of each entry in the precache manifest, by URL. */
export function manifestRevisions(manifest: string): Map<string, string | undefined> {
  const found = new Map<string, string | undefined>();
  for (const m of manifest.matchAll(/\{[^{}]*\}/g)) {
    const url = KEY("url").exec(m[0])?.[2]?.replace(/^\.?\//, "");
    if (url) found.set(url, KEY("revision").exec(m[0])?.[2]);
  }
  return found;
}

/** The Workbox `integrity` value for some bytes. */
export function integrityOf(bytes: Uint8Array): string {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

/** The engine files whose precache entries carry `integrity`, as manifest URLs. */
export const INTEGRITY_FILES: readonly string[] = [ENGINE_GLUE, ENGINE_WASM, ENGINE_BUILD_RECORD].map((f) => ENGINE_DIR + f);

/** Precache entries the manifest transforms never see: vite-plugin-pwa adds the
 *  web app manifest through `additionalManifestEntries`, which workbox-build
 *  applies after the transforms, so it carries no integrity. The offline cold
 *  start does not read it. */
export const NO_INTEGRITY_FILES: readonly string[] = ["manifest.webmanifest"];

interface ManifestEntry {
  url: string;
  revision: string | null;
  size: number;
  integrity?: string;
}

/**
 * A Workbox `manifestTransform`: adds `integrity` to every entry whose file is
 * in the build output, and gives the three engine entries the revision of
 * {@link engineRevision}. The browser then rejects a
 * body that differs from the build's own bytes, during install and on a
 * precache-miss fetch, so a mixed set cannot enter the precache. An entry
 * whose file is not under `distDir` is left as it is, except an engine entry,
 * which stops the build rather than ship without a check.
 */
export function engineIntegrityTransform(distDir: string | (() => string), options: { shell?: boolean } = {}) {
  return (entries: ManifestEntry[]): { manifest: ManifestEntry[]; warnings: string[] } => {
    const dir = typeof distDir === "function" ? distDir() : distDir;
    return {
      manifest: entries.map((e) => {
        const url = e.url.split(/[?#]/)[0].replace(/^\.?\//, "");
        const file = resolve(dir, url);
        if (!INTEGRITY_FILES.includes(url)) {
          if (options.shell === false) return e;
          // Any other entry keeps its revision and gains the integrity of its file,
          // so a precache miss on a controlled page stores the file (Workbox caches
          // a missed entry only when the manifest carries integrity) and the shell
          // comes back after the cache is lost.
          if (!existsSync(file) || !statSync(file).isFile()) return e;
          return { ...e, integrity: integrityOf(readFileSync(file)) };
        }
        if (!existsSync(file)) throw new Error(`precache entry ${url} has no file under ${dir}, so it cannot carry integrity`);
        const bytes = readFileSync(file);
        return { ...e, revision: engineRevision(bytes), integrity: integrityOf(bytes) };
      }),
      warnings: [],
    };
  };
}

/** `key: "value"` in a flat object literal, quoted or bare key, either quote,
 *  and only as a whole key (`baseurl` does not match `url`). The value is group 2. */
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
  const parsed = parseEngineRecord(readText(recordFile));
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
  // Every other entry whose file is in dist/ carries its integrity too, so a
  // precache miss on a controlled page stores it and the shell self-heals.
  for (const [url, have] of integrity) {
    if (INTEGRITY_FILES.includes(url) || NO_INTEGRITY_FILES.includes(url)) continue;
    const file = resolve(distDir, url);
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    if (!have) problems.push(`precache entry ${url} carries no integrity, so the shell would not come back after the cache is lost`);
    else if (have !== integrityOf(readFileSync(file))) problems.push(`precache entry ${url} carries an integrity that is not the digest of the file in dist/`);
  }
  // Repair names the running build's cache keys by revision, so each engine
  // entry's revision must be the one of the file the shell was built with.
  const revisions = manifestRevisions(manifest);
  const wanted = revisionsOf(resolve(distDir, ENGINE_DIR));
  for (const url of INTEGRITY_FILES) {
    const want = wanted[url.slice(ENGINE_DIR.length)];
    if (revisions.has(url) && revisions.get(url) !== want) problems.push(`precache entry ${url} has revision ${revisions.get(url) ?? "none"}; the file in dist/ has ${want}, so Repair would name another cache key`);
  }
  return problems;
}

/**
 * What is wrong with the precache revisions the shell carries, as sentences:
 * Repair names the running build's cache keys by the revisions compiled into
 * its scripts, so each engine file's revision must appear in one of them. The
 * worker script and its runtime do not count: the worker's manifest carries
 * every revision whatever the shell was compiled with.
 */
export function shellRevisionProblems(distDir: string): string[] {
  const texts = emittedScripts(distDir)
    .filter((f) => !/^(?:sw|workbox-[^/]*)\.js$/.test(f))
    .map((f) => readFileSync(resolve(distDir, f), "utf8"));
  const problems: string[] = [];
  for (const [name, revision] of Object.entries(revisionsOf(resolve(distDir, ENGINE_DIR)))) {
    if (!texts.some((t) => t.includes(revision))) problems.push(`no script in dist/ carries the precache revision of ${ENGINE_DIR}${name}, so Repair could not name its cache key`);
  }
  return problems;
}

/** Every `.js` and `.html` file under a folder, as folder-relative POSIX paths. */
function emittedScripts(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(?:js|mjs|html)$/.test(e.name))
    .map((e) => relative(dir, resolve(e.parentPath ?? (e as { path?: string }).path ?? dir, e.name)).split(sep).join("/"));
}

/** A package id as an object literal's `package` member, bare or quoted key. */
const PACKAGE_MEMBER = /\\?["'`]?\bpackage\\?["'`]?\s*:\s*\\?["'`]([0-9a-f]{64})\\?["'`]/g;

/**
 * What is wrong with the shell in a built `dist/`, as sentences (an empty list
 * means it is sound). The page checks the engine against the package id
 * compiled into its chunks, so:
 *
 * - no emitted script may carry the development-only skip of the byte check
 *   (its marker line, see `loadEngineModule.ts`), whatever the build;
 * - when the build ships an engine, some chunk must carry the id of
 *   `dist/engine/BUILD.json` (the loader's chunk), and no chunk may carry any
 *   other id, so the shell and the engine it checks are the same build.
 *
 * `hasEngine` is false for a deliberate no-engine build, which has no id.
 */
export function shellProblems(distDir: string, hasEngine: boolean): string[] {
  const problems: string[] = [];
  const scripts = emittedScripts(distDir);
  const withId = new Map<string, Set<string>>();
  for (const file of scripts) {
    const text = readFileSync(resolve(distDir, file), "utf8");
    if (text.includes(DEV_SKIP_MARKER)) problems.push(`dist/${file} still carries the development-only skip of the engine byte check`);
    const ids = new Set([...text.matchAll(PACKAGE_MEMBER)].map((m) => m[1]));
    if (ids.size > 0) withId.set(file, ids);
  }
  if (!hasEngine) return problems;
  const recordFile = resolve(distDir, ENGINE_DIR, ENGINE_BUILD_RECORD);
  const parsed = existsSync(recordFile) ? parseEngineRecord(readText(recordFile)) : null;
  if (!parsed?.ok) return [...problems, `cannot compare the shell with the engine package: dist/${ENGINE_DIR}${ENGINE_BUILD_RECORD} is missing or unusable`];
  const want = parsed.record.package;
  const carriers = [...withId].filter(([, ids]) => ids.has(want)).map(([file]) => file);
  if (carriers.length === 0) problems.push(`no script in dist/ carries the engine package id ${want.slice(0, 12)} from BUILD.json, so the page would check the engine against nothing`);
  for (const [file, ids] of withId) {
    const other = [...ids].filter((id) => id !== want);
    if (other.length > 0) problems.push(`dist/${file} carries engine package id ${other.map((id) => id.slice(0, 12)).join(", ")}, but dist/${ENGINE_DIR}${ENGINE_BUILD_RECORD} says ${want.slice(0, 12)}`);
  }
  return problems;
}
