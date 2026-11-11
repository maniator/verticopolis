/* Declarations for web/verticopolis_engine.js, the browser build. The engine
 * calls are the same as the Node build's; this build adds the loader below,
 * which must run once before any of them. The release workflow copies this
 * file to web/verticopolis_engine.d.ts in the published package. */
export * from "../node/verticopolis_engine";

/** Where the `.wasm` comes from: its URL, a fetch of it, or its bytes. */
export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

/** Load the `.wasm` from bytes or a compiled module you already hold. */
export function initSync(module: { module: BufferSource | WebAssembly.Module }): unknown;

/** Fetch and load the `.wasm`. With no argument it loads the file next to
 *  this module (`new URL("verticopolis_engine_bg.wasm", import.meta.url)`). */
export default function init(
  module_or_path?: { module_or_path: InitInput | Promise<InitInput> },
): Promise<unknown>;
