import type { Simulation } from "../engine/Simulation";
import type { ShadowCommand } from "./commands";
import { attachMirror, loadCommand } from "./mirror";
import type { WorkerReply } from "./worker";

/**
 * The browser side of the dual run (story-engine-dual-run): behind a
 * developer switch, the WASM engine runs in a worker beside the live
 * TypeScript engine, receives every command the live one receives, and the
 * two are compared at every hour boundary. The first divergence is reported
 * in the console with the JSON path where the views depart, and the run's
 * state is published on `window.__vcDualRun` for tooling.
 *
 * Switch it on with `?dualrun=1` in the URL or `localStorage.setItem("vc.dualrun", "1")`
 * under `npm run dev`: it only ever starts where the tooling handle does,
 * and the worker loads the browser package by URL from
 * `src/dualrun/pkg-web/` (written by `npm run wasm:build`), which only the
 * dev server serves.
 */
export interface DualRunStatus {
  /** Hours compared so far on the current tower. */
  hours: number;
  /** Towers the run has followed (every adoptSim restarts the shadow). */
  starts: number;
  /** The first divergence seen on the current tower, if any. */
  divergence: { label: string; view: string; path: string; live: string; shadow: string } | null;
  /** Errors from the worker (a missing package, a binding refusal). */
  errors: string[];
  lastLabel: string | null;
}

export interface DualRunApp {
  sim: Simulation;
  adoptSim(sim: Simulation, preserveHistory?: boolean): void;
}

export function dualRunRequested(location: { search: string } = window.location, storage: { getItem(k: string): string | null } | null = safeStorage()): boolean {
  if (new URLSearchParams(location.search).get("dualrun") === "1") return true;
  try {
    return storage?.getItem("vc.dualrun") === "1";
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface DualRunHandle {
  status: DualRunStatus;
  stop(): void;
}

/** Start the dual run on an app: shadow the current tower, follow every
 *  later `adoptSim`, and report through the console and the status. */
export function startDualRun(app: DualRunApp, makeWorker: () => Worker = defaultWorker, log: Pick<Console, "info" | "error" | "warn"> = console): DualRunHandle {
  const status: DualRunStatus = { hours: 0, starts: 0, divergence: null, errors: [], lastLabel: null };
  const worker = makeWorker();
  let detach: (() => void) | null = null;
  const send = (cmd: ShadowCommand) => worker.postMessage(cmd);
  // Bounded: a worker in trouble would otherwise report once per command.
  const noteError = (message: string) => {
    if (status.errors.length >= 50) return;
    status.errors.push(message);
    log.error(`[dualrun] ${message}`);
  };

  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const r = e.data;
    // An answer about a tower this run has since left is not this tower's.
    if (r.type !== "ready" && r.gen !== undefined && r.gen !== status.starts) return;
    switch (r.type) {
      case "ready": log.info("[dualrun] shadow engine ready"); break;
      case "ok": status.hours++; status.lastLabel = r.label; break;
      case "divergence":
        status.hours++;
        status.lastLabel = r.label;
        if (!status.divergence) {
          status.divergence = { label: r.label, view: r.view, path: r.path, live: r.live, shadow: r.shadow };
          log.error(`[dualrun] divergence at ${r.label} in the ${r.view} view at ${r.path}: live ${r.live}, shadow ${r.shadow}`);
        }
        break;
      case "error": noteError(r.message); break;
    }
  };
  worker.onerror = (e) => noteError(`worker error: ${e.message}`);

  const follow = (sim: Simulation) => {
    detach?.();
    status.hours = 0;
    status.divergence = null;
    status.starts++;
    // The shadow starts from the live tower's own save and boundary
    // markers, so both engines hold the same state, stand at the same
    // boundaries and rebuild the same crowd from the seed.
    send(loadCommand(sim, status.starts));
    detach = attachMirror(sim, send, status.starts);
  };
  // A tower the shadow cannot start from (one that already has a crowd) is
  // reported and left unmirrored, so the switch never takes the game down.
  const tryFollow = (sim: Simulation) => {
    try {
      follow(sim);
    } catch (e) {
      detach = null;
      noteError(`not following this tower: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  tryFollow(app.sim);

  const adopt = app.adoptSim;
  const ownAdopt = Object.getOwnPropertyDescriptor(app, "adoptSim");
  const wrappedAdopt = function (this: DualRunApp, sim: Simulation, preserveHistory?: boolean): void {
    adopt.call(this, sim, preserveHistory);
    tryFollow(sim);
  };
  Object.defineProperty(app, "adoptSim", { value: wrappedAdopt, configurable: true, writable: true });

  const handle: DualRunHandle = {
    status,
    stop() {
      detach?.();
      detach = null;
      // Put back what was there: the app's own property, or the prototype's.
      if (ownAdopt) Object.defineProperty(app, "adoptSim", ownAdopt);
      else delete (app as Partial<DualRunApp>).adoptSim;
      worker.terminate();
      const g = globalThis as unknown as { __vcDualRun?: DualRunHandle };
      if (g.__vcDualRun === handle) delete g.__vcDualRun;
    },
  };
  (globalThis as unknown as { __vcDualRun?: DualRunHandle }).__vcDualRun = handle;
  log.info("[dualrun] on: the WASM engine shadows this tower and is compared every hour");
  return handle;
}

function defaultWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}
