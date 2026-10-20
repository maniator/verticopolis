import type { WasmModule } from "../dualrun/binding";
import { EnginePackageError, type PackageFailureDetail, type PackageFailureKind } from "./enginePackageCheck";
import { readEngineIdentity } from "./engineIdentity";
import type { BuildMetadataResult } from "./buildSection";

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
 * that failed after the worker host started (the host is let go). The
 * runtime fallback (#874) sends the trap codes for a running engine's fault
 * in a command (the undo capture's save just before an edit included), a
 * tick, a frame sync or the event drain, or an undo or redo, and `other` for
 * a save or the reads when a tower is let go.
 */
export const FALLBACK_REASONS = ["none", "boot-timeout", "boot-error", "package-mismatch", "attach-refused", "trap-command", "trap-tick", "trap-undo", "other"] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

/** Where a fallback happened: loading the package, starting the host on the
 *  first tower, or a later tower the host was handed (a load or a new game,
 *  or an undo restore). Closed like {@link FALLBACK_REASONS}. A running
 *  engine's fault (#874) takes the stage of how its tower was hosted, so the
 *  trap code says which path failed and the stage on which kind of tower. */
export const FALLBACK_STAGES = ["none", "load", "start", "adopt", "undo"] as const;
export type FallbackStage = (typeof FALLBACK_STAGES)[number];

/** Why the byte check refused the engine package, as plain data (so a worker
 *  can send it): the kind, the file, both package ids and whether a service
 *  worker controlled the page (#985). Hex ids and codes only; the boot state
 *  carries it for tooling and support, and analytics never does. */
export type PackageFailure = PackageFailureDetail & { kind: PackageFailureKind };

export interface EngineBootFailure {
  stage: BootStage;
  /** The code analytics reports; never derived from `message`. */
  reason: FallbackReason;
  message: string;
  /** Set when the byte check refused the package. */
  package?: PackageFailure;
}

/** A boot failure that already knows its code: the load's time limit, a
 *  package that does not match this shell. Anything else on the way to a
 *  running engine is `boot-error` (see {@link bootFailureReason}). */
export class EngineBootError extends Error {
  readonly reason: FallbackReason;
  readonly package?: PackageFailure;
  constructor(reason: FallbackReason, message: string, pkg?: PackageFailure) {
    super(message);
    this.name = "EngineBootError";
    this.reason = reason;
    if (pkg) this.package = pkg;
  }
}

/** The codes a failed load can carry: the rest of the closed list is for a
 *  fault in a running engine or for no fault at all. */
export const LOAD_FAILURE_REASONS: readonly FallbackReason[] = ["boot-error", "package-mismatch", "boot-timeout"];

const PACKAGE_KINDS: readonly string[] = ["mismatch", "load-failed", "unverifiable"];
const PACKAGE_FILES: readonly string[] = ["glue", "wasm", "build-record"];
const hexId = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-f]{12}$/.test(v) ? v : null);

/** A package detail that came across a worker message, rebuilt from known
 *  values only: the kind and file from their lists, the ids as 12 hex digits.
 *  Anything else is dropped, so the boot state never carries free text from a
 *  message. Undefined when there is no usable kind. */
export function cleanPackageFailure(raw: unknown): PackageFailure | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const p = raw as Record<string, unknown>;
  if (typeof p.kind !== "string" || !PACKAGE_KINDS.includes(p.kind)) return undefined;
  return {
    kind: p.kind as PackageFailureKind,
    file: typeof p.file === "string" && PACKAGE_FILES.includes(p.file) ? (p.file as PackageFailure["file"]) : null,
    expected: hexId(p.expected),
    found: hexId(p.found),
    expectedPackage: hexId(p.expectedPackage),
    servedPackage: hexId(p.servedPackage),
    controlled: p.controlled === true,
  };
}

/** A worker's account of the binary's build section, rebuilt from known
 *  values (a state from the list, a 64-digit hash, a short reason), so the
 *  boot state never carries free text from a message. Undefined for anything
 *  else. */
export function cleanBuildMetadata(raw: unknown): BuildMetadataResult | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const b = raw as Record<string, unknown>;
  if (b.state === "missing") return { state: "missing" };
  if (b.state === "ok") return typeof b.sourceHash === "string" && /^[0-9a-f]{64}$/.test(b.sourceHash) ? { state: "ok", sourceHash: b.sourceHash } : undefined;
  if (b.state === "malformed") return { state: "malformed", why: typeof b.why === "string" ? b.why.slice(0, 120) : "" };
  return undefined;
}

/** The code for a refused package. A set that disagrees with the shell is a
 *  mismatch. Files that did not arrive and a browser that cannot hash are
 *  `boot-error` for now: the closed list has no code of their own until the
 *  owner approves one (#985 slice 2b), and the boot state keeps the kind. */
export function packageFailureReason(kind: PackageFailureKind): FallbackReason {
  return kind === "mismatch" ? "package-mismatch" : "boot-error";
}

