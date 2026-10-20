import type { Simulation } from "../engine/Simulation";
import { checkBinding, type WasmModule } from "../dualrun/binding";
import { readCatalog } from "../dualrun/catalog";
import { attachWasmHost, refuseForeignCatalog, type WasmHost } from "./wasmHost";
import { ENGINE_DIR, ENGINE_GLUE } from "./enginePackageNames";
import { EngineBootError, type FallbackReason, type FallbackStage } from "./engineBoot";

/**
 * The app side of the WASM switch: load the browser package, host the
 * current tower on it, and follow every later `adoptSim` (a load, a new
 * game, an undo restore) onto a fresh engine. The state is published on
 * `window.__vcEngine` for tooling and for a tester to confirm which engine
 * runs. In a switchable build a tower the host cannot start from is reported
 * and left on the TypeScript engine, so the switch never takes the game down.
 * In a wasm-only build (`strict`) there is no TypeScript engine to leave it
 * on: the refusal is reported the same way and `onFatal` stops the game.
 */
export interface WasmHostStatus {
  engine: "wasm";
  /** Towers hosted so far (every adoptSim restarts the engine). */
  starts: number;
  /** Whether the current tower runs on the engine (false after a refusal). */
  hosted: boolean;
  /** Towers left on the TypeScript engine (or, in a wasm-only build, the
   *  stop) so far, every one counted where `errors` keeps only the first 50. */
  fallbacks: number;
  /** The code and stage of the latest fallback, as analytics reports it
   *  (`engine_status`); null while there has been none. */
  lastFallback: HostFallback | null;
  errors: string[];
}

/** A fallback as codes only: the message stays in `errors` and the log. */
export interface HostFallback {
  reason: FallbackReason;
  stage: FallbackStage;
}

export interface WasmHostApp {
  sim: Simulation;
  adoptSim(sim: Simulation, preserveHistory?: boolean): void;
}

export interface WasmHostHandle {
  status: WasmHostStatus;
  /** The host of the current tower, or null after a refusal. */
  current(): WasmHost | null;
  /** Let the current tower go and stop following swaps. A detach that
   *  throws (a trapped engine) is reported on the status and the log. */
  stop(): void;
}

/** Where the built package lives: `src/public/engine/`, served beside the app
 *  (see scripts/wasm-build.ts). Resolved against the page, so a relocated
 *  deployment finds it under its own base. Every file the package loads at
 *  run time is listed in engineAssets.ts, which the precache check reads. */
export function enginePackageUrl(base = import.meta.env.BASE_URL, href = globalThis.location?.href ?? "http://localhost/"): string {
  return new URL(`${base}${ENGINE_DIR}${ENGINE_GLUE}`, href).href;
}

/** Load and initialize the browser package. A package that loads but lacks
 *  what this shell calls is a mismatched package (a shell and an engine from
 *  different builds), coded so analytics tells it from a broken engine. */
export async function loadWasmEngine(url = enginePackageUrl()): Promise<WasmModule> {
  const mod = (await import(/* @vite-ignore */ url)) as { default: () => Promise<unknown> };
  await mod.default();
  try {
    return checkBinding(mod);
  } catch (e) {
    throw new EngineBootError("package-mismatch", e instanceof Error ? e.message : String(e));
  }
}

export interface WasmHostOptions {
  /** A wasm-only build: a tower the host refuses is fatal, never left on the
   *  TypeScript engine. */
  strict?: boolean;
  /** Called once, in strict mode, with the reason the host could not hold a
   *  tower and its code (`attach-refused`, or `package-mismatch` for a
   *  package whose catalogs this build cannot draw). */
  onFatal?: (message: string, reason: FallbackReason) => void;
  /** When the read model follows the engine (`attachWasmHost`'s option):
   *  "step" (the default) or the experimental "frame" (`?engine=wasm-frame`). */
  sync?: "step" | "frame";
  /** Called with the codes of every tower the host would not take, the first
   *  one included, after the status records it. A throw is reported, never
   *  passed back into the adopt. */
  onFallback?: (fallback: HostFallback) => void;
}

