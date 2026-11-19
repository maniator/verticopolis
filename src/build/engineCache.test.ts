import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  ENGINE_BUILD_FILES,
  engineCacheKey,
  packageMismatch,
  previewCachesAllowed,
  recordedSources,
  restoreEnginePackage,
  saveEnginePackage,
  staleEnginePackages,
  vercelEngineCache,
} from "./engineCache";
import { engineBuildRecord } from "../wasmhost/enginePackageRecord";
import { ENGINE_GLUE, ENGINE_WASM } from "../wasmhost/enginePackageNames";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vc-engine-cache-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sha256Hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** A package folder with a glue, a binary and the BUILD.json the build writes for them, naming `sources`. */
function writePackage(at: string, sources: string, wasm = "wasm bytes"): void {
  mkdirSync(at, { recursive: true });
  const glue = Buffer.from(`glue for ${wasm}`);
  writeFileSync(join(at, ENGINE_GLUE), glue);
  writeFileSync(join(at, ENGINE_WASM), wasm);
  writeFileSync(join(at, "BUILD.json"), JSON.stringify(engineBuildRecord(glue, Buffer.from(wasm), sources, sha256Hex)));
}

/** A repository root holding every build file and a package.json with the given wasm:build script. */
function writeRoot(root: string, wasmBuild = "node scripts/wasm-build.ts"): void {
  for (const file of [...ENGINE_BUILD_FILES, "extra.ts"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), `contents of ${file}`);
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { "wasm:build": wasmBuild } }));
}

describe("engineCacheKey", () => {
  it("names the prefix and the sources, and moves when a build file, an extra file or the npm script changes", () => {
    const root = join(dir, "root");
    writeRoot(root);
    const base = engineCacheKey(root, "abc", "test-v1", ["extra.ts"]);
    expect(base).toMatch(/^test-v1-abc-[0-9a-f]{16}$/);
    expect(engineCacheKey(root, "abc", "test-v1", ["extra.ts"])).toBe(base);

    writeFileSync(join(root, "scripts/wasm-build.ts"), "changed");
    const afterBuildFile = engineCacheKey(root, "abc", "test-v1", ["extra.ts"]);
    expect(afterBuildFile).not.toBe(base);

    writeFileSync(join(root, "extra.ts"), "changed");
    const afterExtra = engineCacheKey(root, "abc", "test-v1", ["extra.ts"]);
    expect(afterExtra).not.toBe(afterBuildFile);

    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { "wasm:build": "something else" } }));
    expect(engineCacheKey(root, "abc", "test-v1", ["extra.ts"])).not.toBe(afterExtra);
  });

  it("throws when a build file is missing, rather than keying without it", () => {
    const root = join(dir, "root");
    writeRoot(root);
    rmSync(join(root, "src/build/engineCompat.ts"));
    expect(() => engineCacheKey(root, "abc", "test-v1")).toThrow();
  });
});

describe("recordedSources", () => {
  it("reads BUILD.json's sources, and is undefined without one or with an unreadable one", () => {
    writePackage(join(dir, "pkg"), "abc");
    expect(recordedSources(join(dir, "pkg"))).toBe("abc");
    expect(packageMismatch(join(dir, "pkg"))).toBeUndefined();
    expect(recordedSources(join(dir, "none"))).toBeUndefined();
    mkdirSync(join(dir, "bad"));
    writeFileSync(join(dir, "bad", "BUILD.json"), "{ not json");
    expect(recordedSources(join(dir, "bad"))).toBeUndefined();
  });
});

describe("staleEnginePackages (#1369)", () => {
  it("names each package built from other sources, and skips a folder with no record", () => {
    writePackage(join(dir, "public/engine"), "abc");
    writePackage(join(dir, "tooling"), "old");
    mkdirSync(join(dir, "bad"));
    writeFileSync(join(dir, "bad", "BUILD.json"), "{ not json");
    const dirs = ["public/engine", "tooling", "bad", "absent"];
    expect(staleEnginePackages(dir, "abc", dirs)).toEqual(["tooling (built from old)", "bad (built from unreadable sources)"]);
    expect(staleEnginePackages(dir, "old", ["tooling"])).toEqual([]);
  });
});

