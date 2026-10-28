import { APP_VERSION } from "../appVersion";
import type { EngineBootState } from "./engineBoot";
import { parseEngineIdentity } from "./engineIdentity";
import { shortId } from "./enginePackageRecord";
import { TS_ENGINE_SOURCES, TS_ENGINE_VERSION } from "./tsEngineIdentity";

/**
 * The player-visible name of the engine running the simulation, for the
 * version lines on the splash, Settings, and Help's About, with the engine's
 * own version and a short source hash (#1422): "v2.51.0 · TypeScript engine
 * 2.0 (1a2b3c4d5e6f)" or "v2.51.0 · Rust engine 0.20.0 (…)", so a player or
 * tester can tell from the title screen which engine, and which build of it,
 * they are on without opening the console. The Rust engine's version is the
 * crate version its package reports and the hash is its binary's; either is
 * left out when the package did not report it.
 */
interface EngineHandle {
  status: { hosted: boolean; placement?: "worker" };
}

interface LabelSource {
  __vcEngine?: EngineHandle;
  /** `window.__vcEngineBoot`: the identity and binary the Rust package reported. */
  __vcEngineBoot?: Pick<EngineBootState, "identity" | "binary">;
}

const pageSource = () => globalThis as LabelSource;

/** The engine the current tower runs on: "wasm" while the WASM host has a
 *  tower attached, "ts" otherwise (including a WASM package that failed to
 *  load, which leaves the game on the TypeScript engine). */
export function activeEngine(g: LabelSource = pageSource()): "ts" | "wasm" {
  return g.__vcEngine?.status.hosted ? "wasm" : "ts";
}

/** The engine's name, version and short hash, as the version lines append it. */
export function engineSuffix(g: LabelSource = pageSource()): string {
  if (activeEngine(g) !== "wasm") return ` · TypeScript engine ${TS_ENGINE_VERSION} (${shortId(TS_ENGINE_SOURCES)})`;
  const version = parseEngineIdentity(g.__vcEngineBoot?.identity)?.crate.version;
  const binary = g.__vcEngineBoot?.binary;
  const hash = binary?.state === "ok" ? shortId(binary.sourceHash) : null;
  // The experimental worker host says so, so a tester can tell the two apart.
  const extras = [hash, g.__vcEngine?.status.placement === "worker" ? "worker" : null].filter((x) => x !== null);
  return ` · Rust engine${version ? ` ${version}` : ""}${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`;
}

/** The full version line: the app version, then the engine (`engineSuffix`). */
export function versionLine(version = APP_VERSION, g?: LabelSource): string {
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
