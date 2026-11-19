/**
 * The engine package cache: what a cached copy of the browser engine package
 * (`src/public/engine/`) is keyed on, and how a build restores and saves one.
 *
 * CI keys its Actions cache with `engineCacheKey` (.github/actions/engine-wasm)
 * and a Vercel preview keeps one copy in its build cache
 * (scripts/vercel-engine-cache.ts), so a push that leaves the engine alone
 * reuses the package instead of installing Rust and compiling it again.
 *
 * Node only (the build scripts and CI); never imported by the app.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEngineRecord } from "../wasmhost/enginePackageRecord.ts";
import { ENGINE_BUILD_RECORD } from "../wasmhost/enginePackageNames.ts";

/**
 * The files the package's build runs or checks it with, beside the crate
 * itself: the scripts that build it and write its third-party record (#955)
 * and every module they import, so a change to what the build checks rebuilds
 * instead of restoring a package the old checks passed.
 */
export const ENGINE_BUILD_FILES = [
  "scripts/wasm-build.ts",
  "scripts/engine-third-party.ts",
  "scripts/license-files.ts",
  "src/build/thirdPartyNotices.ts",
  "src/build/rustNotices.ts",
  "src/wasmhost/packageHash.ts",
  "src/wasmhost/engineAssets.ts",
  "src/wasmhost/enginePackageNames.ts",
  "src/wasmhost/enginePackageRecord.ts",
  "src/wasmhost/buildSection.ts",
  "src/build/engineCompat.ts",
  "src/events/gameplayCatalog.ts",
  "scripts/build-engine-wasm.sh",
  "src/build/engineCache.ts",
] as const;

/** Where the browser engine package lives, relative to the repository root. */
export const ENGINE_PACKAGE_DIR = "src/public/engine";

/**
 * The cache key for a package built from `sources` (engineSourceHash of the
 * crate): `prefix`, the source hash, and 16 hex characters of a SHA-256 over
 * the build files, then `extraFiles` (the caller's own cache logic, which
 * decides what a hit means), then the `wasm:build` npm script line.
 */