/** The code for a failure on the way to a running engine. A glue and binary
 *  from different builds fail to link: that is a package mismatch, and the
 *  engine itself may be sound. Every other untyped failure is `boot-error`. */
export function bootFailureReason(e: unknown): FallbackReason {
  if (e instanceof EngineBootError) return e.reason;
  if (e instanceof EnginePackageError) return packageFailureReason(e.kind);
  if (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.LinkError) return "package-mismatch";
  return "boot-error";
}

/** The package detail of a failure, when the byte check refused the package. */
export function packageFailureOf(e: unknown): PackageFailure | undefined {
  if (e instanceof EnginePackageError) return { kind: e.kind, ...e.detail };
  if (e instanceof EngineBootError) return e.package;
  return undefined;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A boot failure built from what was thrown. */
export function bootFailure(stage: BootStage, e: unknown): EngineBootFailure {
  const pkg = packageFailureOf(e);
  return { stage, reason: bootFailureReason(e), message: messageOf(e), ...(pkg ? { package: pkg } : {}) };
}

export interface EngineBootState {
  build: "wasm-only" | "switchable";
  /** The engine boot settled on: "none" once a wasm-only build has failed. */
  engine: BootEngine;
  failure: EngineBootFailure | null;
  /** Set once the engine save writer has turned itself off this page life
   *  (`vctowerWriter.ts`); absent until then. */
  writerLatched?: true;
  /** The engine's identity record as the loaded package reports it
   *  (`engineIdentity()`, #963), for About and Copy Diagnostics. Absent when
   *  no engine loaded or the package has no such call. */
  identity?: string;
  /** What the engine binary's `verticopolis.build` section said (#963): the
   *  hash of the Rust sources it was built from, `missing` or `malformed`.
   *  Absent when the binary was never read (a TypeScript boot, or a load that
   *  failed before the binary compiled). Read even when the engine then
   *  failed to link, so About can say which build the failed binary was. */
  binary?: BuildMetadataResult;
}

export interface EngineBootOptions {
  wasmOnly: boolean;
  /** Loads the engine. The signal fires at the time limit; the loader checks
   *  it after each step and drops a result that arrives later. `onBuild` gets
   *  the binary's build metadata as soon as it is read, so a failure later in
   *  the load still reports it. */
  load: (signal: AbortSignal, onBuild: (build: BuildMetadataResult) => void) => Promise<WasmModule>;
  log?: Pick<Console, "error">;
  /** How long the load may take before boot gives up on it (ms). */
  timeoutMs?: number;
}

/** The load's limit when the caller sets none. Generous: a first visit on a
 *  slow connection downloads the whole engine; an installed game reads it
 *  from the precache in milliseconds. Without a limit, a stalled fetch would
 *  leave a wasm-only boot on a blank page with no message. */
export const ENGINE_LOAD_TIMEOUT_MS = 90_000;

function withTimeout<T>(work: Promise<T>, ms: number, expire: () => void): Promise<T> {
  return new Promise<T>((done, fail) => {
    const seconds = Math.round(ms / 1000);
    const timer = setTimeout(() => {
      // The attempt is terminal before the timeout is published.
      expire();
      fail(new EngineBootError("boot-timeout", `the engine package did not load within ${seconds} ${seconds === 1 ? "second" : "seconds"}`));
    }, ms);
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
  let binary: BuildMetadataResult | undefined;
  const binaryField = () => (binary === undefined ? {} : { binary });
  try {
    const attempt = new AbortController();
    mod = await withTimeout(opts.load(attempt.signal, (b) => (binary = b)), opts.timeoutMs ?? ENGINE_LOAD_TIMEOUT_MS, () => attempt.abort());
  } catch (e) {
    if (!opts.wasmOnly) {
      // The fallback is recorded with its reason (#874) as well as logged.
      log.error("[wasm] the engine package did not load; running on the TypeScript engine:", e);
      return { module: null, state: { build, engine: "ts", failure: bootFailure("load", e), ...binaryField() } };
    }
    log.error("[wasm] the engine package did not load, and this build has no other engine:", e);
    return { module: null, state: { build, engine: "none", failure: bootFailure("load", e), ...binaryField() } };
  }
  // Saves go through the engine's own writer (#935). A switchable build keeps
  // the TypeScript writer for a package without one; a wasm-only build needs it.
  if (opts.wasmOnly && !mod.encodeVctower) {
    const message = "the engine package has no save writer (encodeVctower); rebuild it";
    log.error(`[wasm] ${message}`);
    return { module: null, state: { build, engine: "none", failure: { stage: "load", reason: "package-mismatch", message }, ...binaryField() } };
  }
  const identity = readEngineIdentity(mod);
  return { module: mod, state: { build, engine: "wasm", failure: null, ...(identity === undefined ? {} : { identity }), ...binaryField() } };
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
