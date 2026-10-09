/**
 * Which engine runs the simulation in the browser: the TypeScript one (the
 * default) or the Rust engine compiled to WASM (story-engine-wasm-switch).
 * `?engine=wasm` in the URL picks WASM for one visit, `localStorage`
 * `vc.engine = "wasm"` keeps it; `?engine=ts` overrides the stored choice.
 */
export type EngineChoice = "ts" | "wasm";

export const ENGINE_STORAGE_KEY = "vc.engine";

export function engineRequested(location: { search: string } = window.location, storage: { getItem(k: string): string | null } | null = safeStorage()): EngineChoice {
  const q = new URLSearchParams(location.search).get("engine");
  if (q === "wasm" || q === "ts") return q;
  try {
    return storage?.getItem(ENGINE_STORAGE_KEY) === "wasm" ? "wasm" : "ts";
  } catch {
    return "ts";
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
