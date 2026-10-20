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

/**
 * Why the engine fell back (or, in a wasm-only build, stopped), as a code from
 * a closed list. The code is what analytics and the host status report
 * (`engine_status`, `docs/analytics-data-map.md`); the message beside it stays
 * on the console and the boot state and is never put in that event, since an
 * engine message can quote a tower name or a path.
 *
 * Boot sends the first five, plus `other` for a boot step outside the engine
 * that failed after the worker host started (the host is let go). The trap
 * codes are reserved for the runtime fallback (#874), which also sends
 * `other`, so the list is fixed before the field ships.
 */
export const FALLBACK_REASONS = ["none", "boot-timeout", "boot-error", "package-mismatch", "attach-refused", "trap-command", "trap-tick", "trap-undo", "other"] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

/** Where a fallback happened: loading the package, starting the host on the
 *  first tower, or a later tower the host was handed (a load or a new game,
 *  or an undo restore). Closed like {@link FALLBACK_REASONS}; #874 adds its
 *  runtime stages here. */
export const FALLBACK_STAGES = ["none", "load", "start", "adopt", "undo"] as const;
export type FallbackStage = (typeof FALLBACK_STAGES)[number];

export interface EngineBootFailure {
  stage: BootStage;
  /** The code analytics reports; never derived from `message`. */
  reason: FallbackReason;
  message: string;
}

/** A boot failure that already knows its code: the load's time limit, a
 *  package that does not match this shell. Anything else on the way to a
 *  running engine is `boot-error` (see {@link bootFailureReason}). */
export class EngineBootError extends Error {
  readonly reason: FallbackReason;
  constructor(reason: FallbackReason, message: string) {
    super(message);
    this.name = "EngineBootError";
    this.reason = reason;
  }
}

/** The code for a failure on the way to a running engine. A glue and binary
 *  from different builds fail to link: that is a package mismatch, and the
 *  engine itself may be sound. Every other untyped failure is `boot-error`. */
export function bootFailureReason(e: unknown): FallbackReason {
  if (e instanceof EngineBootError) return e.reason;
  if (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.LinkError) return "package-mismatch";
  return "boot-error";
}

export interface EngineBootState {
  build: "wasm-only" | "switchable";
  /** The engine boot settled on: "none" once a wasm-only build has failed. */
  engine: BootEngine;
  failure: EngineBootFailure | null;
  /** Set once the engine save writer has turned itself off this page life
   *  (`vctowerWriter.ts`); absent until then. */
  writerLatched?: true;
}

export interface EngineBootOptions {
  wasmOnly: boolean;
  load: () => Promise<WasmModule>;
  log?: Pick<Console, "error">;
  /** How long the load may take before boot gives up on it (ms). */
  timeoutMs?: number;
}

/** The load's limit when the caller sets none. Generous: a first visit on a
 *  slow connection downloads the whole engine; an installed game reads it
 *  from the precache in milliseconds. Without a limit, a stalled fetch would
 *  leave a wasm-only boot on a blank page with no message. */
export const ENGINE_LOAD_TIMEOUT_MS = 90_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((done, fail) => {
    const seconds = Math.round(ms / 1000);
    const timer = setTimeout(() => fail(new EngineBootError("boot-timeout", `the engine package did not load within ${seconds} ${seconds === 1 ? "second" : "seconds"}`)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        done(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        fail(e);
      },
    );
  });
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
    mod = await withTimeout(opts.load(), opts.timeoutMs ?? ENGINE_LOAD_TIMEOUT_MS);
  } catch (e) {
    if (!opts.wasmOnly) {
      // The fallback is recorded with its reason (#874) as well as logged.
      log.error("[wasm] the engine package did not load; running on the TypeScript engine:", e);
      return { module: null, state: { build, engine: "ts", failure: { stage: "load", reason: bootFailureReason(e), message: messageOf(e) } } };
    }
    log.error("[wasm] the engine package did not load, and this build has no other engine:", e);
    return { module: null, state: { build, engine: "none", failure: { stage: "load", reason: bootFailureReason(e), message: messageOf(e) } } };
  }
  // Saves go through the engine's own writer (#935). A switchable build keeps
  // the TypeScript writer for a package without one; a wasm-only build needs it.
  if (opts.wasmOnly && !mod.encodeVctower) {
    const message = "the engine package has no save writer (encodeVctower); rebuild it";
    log.error(`[wasm] ${message}`);
    return { module: null, state: { build, engine: "none", failure: { stage: "load", reason: "package-mismatch", message } } };
  }
  return { module: mod, state: { build, engine: "wasm", failure: null } };
}

/** Mark a boot that loaded its engine but could not start or keep it. */
export function failBoot(state: EngineBootState, stage: BootStage, reason: FallbackReason, message: string): EngineBootState {
  return { ...state, engine: state.build === "wasm-only" ? "none" : "ts", failure: { stage, reason, message } };
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
  const host = failure.stage === "host";
  const headline = host ? "The game engine stopped running this tower, so the game has stopped." : "The game engine could not start, so the game cannot run.";
  const steps = [
    host
      ? "Reload the page to continue from your last save. Changes since that save may be lost."
      : "Reload the page to try again. Your saved towers stay in this browser.",
  ];
  if (!online) {
    steps.push("You appear to be offline. If the game was updated since this device last opened it, connect to the internet and reload once so the new engine can download.");
  }
  steps.push("If it keeps happening, update your browser or try another one.");
  return { headline, reason: failure.message, steps };
}
