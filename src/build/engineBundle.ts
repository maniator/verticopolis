/**
 * The emitted-bundle guard for the engine build.
 *
 * Every build is **wasm-only**: the Rust/WASM engine is the only engine the
 * game runs, and the TypeScript step loop is not in the bundle.
 * `scripts/verify-engine-bundle.ts` runs after every build and checks the
 * emitted sourcemaps and the service-worker precache with
 * {@link checkEngineBundle}, so the result is proven from what the bundler
 * wrote rather than from source imports.
 *
 * Keep this file ERASABLE (no enums, namespaces or parameter properties) so
 * `node` can run the script that imports it directly.
 */

/** The TypeScript engine's step loop (tick, hour and day passes). The WASM
 *  host replaces `tick` on every tower it hosts, so in a build the loop is
 *  swapped for `src/wasmhost/stepLoopAbsent.ts` and must not ship. */
export const TS_STEP_LOOP = "src/engine/sim/loop.ts";

/** The TypeScript simulation's source tree. */
export const TS_ENGINE_DIR = "src/engine/";

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
  /** The TypeScript engine modules the bundle may still carry
   *  (`scripts/engine-bundle.allow.txt`). */
  allowed: readonly string[];
}

export interface EngineBundleResult {
  errors: string[];
  /** The `src/engine/**` modules in the emitted JavaScript, sorted. */
  engineModules: string[];
}

const isTestSource = (s: string): boolean =>
  s.startsWith("src/tests/") || s.startsWith("e2e/") || s.includes("/__mocks__/") || /\.(test|spec)\.[mc]?[jt]sx?$/.test(s);

/** Sources no production build may carry: tests and test fixtures. */
function forbiddenEverywhere(s: string): string | null {
  return isTestSource(s) ? "test code" : null;
}

/** Sources no build may carry besides test code: the TypeScript step loop. */
const FORBIDDEN: ReadonlyMap<string, string> = new Map([
  [TS_STEP_LOOP, "the TypeScript step loop"],
]);

/** Check the emitted bundle. Pure: the script reads the files and passes them
 *  in. */
export function checkEngineBundle(input: EngineBundleInput): EngineBundleResult {
  const errors: string[] = [];
  if (input.chunks.length === 0) errors.push("no emitted JavaScript with a sourcemap was found, so the bundle cannot be checked");
  const engine = new Set<string>();
  for (const chunk of input.chunks) {
    for (const s of chunk.sources) {
      if (s.startsWith(TS_ENGINE_DIR)) engine.add(s);
      const testWhy = forbiddenEverywhere(s);
      if (testWhy) errors.push(`${chunk.file} carries ${testWhy} (${s})`);
      const loopWhy = FORBIDDEN.get(s);
      if (loopWhy) errors.push(`${chunk.file} carries ${loopWhy} (${s})`);
    }
  }
  const engineModules = [...engine].sort();
  const allowed = new Set(input.allowed);
  const unlisted = engineModules.filter((m) => !allowed.has(m));
  if (unlisted.length > 0) {
    errors.push(
      `the bundle gained TypeScript engine modules that scripts/engine-bundle.allow.txt does not list: ${unlisted.join(", ")}. ` +
        "Reach the engine through the WASM host or the catalog instead; list a module only with the reason it must ship",
    );
  }
  const gone = input.allowed.filter((m) => !engine.has(m));
  if (gone.length > 0) {
    errors.push(`these TypeScript engine modules no longer ship in the bundle; remove them from scripts/engine-bundle.allow.txt so the list only shrinks: ${gone.join(", ")}`);
  }
  const pre = new Set(input.precache);
  const absent = input.enginePackageBuilt ? ENGINE_PACKAGE_FILES.filter((f) => !pre.has(f)) : [];
  if (absent.length > 0) errors.push(`the build does not precache the engine package (${absent.join(", ")}), so it could not start offline`);
  return { errors, engineModules };
}

/** The module paths an allowlist file names: one per line, `#` comments and
 *  blank lines ignored. A duplicate or a path outside `src/engine/` is an
 *  error, so the list stays a plain inventory. */
export function parseAllowList(text: string): { modules: string[]; errors: string[] } {
  const modules: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const entry = line.replace(/#.*$/, "").trim();
    if (entry === "") continue;
    if (!entry.startsWith(TS_ENGINE_DIR)) errors.push(`line ${i + 1}: ${entry} is not under ${TS_ENGINE_DIR}`);
    else if (seen.has(entry)) errors.push(`line ${i + 1}: ${entry} is listed twice`);
    else {
      seen.add(entry);
      modules.push(entry);
    }
  }
  return { modules, errors };
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
