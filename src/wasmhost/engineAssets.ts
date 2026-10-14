/**
 * Every file the engine package build writes into `src/public/engine/` (and so
 * into `dist/engine/`), each marked by whether the game fetches it at run
 * time. The audio layer has the same list in src/audio/audioAssets.ts.
 *
 * An installed game must start the engine offline (#945, #985), so every
 * `runtime` file has to be in the service worker's precache:
 * scripts/verify-precache.ts fails the build when one is missing from the
 * manifest, when a file in `dist/engine/` is not in this list, when the glue
 * fetches a file this list does not mark `runtime`, and when a file marked
 * `runtime: false` is precached anyway. engineAssets.test.ts fails when the
 * app source or the package build names an engine file this list lacks.
 *
 * Today the game fetches two files: the glue, which the host and the dual run
 * import by URL (enginePackageUrl in startWasmHost.ts), and the binary, which
 * the glue fetches beside itself (`new URL("verticopolis_engine_bg.wasm",
 * import.meta.url)` in wasm-bindgen's web target). `BUILD.json` and
 * `THIRD-PARTY.json` are read only at build and test time (the source hash in
 * packageHash.ts, the notices in src/build/rustNotices.ts), so they stay out
 * of the precache. When a run-time check starts reading `BUILD.json` (#985's
 * criterion 5), mark it `runtime: true` in the same change and add it to the
 * workbox glob by its own path (see the note in vite.config.ts).
 *
 * Keep this file ERASABLE (type-only TypeScript syntax, no enums or
 * namespaces; the rule is spelled out in scripts/screenshot-env.ts): the
 * build scripts import it under plain `node`, which strips types. It has no
 * imports so the app can use it too.
 */

/** The folder the package is served from, under the site base. */
export const ENGINE_DIR = "engine/";
/** The JavaScript glue wasm-bindgen writes; the game imports it by URL. */
export const ENGINE_GLUE = "verticopolis_engine.js";
/** The engine binary; the glue fetches it beside itself. */
export const ENGINE_WASM = "verticopolis_engine_bg.wasm";
/** The hash of the Rust sources the package was built from. */
export const ENGINE_BUILD_RECORD = "BUILD.json";
/** The crates compiled into the binary, for the third-party notices (the
 *  same name as ENGINE_THIRD_PARTY in src/build/rustNotices.ts; the test
 *  holds them equal). */
export const ENGINE_THIRD_PARTY_RECORD = "THIRD-PARTY.json";

/** One file of the served engine package. */
export interface EngineFile {
  /** Its name inside `engine/`. */
  name: string;
  /** Whether the game fetches it at run time, and so must precache it. */
  runtime: boolean;
  /** Who reads it, and when. */
  readBy: string;
}

/** Every file the package build leaves in `src/public/engine/`. Add a new
 *  one here in the same change that writes it. */
export const ENGINE_PACKAGE: readonly EngineFile[] = [
  { name: ENGINE_GLUE, runtime: true, readBy: "the WASM host and the dual run's worker, imported by URL (startWasmHost.ts)" },
  { name: ENGINE_WASM, runtime: true, readBy: "the glue, fetched beside itself at init" },
  { name: ENGINE_BUILD_RECORD, runtime: false, readBy: "the build, CI's package cache and packageHash.test.ts" },
  { name: ENGINE_THIRD_PARTY_RECORD, runtime: false, readBy: "the third-party notices build (scripts/gen-third-party-notices.ts)" },
];

/** The engine files fetched at run time, as paths under the site base. */
export const ENGINE_RUNTIME_FILES: readonly string[] = ENGINE_PACKAGE.filter((f) => f.runtime).map((f) => ENGINE_DIR + f.name);

/** The engine files the game never fetches, as paths under the site base. */
export const ENGINE_BUILD_ONLY_FILES: readonly string[] = ENGINE_PACKAGE.filter((f) => !f.runtime).map((f) => ENGINE_DIR + f.name);

/**
 * The files the glue loads relative to itself: `new URL("x", import.meta.url)`
 * and static or dynamic imports of `./x`, as names inside `engine/`.
 * wasm-bindgen's web target loads the binary this way, and puts inline
 * JavaScript snippets in `snippets/` imported the same way.
 */
export function glueLoads(glue: string): string[] {
  const found = new Set<string>();
  for (const m of glue.matchAll(/new URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url/g)) found.add(m[1].replace(/^\.\//, ""));
  for (const m of glue.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'`](\.\/[^"'`]+)["'`]/g)) found.add(m[1].slice(2));
  return [...found].sort();
}
