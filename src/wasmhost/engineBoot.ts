import type { WasmModule } from "../dualrun/binding";

/**
 * How boot gets its engine, for both build modes (see
 * `src/build/engineBundle.ts`). A switchable build loads the WASM package only
 * when asked (`?engine=wasm`, `vc.engine`) and stays on the TypeScript engine
 * when it fails, with the reason in the console. A wasm-only build always
 * loads it, and a package that fails to load or lacks a part the game needs
 * is a failure that stops boot: there is no TypeScript engine to fall back to,
 * and a quiet fallback is what the build exists to rule out.
 *
 * The result is published on `window.__vcEngineBoot` so a tester, the e2e
 * suites and a support session can read which build this is, which engine it
 * runs and why it stopped, without a console handle into the sim.
 */
export type BootEngine = "wasm" | "ts" | "none";
export type BootStage = "load" | "start" | "host";

export interface EngineBootFailure {
  stage: BootStage;
  message: string;
}

export interface EngineBootState {
  build: "wasm-only" | "switchable";
  /** The engine boot settled on: "none" once a wasm-only build has failed. */
  engine: BootEngine;
  failure: EngineBootFailure | null;
}

export interface EngineBootOptions {
  wasmOnly: boolean;
  load: () => Promise<WasmModule>;
  log?: Pick<Console, "error">;
}

export interface EngineBootResult {
  module: WasmModule | null;
  state: EngineBootState;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A switchable build's boot when the WASM engine was not asked for. Boot
 *  takes it without awaiting, so a TypeScript boot stays synchronous. */
export function typescriptBoot(): EngineBootResult {
  return { module: null, state: { build: "switchable", engine: "ts", failure: null } };
}

/** Load the WASM engine for boot (a wasm-only build, or a switchable one
 *  that asked for it). Never throws: a failure is in the state. */
export async function loadBootEngine(opts: EngineBootOptions): Promise<EngineBootResult> {
  const log = opts.log ?? console;
  const build = opts.wasmOnly ? "wasm-only" : "switchable";
  let mod: WasmModule;
  try {
    mod = await opts.load();
  } catch (e) {
    if (!opts.wasmOnly) {
      log.error("[wasm] the engine package did not load; running on the TypeScript engine:", e);
      return typescriptBoot();
    }
    log.error("[wasm] the engine package did not load, and this build has no other engine:", e);
    return { module: null, state: { build, engine: "none", failure: { stage: "load", message: messageOf(e) } } };
  }
  // Saves go through the engine's own writer (#935). A switchable build keeps
  // the TypeScript writer for a package without one; a wasm-only build needs it.
  if (opts.wasmOnly && !mod.encodeVctower) {
    const message = "the engine package has no save writer (encodeVctower); rebuild it";
    log.error(`[wasm] ${message}`);
    return { module: null, state: { build, engine: "none", failure: { stage: "load", message } } };
  }
  return { module: mod, state: { build, engine: "wasm", failure: null } };
}

/** Mark a boot that loaded its engine but could not start or keep it. */
export function failBoot(state: EngineBootState, stage: BootStage, message: string): EngineBootState {
  return { ...state, engine: state.build === "wasm-only" ? "none" : "ts", failure: { stage, message } };
}

/** Publish the boot state for tooling, tests and support. */
export function publishBootState(state: EngineBootState, g: { __vcEngineBoot?: EngineBootState } = globalThis as { __vcEngineBoot?: EngineBootState }): void {
  g.__vcEngineBoot = state;
}

/** What the player is told when a wasm-only build cannot run its engine: what
 *  happened, the reason, and what to try, in order. Plain data, so the boot
 *  overlay renders it and the tests read it. */
export interface EngineFailureCopy {
  headline: string;
  reason: string;
  steps: string[];
}

export function engineFailureCopy(failure: EngineBootFailure, online: boolean): EngineFailureCopy {
  const headline =
    failure.stage === "host"
      ? "The game engine stopped running this tower, so the game has paused here."
      : "The game engine could not start, so the game cannot run.";
  const steps = ["Reload the page to try again. Your saved towers stay in this browser."];
  if (!online) {
    steps.push("You appear to be offline. If the game was updated since this device last opened it, connect to the internet and reload once so the new engine can download.");
  }
  steps.push("If it keeps happening, update your browser or try another one.");
  return { headline, reason: failure.message, steps };
}
