import { APP_VERSION } from "../appVersion";

/**
 * The player-visible name of the engine running the simulation, for the
 * version lines on the splash, Settings, and Help's About. The TypeScript
 * engine is the default and gets no suffix, so nothing a player sees changes
 * unless they asked for the WASM engine (`?engine=wasm`); then the version
 * reads "v2.29.0 · WASM engine" wherever it is shown, and a tester can tell
 * from the title screen which engine they are on without opening the console.
 */
interface EngineHandle {
  status: { hosted: boolean };
}

/** The engine the current tower runs on: "wasm" while the WASM host has a
 *  tower attached, "ts" otherwise (including a WASM package that failed to
 *  load, which leaves the game on the TypeScript engine). */
export function activeEngine(g: { __vcEngine?: EngineHandle } = globalThis as { __vcEngine?: EngineHandle }): "ts" | "wasm" {
  return g.__vcEngine?.status.hosted ? "wasm" : "ts";
}

/** The suffix the version lines append: empty on the default engine. */
export function engineSuffix(g?: { __vcEngine?: EngineHandle }): string {
  return activeEngine(g) === "wasm" ? " · WASM engine" : "";
}

/** The full version line, "v2.29.0" or "v2.29.0 · WASM engine". */
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
