import { APP_VERSION } from "../appVersion";

/**
 * The player-visible name of the engine running the simulation, for the
 * version lines on the splash, Settings, and Help's About. The TypeScript
 * engine gets no suffix. When the Rust engine runs (the Settings choice, the
 * staged cohort, or `?engine=wasm`), the version reads "v2.29.0 · Rust engine"
 * wherever it is shown, so a player or tester can tell from the title screen
 * which engine they are on without opening the console.
 */
interface EngineHandle {
  status: { hosted: boolean; placement?: "worker" };
}

/** The engine the current tower runs on: "wasm" while the WASM host has a
 *  tower attached, "ts" otherwise (including a WASM package that failed to
 *  load, which leaves the game on the TypeScript engine). */
export function activeEngine(g: { __vcEngine?: EngineHandle } = globalThis as { __vcEngine?: EngineHandle }): "ts" | "wasm" {
  return g.__vcEngine?.status.hosted ? "wasm" : "ts";
}

/** The suffix the version lines append: empty on the default engine. */
export function engineSuffix(g: { __vcEngine?: EngineHandle } = globalThis as { __vcEngine?: EngineHandle }): string {
  if (activeEngine(g) !== "wasm") return "";
  // The experimental worker host says so, so a tester can tell the two apart.
  return g.__vcEngine?.status.placement === "worker" ? " · Rust engine (worker)" : " · Rust engine";
}

/** The full version line, "v2.29.0" or "v2.29.0 · Rust engine". */
export function versionLine(version = APP_VERSION, g?: { __vcEngine?: EngineHandle }): string {
  return `v${version}${engineSuffix(g)}`;
}

/** Rewrite an already-rendered splash version line once the WASM host has
 *  attached: the title screen mounts inside `create()`, before the host starts,
 *  so its template cannot see the engine at render time. Dialogs render later
 *  and read the suffix themselves. */
export function refreshSplashVersion(doc: Pick<Document, "querySelector"> = document): void {
  const el = doc.querySelector<HTMLElement>(".splash-version");
  if (el) el.textContent = versionLine();
}
