import type { Simulation } from "../engine/Simulation";
import { checkBinding, type WasmModule } from "../dualrun/binding";
import { attachWasmHost, type WasmHost } from "./wasmHost";
import { catalogVerdict } from "./foreignCatalog";
import { ENGINE_DIR, ENGINE_GLUE } from "./enginePackageNames";
import { EngineBootError, type FallbackReason, type FallbackStage } from "./engineBoot";
import { loadEngineModule, type LoadEngineOptions } from "./loadEngineModule";
import { recordHostError, type HostErrors } from "./hostErrors";
import type { FaultContext, HostFault } from "./hostFault";
import { towerStateSig } from "../engine/UndoHistory";

/** What a player can change and see: the undo signature (rooms, transports,
 *  labels, rents, money), the tower's name and an open emergency choice.
 *  Temporary, with the WASM engine's fallback (#874): it picks the line a
 *  recovery shows. */
function playerState(sim: Simulation): string {
  return `${towerStateSig(sim.tower, sim.money)}|${sim.tower.towerName ?? ""}|${sim.pendingChoice ? "choice" : ""}`;
}

/**
 * The app side of the WASM switch: load the browser package, host the
 * current tower on it, and follow every later `adoptSim` (a load, a new
 * game, an undo restore) onto a fresh engine. The state is published on
 * `window.__vcEngine` for tooling and for a tester to confirm which engine
 * runs. In a switchable build a tower the host cannot start from is reported
 * and left on the TypeScript engine, so the switch never takes the game down.
 * In a wasm-only build (`strict`) there is no TypeScript engine to leave it
 * on: the refusal is reported the same way and `onFatal` stops the game.
 *
 * The same holds while a tower runs (#874): when a call into the engine
 * throws, the host freezes, the fault is reported like a refusal, and once
 * the call that faulted has returned the app adopts a fresh TypeScript tower
 * from the host's newest restore point, with a log line saying so (and that
 * the player's recent changes were undone, when commands since the point
 * changed what the player sees). No tower is hosted again in this page life,
 * since a trapped module may be corrupt. A wasm-only build stops through
 * `onFatal` instead.
 *
 * A command that traps has already answered its caller with the TypeScript
 * instance's result. A command runs outside the frame callback, so the
 * recovery runs before the next frame is drawn and the change is never
 * shown; a trap in a tick or a sync happens inside the frame, which draws
 * the frozen tower once. What the player sees is the log line and its
 * toast, the restored tower's money, and no undo or redo step that would
 * change nothing.
 *
 * The re-adoption on TypeScript (`recover`, and the restore points behind
 * it) is temporary compatibility code for 3.0's switchable build. When the
 * TypeScript simulation retires, every build takes the strict path, and
 * that code goes with it; the freeze and the report stay.
 */
export interface WasmHostStatus extends HostErrors {
  engine: "wasm";
  /** Towers hosted so far (every adoptSim restarts the engine). */
  starts: number;
  /** Whether the current tower runs on the engine (false after a refusal
   *  or a fault). */
  hosted: boolean;
  /** Towers left on the TypeScript engine (or, in a wasm-only build, the
   *  stop) so far, every one counted where `errors` keeps only the first ones. */
  fallbacks: number;
  /** The code and stage of the latest fallback, as analytics reports it
   *  (`engine_status`); null while there has been none. */
  lastFallback: HostFallback | null;
}

/** A fallback as codes only: its message is `lastError` until a later
 *  error replaces it, is in `errors` while that list has room, and is logged. */
export interface HostFallback {
  reason: FallbackReason;
  stage: FallbackStage;
}