export function startWasmHost(app: WasmHostApp, mod: WasmModule, log: Pick<Console, "info" | "error"> = console, opts: WasmHostOptions = {}): WasmHostHandle {
  const status: WasmHostStatus = { engine: "wasm", starts: 0, hosted: false, fallbacks: 0, lastFallback: null, errors: [] };
  let host: WasmHost | null = null;
  let fatal = false;
  const noteError = (message: string) => {
    if (status.errors.length >= 50) return;
    status.errors.push(message);
    log.error(`[wasm] ${message}`);
  };
  // Let go of the current tower. A trapped engine still lets go (the detach
  // finishes its teardown, then rethrows); the error goes to the status and
  // the log, so a load or a new game stays the way out of a dead engine.
  const release = () => {
    const h = host;
    host = null;
    status.hosted = false;
    try {
      h?.detach();
    } catch (e) {
      noteError(`letting go of the last tower: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // Whether the package's catalogs are foreign to this build: the attach
  // reads both and refuses every tower then, and the cause is a shell and an
  // engine from different deploys (#1046), so the code is `package-mismatch`.
  // Only a catalog the engine handed over and this build rejects (its version,
  // its shape, another world) counts. A catalog call that throws or returns no
  // JSON is the engine failing, which stays `attach-refused` and is asked
  // again at the next refusal. A verdict is kept: the package cannot change
  // under the page.
  let foreign: boolean | undefined;
  const foreignPackage = (): boolean => {
    if (foreign !== undefined) return foreign;
    if (typeof mod.catalog !== "function") return (foreign = true);
    for (const mode of ["classic", "modern"] as const) {
      let text: string;
      try {
        text = mod.catalog(mode);
        JSON.parse(text);
      } catch {
        return false;
      }
      try {
        refuseForeignCatalog(readCatalog({ catalog: () => text }, mode));
      } catch {
        return (foreign = true);
      }
    }
    return (foreign = false);
  };
  // `stage` says which tower this is: the first one (`start`), a load or a
  // new game (`adopt`), or an undo restore (`undo`).
  const follow = (sim: Simulation, stage: FallbackStage) => {
    release();
    try {
      host = attachWasmHost(sim, mod, { sync: opts.sync });
      status.starts++;
      status.hosted = true;
      log.info(`[wasm] tower ${status.starts} runs on the WASM engine`);
    } catch (e) {
      const message = `not hosting this tower: ${e instanceof Error ? e.message : String(e)}`;
      noteError(message);
      status.fallbacks++;
      status.lastFallback = { reason: foreignPackage() ? "package-mismatch" : "attach-refused", stage };
      try {
        opts.onFallback?.(status.lastFallback);
      } catch (err) {
        log.error(`[wasm] reporting the fallback failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (opts.strict && !fatal) {
        fatal = true;
        // The stop is reported, never thrown into the adopt that caused it.
        try {
          opts.onFatal?.(message, status.lastFallback.reason);
        } catch (err) {
          log.error(`[wasm] stopping the game failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  };
  follow(app.sim, "start");

  const adopt = app.adoptSim;
  const ownAdopt = Object.getOwnPropertyDescriptor(app, "adoptSim");
  let stopped = false;
  const wrappedAdopt = function (this: WasmHostApp, sim: Simulation, preserveHistory?: boolean): void {
    // Let the old tower go first: the detach hands it back the events its
    // engine still owes, with the drop count, so the adopt passes them to the
    // tower that replaces it without asking an engine that may have trapped.
    // Then host whichever tower the app holds. An adopt that throws before
    // its swap (GameApp's cannot) leaves the old tower, re-hosted when it has
    // no crowd yet and otherwise reported and left on the TypeScript engine.
    // Adopting the tower already held keeps its host.
    if (sim === app.sim) return adopt.call(this, sim, preserveHistory);
    release();
    try {
      adopt.call(this, sim, preserveHistory);
    } finally {
      if (!stopped) follow(app.sim, preserveHistory ? "undo" : "adopt");
    }
  };
  Object.defineProperty(app, "adoptSim", { value: wrappedAdopt, configurable: true, writable: true });

  const handle: WasmHostHandle = {
    status,
    current: () => host,
    stop() {
      stopped = true;
      release();
      if (ownAdopt) Object.defineProperty(app, "adoptSim", ownAdopt);
      else delete (app as Partial<WasmHostApp>).adoptSim;
      const g = globalThis as unknown as { __vcEngine?: WasmHostHandle };
      if (g.__vcEngine === handle) delete g.__vcEngine;
    },
  };
  (globalThis as unknown as { __vcEngine?: WasmHostHandle }).__vcEngine = handle;
  return handle;
}
