/**
 * Which engine runs the simulation in the browser: the TypeScript one (the
 * default) or the Rust engine compiled to WASM (story-engine-wasm-switch).
 * `?engine=wasm` in the URL picks WASM for one visit, `localStorage`
 * `vc.engine = "wasm"` keeps it; `?engine=ts` overrides the stored choice.
 *
 * Two experimental hosts of the same engine, for measurement only and never
 * a default (docs/architecture/wasm-worker-host.md):
 * - `wasm-frame`: the main-thread host, syncing the read model once per
 *   rendered frame straight from the engine's frame array.
 * - `wasm-worker`: the engine in a dedicated Web Worker, the read model
 *   synced from its replies.
 * Both are picked the same ways (`?engine=wasm-worker`, or the stored value).
 */
export type EngineChoice = "ts" | "wasm" | "wasm-frame" | "wasm-worker";

export const ENGINE_STORAGE_KEY = "vc.engine";

const CHOICES: readonly string[] = ["ts", "wasm", "wasm-frame", "wasm-worker"];
const isChoice = (v: string | null | undefined): v is EngineChoice => v != null && CHOICES.includes(v);

export function engineRequested(location: { search: string } = window.location, storage: { getItem(k: string): string | null } | null = safeStorage()): EngineChoice {
  const q = new URLSearchParams(location.search).get("engine");
  if (isChoice(q)) return q;
  try {
    const stored = storage?.getItem(ENGINE_STORAGE_KEY);
    return isChoice(stored) ? stored : "ts";
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