describe("restoreEnginePackage and saveEnginePackage", () => {
  it("saves a package and restores the same bytes in place of whatever was there", () => {
    const cache = join(dir, "cache");
    const pkg = join(dir, "public/engine");
    writePackage(pkg, "abc", "built");
    saveEnginePackage(cache, "key-1", "abc", pkg);

    writePackage(pkg, "old", "stale");
    writeFileSync(join(pkg, "leftover.js"), "from another build");
    expect(restoreEnginePackage(cache, "key-1", "abc", pkg)).toEqual({ kind: "hit" });
    expect(readFileSync(join(pkg, "verticopolis_engine_bg.wasm"), "utf8")).toBe("built");
    expect(recordedSources(pkg)).toBe("abc");
    expect(existsSync(join(pkg, "leftover.js"))).toBe(false);
  });

  it("misses without touching the package when no entry has the key", () => {
    const pkg = join(dir, "public/engine");
    writePackage(pkg, "old", "stale");
    const result = restoreEnginePackage(join(dir, "cache"), "key-1", "abc", pkg);
    expect(result.kind).toBe("miss");
    expect(readFileSync(join(pkg, "verticopolis_engine_bg.wasm"), "utf8")).toBe("stale");
  });

  it("misses when a cached file does not match its record, so a truncated or corrupted entry is rebuilt", () => {
    const cache = join(dir, "cache");
    const pkg = join(dir, "public/engine");
    writePackage(pkg, "abc", "built");
    saveEnginePackage(cache, "key-1", "abc", pkg);
    writeFileSync(join(cache, "key-1", ENGINE_WASM), "buil");
    expect(restoreEnginePackage(cache, "key-1", "abc", pkg)).toEqual({
      kind: "miss",
      why: `the cached package does not match its record (${ENGINE_WASM} is 4 bytes, not the 5 its record names)`,
    });
    writeFileSync(join(cache, "key-1", ENGINE_WASM), "BUILT");
    expect(restoreEnginePackage(cache, "key-1", "abc", pkg)).toEqual({
      kind: "miss",
      why: `the cached package does not match its record (${ENGINE_WASM} does not match the SHA-256 its record names)`,
    });
    rmSync(join(cache, "key-1", ENGINE_GLUE));
    expect(restoreEnginePackage(cache, "key-1", "abc", pkg).kind).toBe("miss");
  });

  it("refuses to save a package whose files do not match its record", () => {
    const pkg = join(dir, "public/engine");
    writePackage(pkg, "abc", "built");
    writeFileSync(join(pkg, ENGINE_WASM), "other");
    expect(() => saveEnginePackage(join(dir, "cache"), "key-1", "abc", pkg)).toThrow(/does not match its record/);
    expect(existsSync(join(dir, "cache"))).toBe(false);
  });

  it("misses when the cached copy names other sources than the key's", () => {
    const cache = join(dir, "cache");
    writePackage(join(cache, "key-1"), "other");
    const pkg = join(dir, "public/engine");
    const result = restoreEnginePackage(cache, "key-1", "abc", pkg);
    expect(result).toEqual({ kind: "miss", why: "the cached package names sources other, not abc" });
    expect(existsSync(pkg)).toBe(false);
  });

  it("keeps one entry: saving replaces every earlier key", () => {
    const cache = join(dir, "cache");
    const pkg = join(dir, "public/engine");
    writePackage(pkg, "abc");
    saveEnginePackage(cache, "key-1", "abc", pkg);
    writePackage(pkg, "def");
    saveEnginePackage(cache, "key-2", "def", pkg);
    expect(readdirSync(cache)).toEqual(["key-2"]);
  });

  it("refuses to save a package built from other sources, and leaves the cache alone", () => {
    const cache = join(dir, "cache");
    const pkg = join(dir, "public/engine");
    writePackage(pkg, "abc");
    saveEnginePackage(cache, "key-1", "abc", pkg);
    writePackage(pkg, "stale");
    expect(() => saveEnginePackage(cache, "key-2", "abc", pkg)).toThrow(/names sources stale/);
    expect(readdirSync(cache)).toEqual(["key-1"]);
  });
});

describe("the Vercel preview gate", () => {
  it("allows the caches only when VERCEL_ENV is exactly preview", () => {
    expect(previewCachesAllowed({ VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "staging" })).toBe(true);
    expect(previewCachesAllowed({ VERCEL_ENV: "production" })).toBe(false);
    expect(previewCachesAllowed({ VERCEL_ENV: "development" })).toBe(false);
    expect(previewCachesAllowed({ VERCEL_ENV: "Preview" })).toBe(false);
    expect(previewCachesAllowed({})).toBe(false);
  });

  /** A repository root with a cached package for its key and a different package in place. */
  function rootWithCache(): { root: string; sourcesOf: (crate: string) => string; calls: string[] } {
    const root = join(dir, "root");
    writeRoot(root);
    writeFileSync(join(root, "scripts/vercel-engine-cache.ts"), "the cache script");
    const calls: string[] = [];
    const sourcesOf = (crate: string) => {
      calls.push(crate);
      return "abc";
    };
    const key = engineCacheKey(root, "abc", "vercel-engine-v1", ["scripts/vercel-engine-cache.ts"]);
    writePackage(join(root, "node_modules/.cache/vc-engine", key), "abc", "cached");
    writePackage(join(root, "src/public/engine"), "abc", "fresh");
    return { root, sourcesOf, calls };
  }

  it("restores and saves on a preview", () => {
    const { root, sourcesOf, calls } = rootWithCache();
    const restored = vercelEngineCache("restore", root, { VERCEL_ENV: "preview" }, sourcesOf);
    expect(restored.restored).toBe(true);
    expect(readFileSync(join(root, "src/public/engine", ENGINE_WASM), "utf8")).toBe("cached");
    expect(calls).toEqual([join(root, "engine-rs")]);
    expect(vercelEngineCache("save", root, { VERCEL_ENV: "preview" }, sourcesOf).restored).toBe(false);
    expect(readdirSync(join(root, "node_modules/.cache/vc-engine"))).toHaveLength(1);
  });

  it("never restores or saves for production, development or an unset VERCEL_ENV", () => {
    for (const env of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, {}]) {
      const { root, sourcesOf, calls } = rootWithCache();
      const cacheBefore = readdirSync(join(root, "node_modules/.cache/vc-engine"));
      expect(vercelEngineCache("restore", root, env, sourcesOf).restored).toBe(false);
      expect(readFileSync(join(root, "src/public/engine", ENGINE_WASM), "utf8")).toBe("fresh");
      // A save outside a preview would replace the entry with the fresh package; it must not.
      writePackage(join(root, "src/public/engine"), "def", "other");
      expect(() => vercelEngineCache("save", root, env, sourcesOf)).not.toThrow();
      expect(readdirSync(join(root, "node_modules/.cache/vc-engine"))).toEqual(cacheBefore);
      expect(calls).toEqual([]);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
