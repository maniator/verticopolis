/// <reference types="vite/client" />

/** Compile-time constants injected by Vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string;
/** Short git SHA of this build, or "unknown" outside a checkout. */
declare const __APP_SHA__: string;
/** SHA-256 of the TypeScript engine's sources (`src/build/tsEngineSources.ts`). */
declare const __TS_ENGINE_SOURCES__: string;
/** True only in a tooling build (`VC_TOOLING=1`, set by the e2e, screenshot,
 *  and perf pipelines). Gates the `window.game` handle: a production build
 *  compiles the publish away entirely (see bootstrap.ts). */
declare const __TOOLING_BUILD__: boolean;
/** True only in a wasm-only build (`VC_ENGINE=wasm`): the Rust/WASM engine is
 *  the only engine, with no runtime switch and no TypeScript fallback (see
 *  src/build/engineBundle.ts and bootstrap.ts). */
declare const __WASM_ONLY__: boolean;
/** The engine package this shell was built with: its package id and the
 *  digests of the glue and the binary, from src/public/engine/BUILD.json
 *  (see src/wasmhost/enginePackageRecord.ts). Null when the build carries no
 *  usable package. */
/** This build's parts, for the update prompt's "game or engine" label (see
 *  src/pwaUpdateInfo.ts and src/build/buildFingerprint.ts). */
declare const __BUILD_FINGERPRINT__: import("./pwaUpdateInfo").BuildFingerprint;
declare const __ENGINE_PACKAGE__: import("./wasmhost/enginePackageRecord").ExpectedEnginePackage | null;
