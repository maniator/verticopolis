import { APP_VERSION } from "../appVersion";
import { settleEngineIdentity, type EngineBootState } from "./engineBoot";
import { parseEngineIdentity } from "./engineIdentity";
import { shortId } from "./enginePackageRecord";

/**
 * The player-visible name of the engine running the simulation, for the
 * version lines on the splash, Settings, and Help's About, with the engine's
 * own version and a short source hash (#1422): "v2.51.0 · Rust engine 0.20.0
 * (1a2b3c4d5e6f)", so a player or tester can tell from the title screen which
 * build of the engine they are on without opening the console. The Rust engine's version is the
 * crate version its package reports and the hash is its binary's; either is
 * left out when the package did not report it.
 */
interface EngineHandle {
  status: { hosted: boolean; placement?: "worker" };
}

interface LabelSource {
  __vcEngine?: EngineHandle;
  /** `window.__vcEngineBoot`: the identity and binary the Rust package reported. */
  __vcEngineBoot?: Partial<Pick<EngineBootState, "identity" | "binary" | "build" | "engine">>;
}

const pageSource = () => globalThis as LabelSource;

/** The engine the current tower runs on: "wasm" while the WASM host has a
 *  tower attached, "ts" otherwise (including a WASM package that failed to
 *  load, which leaves the game on the TypeScript engine). */
export function activeEngine(g: LabelSource = pageSource()): "ts" | "wasm" {
  return g.__vcEngine?.status.hosted ? "wasm" : "ts";
}

/** The engine's name, version and short hash, as the version lines append it.
 *  The page's own suffix reads the engine's identity record first if boot left
 *  it for later (#1254), so Settings and About name the version. */
export function engineSuffix(g: LabelSource = pageSource()): string {
  if (g === pageSource()) settleEngineIdentity();
  return suffixOf(g);
}

/** The suffix from what `g` holds now, without reading a deferred identity. */
function suffixOf(g: LabelSource): string {
  // The Rust engine is the only engine (#1875). A Rust engine that stopped
  // after a trap reads `engine: "none"` until the reload, and says so.
  const stopped = activeEngine(g) !== "wasm" && g.__vcEngineBoot?.engine === "none";
  const version = parseEngineIdentity(g.__vcEngineBoot?.identity)?.crate.version;
  const binary = g.__vcEngineBoot?.binary;
  const hash = binary?.state === "ok" ? shortId(binary.sourceHash) : null;
  // The experimental worker host says so, so a tester can tell the two apart.
  const extras = [hash, g.__vcEngine?.status.placement === "worker" ? "worker" : null, stopped ? "stopped" : null].filter((x) => x !== null);
  return ` · Rust engine${version ? ` ${version}` : ""}${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`;
}

/** The full version line: the app version, then the engine (`engineSuffix`).
 *  The title screen draws it while the game starts, so it does not read a
 *  deferred identity record: boot rewrites it once the record is read
 *  (`refreshSplashVersion`). */
export function versionLine(version = APP_VERSION, g: LabelSource = pageSource()): string {
  return `v${version}${suffixOf(g)}`;
}

/** Rewrite an already-rendered splash version line once the engine's identity
 *  record is read after the first frame (#1254): the title screen mounts
 *  inside `create()`, before the record is read, so its template cannot name
 *  the engine's version at render time. Dialogs render later and read the
 *  suffix themselves. */
export function refreshSplashVersion(doc: Pick<Document, "querySelector"> = document): void {
  const el = doc.querySelector<HTMLElement>(".splash-version");
  if (el) el.textContent = versionLine();
}
