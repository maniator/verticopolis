/// <reference types="vite/client" />

/** Compile-time constants injected by Vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string;
/** Short git SHA of this build, or "unknown" outside a checkout. */
declare const __APP_SHA__: string;
/** True only in a tooling build (`VC_TOOLING=1`, set by the e2e, screenshot,
 *  and perf pipelines). Gates the `window.game` handle: a production build
 *  compiles the publish away entirely (see bootstrap.ts). */
declare const __TOOLING_BUILD__: boolean;
