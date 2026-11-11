/**
 * The emitted-bundle guard for the engine build.
 *
 * Every build is **wasm-only**: the Rust/WASM engine is the only engine the
 * game runs (the TypeScript engine's code is gone, #1875). A production build
 * carries none of the harnesses' tower (#921); only a `VC_TOOLING=1` build
 * does (`src/game/toolingSim.ts`). `scripts/verify-engine-bundle.ts` runs
 * after every build and checks the emitted sourcemaps and the service-worker
 * precache with {@link checkEngineBundle}, so the result is proven from what
 * the bundler wrote rather than from source imports.
 *
 * Keep this file ERASABLE (no enums, namespaces or parameter properties) so
 * `node` can run the script that imports it directly.
 */

/** The tooling harnesses' hand-built tower; every build but a tooling one
 *  swaps it for `src/game/toolingSimAbsent.ts`. */
export const TOOLING_SIM = "src/game/toolingSim.ts";

/** The engine package files the precache must carry. */
export const ENGINE_PACKAGE_FILES: readonly string[] = ["engine/verticopolis_engine.js", "engine/verticopolis_engine_bg.wasm"];

/** One emitted JavaScript file and the repository-relative sources its
 *  sourcemap lists (`src/...`, `node_modules/...`), with any query suffix
 *  (`?worker`) removed. */
export interface EmittedChunk {
  file: string;
  sources: readonly string[];
}

export interface EngineBundleInput {
  /** A `VC_TOOLING=1` build (e2e, screenshots, perf). */
  tooling: boolean;
  chunks: readonly EmittedChunk[];
  /** Precache URLs from `sw.js`, relative to `dist/`. */
  precache: readonly string[];
  /** Whether `dist/` holds the engine package. A build without one is a
   *  deliberate opt-out (`VC_ALLOW_NO_ENGINE=1`, refused on a deploy) that
   *  `scripts/verify-precache.ts` has already allowed or stopped, so the
   *  engine's precache entries are only required when the package is there. */
  enginePackageBuilt: boolean;
}

export interface EngineBundleResult {
  errors: string[];
}

const isTestSource = (s: string): boolean =>
  s.startsWith("src/tests/") || s.startsWith("e2e/") || s.includes("/__mocks__/") || /\.(test|spec)\.[mc]?[jt]sx?$/.test(s);

/** Check the emitted bundle. Pure: the script reads the files and passes them
 *  in. */
export function checkEngineBundle(input: EngineBundleInput): EngineBundleResult {
  const errors: string[] = [];
  if (input.chunks.length === 0) errors.push("no emitted JavaScript with a sourcemap was found, so the bundle cannot be checked");
  for (const chunk of input.chunks) {
    for (const s of chunk.sources) {
      if (isTestSource(s)) errors.push(`${chunk.file} carries test code (${s})`);
      if (!input.tooling && s === TOOLING_SIM) errors.push(`${chunk.file} carries the tooling harnesses' tower (${s}), which only a VC_TOOLING=1 build may ship`);
    }
  }
  const pre = new Set(input.precache);
  const absent = input.enginePackageBuilt ? ENGINE_PACKAGE_FILES.filter((f) => !pre.has(f)) : [];
  if (absent.length > 0) errors.push(`the build does not precache the engine package (${absent.join(", ")}), so it could not start offline`);
  return { errors };
}

/** A sourcemap source as a repository-relative path: the query suffix a
 *  bundler adds to a module id (`?worker_file&type=module`) is dropped, so
 *  the checks above compare plain paths. */
export function repoRelativeSource(path: string, root: string): string {
  const plain = path.replace(/[?#].*$/, "");
  return plain.startsWith(`${root}/`) ? plain.slice(root.length + 1) : plain.replace(/^\//, "");
}

/** The precache URLs in a Workbox `sw.js`: the entries of the array passed to
 *  `precacheAndRoute`, and nothing else in the worker. Null when the call or
 *  its array cannot be found. */
export function precacheManifest(sw: string): string[] | null {
  // The call with an array literal argument, so an inlined Workbox runtime's
  // own `function precacheAndRoute(e,t){` is never read as the manifest.
  const call = /precacheAndRoute\(\s*\[/.exec(sw);
  if (!call) return null;
  const open = call.index + call[0].length - 1;
  let depth = 0;
  for (let i = open; i < sw.length; i++) {
    if (sw[i] === "[") depth++;
    else if (sw[i] === "]" && --depth === 0) {
      return [...sw.slice(open, i + 1).matchAll(/["']?url["']?\s*:\s*(["'])(.*?)\1/g)].map((m) => m[2].replace(/^\.?\//, ""));
    }
  }
  return null;
}
