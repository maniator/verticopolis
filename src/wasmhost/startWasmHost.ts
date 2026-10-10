import type { Simulation } from "../engine/Simulation";
import { checkBinding, type WasmModule } from "../dualrun/binding";
import { attachWasmHost, type WasmHost } from "./wasmHost";

/**
 * The app side of the WASM switch: load the browser package, host the
 * current tower on it, and follow every later `adoptSim` (a load, a new
 * game, an undo restore) onto a fresh engine. The state is published on
 * `window.__vcEngine` for tooling and for a tester to confirm which engine
 * runs. A tower the host cannot start from is reported and left on the
 * TypeScript engine, so the switch never takes the game down.
 */
export interface WasmHostStatus {
  engine: "wasm";
  /** Towers hosted so far (every adoptSim restarts the engine). */
  starts: number;
  /** Whether the current tower runs on the engine (false after a refusal). */
  hosted: boolean;
  errors: string[];
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
 *  deployment finds it under its own base. */
export function enginePackageUrl(base = import.meta.env.BASE_URL, href = globalThis.location?.href ?? "http://localhost/"): string {
  return new URL(`${base}engine/verticopolis_engine.js`, href).href;
}

/** Load and initialize the browser package. */
export async function loadWasmEngine(url = enginePackageUrl()): Promise<WasmModule> {
  const mod = (await import(/* @vite-ignore */ url)) as { default: () => Promise<unknown> };
  await mod.default();
  return checkBinding(mod);
}

export function startWasmHost(app: WasmHostApp, mod: WasmModule, log: Pick<Console, "info" | "error"> = console): WasmHostHandle {
  const status: WasmHostStatus = { engine: "wasm", starts: 0, hosted: false, errors: [] };
  let host: WasmHost | null = null;
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
  const follow = (sim: Simulation) => {
    release();
    try {
      host = attachWasmHost(sim, mod);
      status.starts++;
      status.hosted = true;
      log.info(`[wasm] tower ${status.starts} runs on the WASM engine`);
    } catch (e) {
      noteError(`not hosting this tower: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  follow(app.sim);

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
      if (!stopped) follow(app.sim);
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