export interface WasmHostApp {
  sim: Simulation;
  adoptSim(sim: Simulation, preserveHistory?: boolean): void;
  /** The app's undo and redo, when it has them: wrapped so that a fault
   *  inside one is coded `trap-undo`. */
  undo?(): void;
  redo?(): void;
  /** The undo capture before an edit gesture: wrapped so that a fault in
   *  its save is coded `trap-command`. */
  captureUndo?(label: string): void;
  /** Drop the undo and redo steps that would change nothing on the tower
   *  the recovery adopted (the lost change's), when the app keeps a
   *  history, and answer how many went. Temporary, with the re-adoption on
   *  TypeScript. */
  dropEmptyUndo?(): number;
  /** Keep the redo steps an edit clears while a fallback can still take
   *  that edit away, so the tidy can put them back. Temporary, with the
   *  re-adoption on TypeScript. */
  holdClearedRedo?(on: boolean): void;
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

export interface WasmHostOptions {
  /** A wasm-only build: a tower the host refuses is fatal, never left on the
   *  TypeScript engine. */
  strict?: boolean;
  /** Called once, in strict mode, with the reason the host could not hold a
   *  tower and its code (`attach-refused`, or `package-mismatch` for a
   *  package whose catalogs this build cannot draw), or the reason a hosted
   *  tower's engine failed and its trap code (#874). */
  onFatal?: (message: string, reason: FallbackReason) => void;
  /** When the read model follows the engine (`attachWasmHost`'s option):
   *  "step" (the default) or the experimental "frame" (`?engine=wasm-frame`). */
  sync?: "step" | "frame";
  /** Called with the codes of every tower the host would not take, the first
   *  one included, and of every fault, after the status records it. A throw
   *  from it is logged, and the adopt or the faulted call goes on. */
  onFallback?: (fallback: HostFallback) => void;
}

export function startWasmHost(app: WasmHostApp, mod: WasmModule, log: Pick<Console, "info" | "error"> = console, opts: WasmHostOptions = {}): WasmHostHandle {
  const status: WasmHostStatus = { engine: "wasm", starts: 0, hosted: false, fallbacks: 0, lastFallback: null, errors: [], lastError: null, droppedErrors: 0 };
  let host: WasmHost | null = null;
  let fatal = false;
  // A fault latches hosting off for the page life (#874).
  let faulted = false;
  // Whether the latest swap kept the undo trail (an undo or a redo), where
  // a load or a new game drops it. Temporary, with the re-adoption.
  let keptHistory = false;
  let undoDepth = 0;
  let captureDepth = 0;
  const noteError = (message: string) => {
    recordHostError(status, message);
    log.error(`[wasm] ${message}`);
  };
  // Let go of the current tower. The host is still current while it lets
  // go, so a trap there is a fault (it latches hosting off). Any other throw
  // goes to the status and the log, so a load or a new game stays the way
  // out of a dead engine.
  const release = () => {
    const h = host;
    try {
      h?.detach();
    } catch (e) {
      noteError(`letting go of the last tower: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      host = null;
      status.hosted = false;
    }
  };
  // Whether the package's catalogs are foreign to this build (see
  // catalogVerdict). A verdict is kept: the package cannot change under the
  // page. An engine that will not hand its catalogs over has none, and is
  // asked again at the next refusal.
  let foreign: boolean | undefined;
  const foreignPackage = (): boolean => {
    if (foreign !== undefined) return foreign;
    // Called as a method, so the binding keeps its `this`.
    const verdict = catalogVerdict(typeof mod.catalog === "function" ? (mode) => mod.catalog?.(mode) ?? "" : undefined);
    if (verdict === "failing") return false;
    return (foreign = verdict === "foreign");
  };
  // Record a fallback: a tower the host would not take, or a fault.
  const fallBack = (message: string, reason: FallbackReason, stage: FallbackStage) => {
    noteError(message);
    status.fallbacks++;
    status.lastFallback = { reason, stage };
    try {
      opts.onFallback?.(status.lastFallback);
    } catch (err) {
      log.error(`[wasm] reporting the fallback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (opts.strict && !fatal) {
      fatal = true;
      // A throw from the stop is logged, and the adopt or the call that
      // caused it goes on.
      try {
        opts.onFatal?.(message, reason);
      } catch (err) {
        log.error(`[wasm] stopping the game failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  // A hosted tower's engine threw (#874). The host is frozen already, so the
  // rest of the call that faulted runs on it harmlessly; the fresh tower
  // comes after that call returns, so nothing swaps the tower under a
  // caller still holding it.
  const onFault = (h: WasmHost, sim: Simulation, stage: FallbackStage, fault: HostFault) => {
    if (host !== h) return; // a tower already let go
    faulted = true;
    status.hosted = false;
    fallBack(fault.message, fault.reason, stage);
    if (opts.strict) return;
    queueMicrotask(() => {
      try {
        recover(h, sim);
      } finally {
        holdRedo(false);
      }
    });
  };
  // Temporary compatibility code: removed with the TypeScript simulation.
  const REPLACED = "The WASM engine stopped, so the game runs on the TypeScript engine now.";
  const LOST = "The WASM engine stopped, so some of your recent changes were lost. The game runs on the TypeScript engine now.";
  const STUCK = "The WASM engine stopped, and the tower could not go back to a good state. Load a save or start a new tower to keep playing.";
  const RESTORED = "The WASM engine stopped, so the tower went back to its last good state and runs on the TypeScript engine.";
  const UNDONE = "The WASM engine stopped, so the tower went back to its last good state and your recent changes were undone. It runs on the TypeScript engine now.";
  const say = (sim: Simulation, line: string) => {
    try {
      sim.emit(line, "bad");
    } catch (e) {
      noteError(`telling the player the engine stopped: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // Undo and redo steps that would change nothing on the tower now: the
  // lost change's, or a redo step an undo took from the frozen tower. It
  // answers how many went.
  const tidyHistory = (): number => {
    try {
      return app.dropEmptyUndo?.() ?? 0;
    } catch (e) {
      noteError(`tidying the undo trail: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  };
  // While a fault can still take an edit away (a hosted tower, in a build
  // that falls back), the history keeps the redo steps the edit cleared, for
  // the tidy to put back.
  const holdRedo = (on: boolean) => {
    try {
      app.holdClearedRedo?.(on);
    } catch (e) {
      noteError(`setting the undo trail's redo hold: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const recover = (h: WasmHost, sim: Simulation) => {
    if (stopped) return;
    // A load, a new game, an undo or a redo replaced the tower since the
    // fault (the swap let the faulted host go, and nothing is hosted again),
    // so there is nothing to restore; the player still hears why. After an
    // undo or a redo, the line also says changes were lost when commands ran
    // after the newest point or the trail lost steps (an undo's own snapshot
    // read that point). A load or a new game let the old tower's changes go
    // itself, so the line does not blame the engine for them.
    if (app.sim !== sim) {
      const dropped = tidyHistory();
      say(app.sim, keptHistory && (h.lostEdits > 0 || dropped > 0) ? LOST : REPLACED);
      return;
    }
    let fresh: Simulation;
    try {
      fresh = h.restore();
    } catch (e) {
      noteError(`no restore point loads, so the tower stays stopped: ${e instanceof Error ? e.message : String(e)}`);
      say(sim, STUCK);
      return;
    }
    // The player's own changes since the point are undone: commands ran on
    // the read model, and what the player can see differs (a refused
    // command changes nothing, and the clock's own changes are not theirs).
    let undone = h.lostEdits > 0;
    try {
      undone &&= playerState(sim) !== playerState(fresh);
    } catch {
      // The command count alone answers.
    }
    // The undo path: it keeps the camera, the undo trail and the bridging
    // toggle, and a title screen still up. The release in the adopt wrapper
    // lets the faulted host go, which hands back the events it holds, and the
    // adopt passes them on.
    try {
      app.adoptSim(fresh, true);
    } catch (e) {
      noteError(`adopting the restored tower: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (app.sim !== fresh) {
      // The adopt failed: the player still hears why the tower stopped.
      say(app.sim, app.sim === sim ? STUCK : REPLACED);
      return;
    }
    tidyHistory();
    say(fresh, undone ? UNDONE : RESTORED);
  };
  // `stage` says which tower this is: the first one (`start`), a load or a
  // new game (`adopt`), or an undo restore (`undo`).
  const context = (): FaultContext => {
    if (undoDepth > 0) return "undo";
    return captureDepth > 0 ? "capture" : null;
  };
  const follow = (sim: Simulation, stage: FallbackStage) => {
    release();
    if (faulted) return;
    try {
      let attached: WasmHost | null = null;
      attached = attachWasmHost(sim, mod, {
        sync: opts.sync,
        context,
        onFault: (fault) => {
          if (attached) onFault(attached, sim, stage, fault);
        },
      });
      host = attached;
      status.starts++;
      status.hosted = true;
      log.info(`[wasm] tower ${status.starts} runs on the WASM engine`);
    } catch (e) {
      fallBack(`not hosting this tower: ${e instanceof Error ? e.message : String(e)}`, foreignPackage() ? "package-mismatch" : "attach-refused", stage);
    }
    // A wasm-only build stops instead of falling back, and a tower left on
    // the TypeScript engine has nothing to fall back from.
    holdRedo(!opts.strict && host !== null);
  };
  follow(app.sim, "start");

  const adopt = app.adoptSim;
  const ownAdopt = Object.getOwnPropertyDescriptor(app, "adoptSim");
  let stopped = false;
  // An undo or a redo runs with `undoDepth` above 0, so a fault in its
  // snapshot is coded `trap-undo`; an undo capture runs with `captureDepth`
  // above 0, so a fault in its save is coded `trap-command`.
  const ownHistory = (["undo", "redo", "captureUndo"] as const).map((name) => {
    const own = Object.getOwnPropertyDescriptor(app, name);
    const run = app[name] as ((this: WasmHostApp, ...args: unknown[]) => void) | undefined;
    if (typeof run === "function") {
      const capture = name === "captureUndo";
      const wrapped = function (this: WasmHostApp, ...args: unknown[]): void {
        if (capture) captureDepth++;
        else undoDepth++;
        try {
          run.apply(this, args);
        } finally {
          if (capture) captureDepth--;
          else undoDepth--;
        }
      };
      Object.defineProperty(app, name, { value: wrapped, configurable: true, writable: true });
    }
    return { name, own, wrapped: typeof run === "function" };
  });
  const wrappedAdopt = function (this: WasmHostApp, sim: Simulation, preserveHistory?: boolean): void {
    // Let the old tower go first: the detach hands it back the events its
    // engine still owes, with the drop count, so the adopt passes them to the
    // tower that replaces it without asking an engine that may have trapped.
    // Then host whichever tower the app holds. An adopt that throws before
    // its swap (GameApp's cannot) leaves the old tower, re-hosted when it has
    // no crowd yet and otherwise reported and left on the TypeScript engine.
    // Adopting the tower already held keeps its host.
    if (sim === app.sim) return adopt.call(this, sim, preserveHistory);
    keptHistory = preserveHistory === true;
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
      holdRedo(false);
      release();
      if (ownAdopt) Object.defineProperty(app, "adoptSim", ownAdopt);
      else delete (app as Partial<WasmHostApp>).adoptSim;
      for (const { name, own, wrapped } of ownHistory) {
        if (!wrapped) continue;
        if (own) Object.defineProperty(app, name, own);
        else delete (app as Partial<WasmHostApp>)[name];
      }
      const g = globalThis as unknown as { __vcEngine?: WasmHostHandle };
      if (g.__vcEngine === handle) delete g.__vcEngine;
    },
  };
  (globalThis as unknown as { __vcEngine?: WasmHostHandle }).__vcEngine = handle;
  return handle;
}
