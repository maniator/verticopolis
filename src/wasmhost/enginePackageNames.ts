/**
 * The file names of the served engine package, alone, so the app can name
 * the glue without bundling the full package list in engineAssets.ts (which
 * only the build, its checks and the tests read).
 *
 * Keep this file ERASABLE (type-only TypeScript syntax; the rule is spelled
 * out in scripts/screenshot-env.ts): build scripts import it under plain
 * `node`. It has no imports.
 */

/** The folder the package is served from, under the site base. */
export const ENGINE_DIR = "engine/";
/** The JavaScript glue wasm-bindgen writes; the verified loader imports it. */
export const ENGINE_GLUE = "verticopolis_engine.js";
/** The engine binary; the verified loader fetches it beside the glue. */
export const ENGINE_WASM = "verticopolis_engine_bg.wasm";
/** The hash of the Rust sources the package was built from. */
export const ENGINE_BUILD_RECORD = "BUILD.json";
/** The crates compiled into the binary, for the third-party notices (the
 *  same name as ENGINE_THIRD_PARTY in src/build/rustNotices.ts; the test
 *  holds them equal). */
export const ENGINE_THIRD_PARTY_RECORD = "THIRD-PARTY.json";
/** The line a development serve logs when it loads the engine without the byte
 *  check (loadEngineModule.ts). It is the marker scripts/verify-precache.ts
 *  looks for: a production bundle that holds it still carries the skip. */
export const DEV_SKIP_MARKER = "development serve: the engine package is not verified";
