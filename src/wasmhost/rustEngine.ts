import { checkBinding, type WasmModule } from "../dualrun/binding";
import { readCatalog } from "../dualrun/catalog";
import { useTowerCatalogSource } from "../engine/towerCatalog";
import { BOOT_SEED, bootTower, type BootTower } from "../game/bootTower";
import type { EnginePort } from "../simport/enginePort";
import { refuseForeignCatalog } from "./catalogCheck";
import { EngineBootError } from "./engineBoot";
import { ENGINE_DIR, ENGINE_GLUE } from "./enginePackageNames";
import { loadEngineModule, type LoadEngineOptions } from "./loadEngineModule";

/**
 * The Rust engine as the game's engine port (PR 5e). The loaded package's
 * `Engine` is the port itself: the app steps it, commands it and reads its
 * view through the same calls it makes on the TypeScript engine, with no
 * TypeScript copy of the tower beside it.
 */

/** Where the built package lives: `src/public/engine/`, served beside the app
 *  (see scripts/wasm-build.ts). Resolved against the page, so a relocated
 *  deployment finds it under its own base. Every file the package loads at
 *  run time is listed in engineAssets.ts, which the precache check reads. */
export function enginePackageUrl(base = import.meta.env.BASE_URL, href = globalThis.location?.href ?? "http://localhost/"): string {
  return new URL(`${base}${ENGINE_DIR}${ENGINE_GLUE}`, href).href;
}

/** Load and initialize the browser package through the byte check
 *  (loadEngineModule). A package that passes it but lacks what this shell
 *  calls is a mismatched package too (a shell and an engine from different
 *  builds), coded so analytics tells it from a broken engine. */
export async function loadWasmEngine(url = enginePackageUrl(), signal?: AbortSignal, opts: Omit<LoadEngineOptions, "signal"> = {}): Promise<WasmModule> {
  const { mod } = await loadEngineModule(url, { ...opts, signal });
  try {
    return checkBinding(mod);
  } catch (e) {
    throw new EngineBootError("package-mismatch", e instanceof Error ? e.message : String(e));
  }
}

/** A fresh Rust engine with the stored tower loaded into it. Prices, sizes
 *  and build rules come from the engine's own catalogs, read first: a package
 *  whose catalogs this build cannot read, or that states another world or
 *  other kinds than this build draws, is a mismatched package and is refused
 *  before an engine is built. */
export function rustBootTower(mod: WasmModule): BootTower {
  let catalogs: Record<"classic" | "modern", ReturnType<typeof readCatalog>>;
  try {
    // Both modes: a Classic tower's patronage readout uses the Modern yardstick.
    catalogs = { classic: readCatalog(mod, "classic"), modern: readCatalog(mod, "modern") };
    for (const c of Object.values(catalogs)) refuseForeignCatalog(c);
  } catch (e) {
    throw new EngineBootError("package-mismatch", e instanceof Error ? e.message : String(e));
  }
  const port: EnginePort = mod.Engine.newGame(BOOT_SEED, "classic");
  useTowerCatalogSource(port, (mode) => catalogs[mode]);
  return bootTower(port);
}

/** What `window.__vcEngine` says while the Rust engine runs the game: the
 *  version lines and Copy diagnostics read `status`, and tooling reaches the
 *  engine through `port`. A trap that stops the game turns `hosted` off with
 *  the reason in `lastError`. */
export interface RustEngineHandle {
  status: { engine: "wasm"; hosted: boolean; lastError: string | null; lastFallback: null };
  port: EnginePort;
}

/** Say that the Rust engine runs the game. Published before the app is
 *  built, so the title screen's version line reads it as it renders. */
export function publishRustEngine(port: EnginePort, g: { __vcEngine?: RustEngineHandle } = globalThis as { __vcEngine?: RustEngineHandle }): RustEngineHandle {
  const handle: RustEngineHandle = { status: { engine: "wasm", hosted: true, lastError: null, lastFallback: null }, port };
  g.__vcEngine = handle;
  return handle;
}
