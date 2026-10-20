import { DEV_SKIP_MARKER, ENGINE_BUILD_RECORD, ENGINE_WASM } from "./enginePackageNames";
import { browserDigest, EnginePackageAborted, isControlled, verifyEnginePackage, type PackageUrls, type VerifyOptions } from "./enginePackageCheck";
import type { ExpectedEnginePackage } from "./enginePackageRecord";

/**
 * The one place that turns the served engine package into a running module
 * (#985 criterion 5). The main-thread boot, the engine worker and the dual
 * run's worker all load through it, so no route runs bytes the shell was not
 * built for. Design: _bmad-output/planning-artifacts/design/
 * design-engine-package-set-consistency-2026-10-15.md, section 5.3.
 *
 * It fetches `BUILD.json`, the glue and the binary once each, refuses unless
 * they are the package this shell was built with (`verifyEnginePackage`),
 * imports the glue from a Blob made of the very bytes that were hashed, and
 * hands the verified binary to the glue's `init`. Nothing is fetched a second
 * time, so a cache that changes between the check and the run cannot matter.
 *
 * Permanent host infrastructure: it is the load path of the Rust engine in
 * every build, and nothing in it depends on the TypeScript engine.
 */

/** What the wasm-bindgen glue exports: `default` is its `init`. */
export interface EngineGlue {
  default(input?: { module_or_path: BufferSource | WebAssembly.Module }): Promise<{ memory?: WebAssembly.Memory } | undefined>;
}

export interface LoadedEngine {
  /** The glue's module namespace, ready for `checkBinding`. */
  mod: EngineGlue;
  /** What `init` returned: the instance's exports, for the linear memory. */
  exports: { memory?: WebAssembly.Memory } | undefined;
  /** False only for a development serve, which skips the byte check. */
  verified: boolean;
}

export interface LoadEngineOptions {
  /** Aborted when the caller's deadline passes. Checked after every await. */
  signal?: AbortSignal;
  /** The package the shell was built with (default: the compiled-in one). */
  expected?: ExpectedEnginePackage | null;
  /** Run the byte check on a development serve too (the tests do). */
  checkInDev?: boolean;
  // The rest are test seams; the browser supplies each by default.
  fetch?: VerifyOptions["fetch"];
  digest?: VerifyOptions["digest"];
  controlled?: boolean;
  origin?: string;
  importModule?: (url: string) => Promise<EngineGlue>;
  objectUrls?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}

/** The URLs of the three files, from the URL the glue is served at. */
export function enginePackageUrls(glue: string): PackageUrls {
  return { glue, wasm: new URL(ENGINE_WASM, glue).href, record: new URL(ENGINE_BUILD_RECORD, glue).href };
}

const importByUrl = (url: string) => import(/* @vite-ignore */ url) as Promise<EngineGlue>;

/**
 * Load and initialize the engine package served at `glueUrl`. Rejects with an
 * `EnginePackageError` for a refusal (see {@link verifyEnginePackage}), or
 * `EnginePackageAborted` once `signal` fires; a late result is dropped.
 */
export async function loadEngineModule(glueUrl: string, opts: LoadEngineOptions = {}): Promise<LoadedEngine> {
  const importModule = opts.importModule ?? importByUrl;
  // A development serve rebuilds the package under a running page (`npm run
  // wasm:build`), so it loads without the check. The production build
  // replaces `import.meta.env.DEV` with `false` and drops this branch with
  // its marker line; scripts/verify-precache.ts fails the build if it stays.
  if (import.meta.env.DEV && !opts.checkInDev) {
    console.info(`[wasm] ${DEV_SKIP_MARKER}`);
    const mod = await importModule(glueUrl);
    return { mod, exports: await mod.default(), verified: false };
  }
  const signal = opts.signal ?? new AbortController().signal;
  const gone = () => {
    if (signal.aborted) throw new EnginePackageAborted();
  };
  const { glue, wasm } = await verifyEnginePackage({
    expected: opts.expected === undefined ? __ENGINE_PACKAGE__ : opts.expected,
    urls: enginePackageUrls(glueUrl),
    fetch: opts.fetch ?? ((url, init) => fetch(url, init)),
    digest: "digest" in opts ? opts.digest : browserDigest(),
    signal,
    controlled: opts.controlled ?? isControlled(globalThis.navigator),
    origin: opts.origin ?? globalThis.location.origin,
  });
  gone();
  const urls = opts.objectUrls ?? URL;
  const blobUrl = urls.createObjectURL(new Blob([glue as BlobPart], { type: "text/javascript" }));
  let mod: EngineGlue;
  try {
    mod = await importModule(blobUrl);
  } finally {
    urls.revokeObjectURL(blobUrl);
  }
  gone();
  const exports = await mod.default({ module_or_path: wasm });
  gone();
  return { mod, exports, verified: true };
}