export function engineCacheKey(root: string, sources: string, prefix: string, extraFiles: readonly string[] = []): string {
  const hash = createHash("sha256");
  for (const file of [...ENGINE_BUILD_FILES, ...extraFiles]) hash.update(readFileSync(resolve(root, file)));
  const scripts = (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  hash.update(`${scripts["wasm:build"] ?? ""}\n`);
  return `${prefix}-${sources}-${hash.digest("hex").slice(0, 16)}`;
}

/** The `sources` hash a package's BUILD.json records, or undefined when it has none. */
export function recordedSources(packageDir: string): string | undefined {
  const file = join(packageDir, ENGINE_BUILD_RECORD);
  if (!existsSync(file)) return undefined;
  try {
    const sources = (JSON.parse(readFileSync(file, "utf8")) as { sources?: unknown }).sources;
    return typeof sources === "string" ? sources : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The packages among `dirs` (relative to `root`) whose BUILD.json names
 * other sources than `sources`, each as "<dir> (built from <hash>)". A folder
 * with no BUILD.json is left to whatever needs it to report as missing. The
 * screenshot generator refuses a local run on a stale package (#1369).
 */
export function staleEnginePackages(root: string, sources: string, dirs: readonly string[]): string[] {
  const stale: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(join(root, dir, ENGINE_BUILD_RECORD))) continue;
    const recorded = recordedSources(join(root, dir));
    if (recorded !== sources) stale.push(`${dir} (built from ${recorded ?? "unreadable sources"})`);
  }
  return stale;
}

/**
 * Why a package folder does not match its own BUILD.json (a record that does
 * not parse, or a glue or binary whose size or SHA-256 differs from the
 * record's), or undefined when every file matches.
 */
export function packageMismatch(packageDir: string): string | undefined {
  const file = join(packageDir, ENGINE_BUILD_RECORD);
  if (!existsSync(file)) return `no ${ENGINE_BUILD_RECORD}`;
  const parsed = parseEngineRecord(readFileSync(file, "utf8"));
  if (!parsed.ok) return `${ENGINE_BUILD_RECORD} is unreadable: ${parsed.why}`;
  for (const [name, want] of Object.entries(parsed.record.files)) {
    const path = join(packageDir, name);
    if (!existsSync(path)) return `${name} is missing`;
    const bytes = readFileSync(path);
    if (bytes.length !== want.bytes) return `${name} is ${bytes.length} bytes, not the ${want.bytes} its record names`;
    if (createHash("sha256").update(bytes).digest("hex") !== want.sha256) return `${name} does not match the SHA-256 its record names`;
  }
  return undefined;
}

/** What a restore did: `hit` put the cached package in place; `miss` left the package directory alone. */
export type RestoreResult = { kind: "hit" } | { kind: "miss"; why: string };

/**
 * Put the package cached under `key` in `cacheRoot` into `packageDir`, only
 * when that copy's BUILD.json names `sources` and its glue and binary match
 * the record byte for byte. Anything else (a truncated or corrupted entry, or
 * one from other sources) is a miss, so the caller builds.
 */
export function restoreEnginePackage(cacheRoot: string, key: string, sources: string, packageDir: string): RestoreResult {
  const entry = join(cacheRoot, key);
  if (!existsSync(entry)) return { kind: "miss", why: `no cached package under ${key}` };
  const cached = recordedSources(entry);
  if (cached !== sources) return { kind: "miss", why: `the cached package names sources ${cached ?? "(none)"}, not ${sources}` };
  const mismatch = packageMismatch(entry);
  if (mismatch) return { kind: "miss", why: `the cached package does not match its record (${mismatch})` };
  rmSync(packageDir, { recursive: true, force: true });
  cpSync(entry, packageDir, { recursive: true });
  return { kind: "hit" };
}

/**
 * Cache the package in `packageDir` under `key`, replacing every other entry
 * in `cacheRoot` so the cache holds one package and does not grow. Throws when
 * the package's BUILD.json does not name `sources` or its files do not match
 * the record: such a package must never be saved under this key.
 */
export function saveEnginePackage(cacheRoot: string, key: string, sources: string, packageDir: string): void {
  const built = recordedSources(packageDir);
  if (built !== sources) throw new Error(`${packageDir}/${ENGINE_BUILD_RECORD} names sources ${built ?? "(none)"}, but the tree's Rust sources hash to ${sources}; not caching it`);
  const mismatch = packageMismatch(packageDir);
  if (mismatch) throw new Error(`${packageDir} does not match its record (${mismatch}); not caching it`);
  rmSync(cacheRoot, { recursive: true, force: true });
  cpSync(packageDir, join(cacheRoot, key), { recursive: true });
}

/**
 * Whether a Vercel build may use the preview caches. Only a preview may
 * (`VERCEL_ENV=preview`; the staging custom environment reports preview too,
 * with `staging` in VERCEL_TARGET_ENV). Production, development, a local
 * `vercel build` without pulled settings and anything unexpected build from
 * scratch, so the gate fails closed.
 */
export function previewCachesAllowed(env: Record<string, string | undefined>): boolean {
  return env.VERCEL_ENV === "preview";
}

/** What `vercelEngineCache` did, for the build log. */
export interface VercelEngineCacheResult {
  /** True only when a cached package was put in place. */
  restored: boolean;
  message: string;
}

/**
 * The Vercel build's engine cache step, for the repository at `root`:
 * `restore` puts the cached package in place on a preview hit, and `save`
 * caches the package just built on a preview. Outside a preview both do
 * nothing, so production never reads or writes the cache.
 */
export function vercelEngineCache(
  command: "restore" | "save",
  root: string,
  env: Record<string, string | undefined>,
  sourcesOf: (crate: string) => string,
): VercelEngineCacheResult {
  if (!previewCachesAllowed(env)) {
    return { restored: false, message: `VERCEL_ENV is ${env.VERCEL_ENV ?? "unset"}, not preview; the engine cache is not used` };
  }
  const cacheRoot = resolve(root, "node_modules/.cache/vc-engine");
  const packageDir = resolve(root, ENGINE_PACKAGE_DIR);
  const sources = sourcesOf(resolve(root, "engine-rs"));
  const key = engineCacheKey(root, sources, "vercel-engine-v1", ["scripts/vercel-engine-cache.ts"]);
  if (command === "save") {
    saveEnginePackage(cacheRoot, key, sources, packageDir);
    return { restored: false, message: `cached the engine package as ${key}` };
  }
  const result = restoreEnginePackage(cacheRoot, key, sources, packageDir);
  return result.kind === "hit"
    ? { restored: true, message: `restored the engine package for ${key}; skipping the Rust build` }
    : { restored: false, message: `${result.why}; building the engine` };
}
