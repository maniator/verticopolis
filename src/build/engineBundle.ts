/**
 * Engine build modes and the emitted-bundle guard for them.
 *
 * A build is either **switchable** (today's default: the TypeScript engine
 * runs unless `?engine=wasm` or `vc.engine` asks for the WASM engine, and a
 * WASM package that fails to load leaves the game on TypeScript) or
 * **wasm-only** (`VC_ENGINE=wasm`: the Rust/WASM engine is the only engine,
 * a failure to start it stops the game with a message, and the TypeScript
 * step loop is not in the bundle). `vite.config.ts` parses the mode with
 * {@link parseEngineBuild}; `scripts/verify-engine-bundle.ts` runs after every
 * build and checks the emitted sourcemaps and the service-worker precache with
 * {@link checkEngineBundle}, so the result is proven from what the bundler
 * wrote rather than from source imports.
 *
 * Keep this file ERASABLE (no enums, namespaces or parameter properties) so
 * `node` can run the script that imports it directly.
 */

export type EngineBuild = "wasm-only" | "switchable";

/** The mode a build gets with `VC_ENGINE` unset. The 3.0.0 flip (#945)
 *  changes this, and the deploy, to "wasm-only"; the switchable build then
 *  stays available as the explicitly selected legacy build. */
export const DEFAULT_ENGINE_BUILD: EngineBuild = "switchable";

/** The `VC_ENGINE` values a build accepts, and the mode each selects. */
const ENGINE_VALUES: ReadonlyMap<string, EngineBuild> = new Map([
  ["wasm", "wasm-only"],
  ["switchable", "switchable"],
]);

/** The build mode `VC_ENGINE` selects. Unset or empty is the default; any
 *  other unknown value throws, so a typo (`VC_ENGINE=WASM`) can never quietly
 *  produce the other kind of build. */
export function parseEngineBuild(raw: string | undefined): EngineBuild {
  if (raw === undefined || raw === "") return DEFAULT_ENGINE_BUILD;
  const mode = ENGINE_VALUES.get(raw);
  if (!mode) throw new Error(`VC_ENGINE must be "wasm", "switchable" or unset; got "${raw}".`);
  return mode;
}

/** The TypeScript engine's step loop (tick, hour and day passes). The WASM
 *  host replaces `tick` on every tower it hosts, so in a wasm-only build the
 *  loop is swapped for `src/wasmhost/stepLoopAbsent.ts` and must not ship. */
export const TS_STEP_LOOP = "src/engine/sim/loop.ts";

/** The TypeScript simulation's source tree. */
export const TS_ENGINE_DIR = "src/engine/";

/** The engine package files the precache must carry in a wasm-only build. */
export const ENGINE_PACKAGE_FILES: readonly string[] = ["engine/verticopolis_engine.js", "engine/verticopolis_engine_bg.wasm"];

/** One emitted JavaScript file and the repository-relative sources its
 *  sourcemap lists (`src/...`, `node_modules/...`), with any query suffix
 *  (`?worker`) removed. */
export interface EmittedChunk {
  file: string;
  sources: readonly string[];
}

export interface EngineBundleInput {
  build: EngineBuild;
  /** A `VC_TOOLING=1` build (e2e, screenshots, perf), which keeps the dual run. */
  tooling: boolean;
  chunks: readonly EmittedChunk[];
  /** Precache URLs from `sw.js`, relative to `dist/`. */
  precache: readonly string[];
  /** The mode `version.json` records for the build that wrote `dist/`. */
  stamp: unknown;
  /** The TypeScript engine modules a wasm-only build may still carry
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

/** Sources a player build (no `VC_TOOLING`) may not carry: the dual run is a
 *  developer switch on the tooling-only path, and its worker is emitted (and
 *  was precached) even though the code that starts it is compiled away. */
export const DUAL_RUN: readonly string[] = ["src/dualrun/dualRun.ts", "src/dualrun/worker.ts"];

/** Sources a wasm-only build may not carry: the TypeScript step loop, the
 *  runtime engine switch, and the dual run, which shadows a TypeScript live
 *  engine that a wasm-only build does not have. */
const WASM_ONLY_FORBIDDEN: ReadonlyMap<string, string> = new Map([
  [TS_STEP_LOOP, "the TypeScript step loop"],
  ["src/wasmhost/engineChoice.ts", "the runtime engine switch"],
  ["src/dualrun/dualRun.ts", "the dual run"],
  ["src/dualrun/worker.ts", "the dual-run worker"],
]);

/** Check the emitted bundle against its build mode. Pure: the script reads
 *  the files and passes them in. */
export function checkEngineBundle(input: EngineBundleInput): EngineBundleResult {
  const errors: string[] = [];
  if (input.chunks.length === 0) errors.push("no emitted JavaScript with a sourcemap was found, so the bundle cannot be checked");
  if (input.stamp !== input.build) {
    errors.push(`dist/version.json records engine build ${JSON.stringify(input.stamp)}, but this check ran for "${input.build}"; set the same VC_ENGINE for the build and the check`);
  }
  const engine = new Set<string>();
  for (const chunk of input.chunks) {
    for (const s of chunk.sources) {
      if (s.startsWith(TS_ENGINE_DIR)) engine.add(s);
      const why = forbiddenEverywhere(s);
      if (why) errors.push(`${chunk.file} carries ${why} (${s})`);
      const wasmOnlyWhy = input.build === "wasm-only" ? WASM_ONLY_FORBIDDEN.get(s) : undefined;
      if (wasmOnlyWhy) {
        errors.push(`${chunk.file} carries ${wasmOnlyWhy} (${s}) in a wasm-only build`);
      } else if (!input.tooling && DUAL_RUN.includes(s)) {
        errors.push(`${chunk.file} carries the dual run (${s}), a tooling-only switch, in a player build`);
      }
    }
  }
  const engineModules = [...engine].sort();
  // A switchable build runs the TypeScript engine by default, so it must
  // still carry the step loop; its absence means a wasm-only swap leaked.
  if (input.build === "switchable" && input.chunks.length > 0 && !engine.has(TS_STEP_LOOP)) {
    errors.push(`the switchable build does not carry the TypeScript step loop (${TS_STEP_LOOP}), so its default engine could not run; check the wasm-only aliases in vite.config.ts`);
  }
  if (input.build === "wasm-only") {
    const allowed = new Set(input.allowed);
    const unlisted = engineModules.filter((m) => !allowed.has(m));
    if (unlisted.length > 0) {
      errors.push(
        `the wasm-only bundle gained TypeScript engine modules that scripts/engine-bundle.allow.txt does not list: ${unlisted.join(", ")}. ` +
          "Reach the engine through the WASM host or the catalog instead; list a module only with the reason it must ship",
      );
    }
    const gone = input.allowed.filter((m) => !engine.has(m));
    if (gone.length > 0) {
      errors.push(`these TypeScript engine modules no longer ship in the wasm-only bundle; remove them from scripts/engine-bundle.allow.txt so the list only shrinks: ${gone.join(", ")}`);
    }
    const pre = new Set(input.precache);
    const absent = ENGINE_PACKAGE_FILES.filter((f) => !pre.has(f));
    if (absent.length > 0) errors.push(`the wasm-only build does not precache the engine package (${absent.join(", ")}), so it could not start offline`);
  }
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
