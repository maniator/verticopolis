import type { Simulation } from "../engine/Simulation";
import type { WasmHostApp } from "./startWasmHost";
import { attachWorkerHost, type WorkerHost } from "./workerHost";
import type { FromWorker, ToWorker } from "./workerProtocol";
import { EngineBootError } from "./engineBoot";
import { recordHostError, type HostErrors } from "./hostErrors";

/**
 * The app side of the experimental worker host (`?engine=wasm-worker`): own
 * the engine worker, host the current tower on it, follow every `adoptSim`
 * onto a fresh tower in the same worker, and fall back to the TypeScript
 * engine when the worker fails. Published on `window.__vcEngine` like the
 * main-thread host, with `placement: "worker"`.
 *
 * A failure (a refused load, a crashed worker, a reply the host cannot
 * apply) lets the tower go: it continues on the TypeScript engine from the
 * read model, and the failure is on the status and the console. The broken
 * worker is terminated; the next tower the app adopts starts a fresh one,
 * so a load or a new game is the way back onto the engine.
 */
export interface EngineWorkerLike {
  postMessage(msg: ToWorker, transfer?: Transferable[]): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  terminate(): void;
}

export interface SpawnedWorker {
  worker: EngineWorkerLike;
  catalogs: { classic: string; modern: string };
  /** The engine's identity record as the worker read it (#963); undefined for a package without the call. */
  identity?: string;
}

export interface WorkerHostStatus extends HostErrors {
  engine: "wasm";
  placement: "worker";
  starts: number;
  hosted: boolean;
  /** Workers started (a failure starts the next tower on a fresh one). */
  workers: number;
}

export interface WorkerHostHandle {
  status: WorkerHostStatus;
  current(): WorkerHost | null;
  /** Resolve once the current tower's read model holds the engine's exact
   *  state (see `WorkerHost.settle`). */
  settle(): Promise<void>;
  stop(): void;
}

/** How long a worker gets to load the package and answer ready. */
export const WORKER_READY_TIMEOUT_MS = 20_000;

/** Start a worker and wait for its ready reply. `make` builds the worker
 *  (the browser's module worker in the app; an in-process channel in the
 *  tests). Rejects on a load error, a crash or the timeout, terminating it. */
export function spawnEngineWorker(make: () => EngineWorkerLike, url: string, timeoutMs = WORKER_READY_TIMEOUT_MS): Promise<SpawnedWorker> {
  // A worker that cannot even be made (a blocked script, a bad URL) rejects
  // like one that fails to load, never throws at the caller.
  let worker: EngineWorkerLike;
  try {
    worker = make();
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
  return new Promise<SpawnedWorker>((resolve, reject) => {
    // The ready timeout carries its code (`boot-timeout`), as the main-thread
    // load's limit does; every other start failure is an untyped error.
    const fail = (message: string, timedOut = false) => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      reject(timedOut ? new EngineBootError("boot-timeout", message) : new Error(message));
    };
    const timer = setTimeout(() => fail(`the engine worker did not answer within ${timeoutMs} ms`, true), timeoutMs);
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "ready") {
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        resolve({ worker, catalogs: msg.catalogs, identity: msg.identity });
      } else if (msg.type === "error") {
        fail(msg.message);
      }
    };
    worker.onerror = (e) => fail(`the engine worker failed to start: ${e.message ?? "unknown error"}`);
    try {
      worker.postMessage({ type: "init", url });
    } catch (e) {
      fail(`could not start the engine worker: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

/** The browser's module worker for the engine. */
export function makeBrowserWorker(): EngineWorkerLike {
  return new Worker(new URL("./engineWorker.ts", import.meta.url), { type: "module" }) as unknown as EngineWorkerLike;
}

export function startWorkerHost(app: WasmHostApp, first: SpawnedWorker, respawn: () => Promise<SpawnedWorker>, log: Pick<Console, "info" | "error"> = console): WorkerHostHandle {
  const status: WorkerHostStatus = { engine: "wasm", placement: "worker", starts: 0, hosted: false, workers: 1, errors: [], lastError: null, droppedErrors: 0 };
  let worker: EngineWorkerLike | null = null;
  let catalogs = first.catalogs;
  let host: WorkerHost | null = null;
  let gen = 0;
  let stopped = false;
  let respawning: Promise<void> | null = null;
  // Record before logging, as the main-thread host does. Every error is
  // logged.
  const noteError = (message: string) => {
    recordHostError(status, message);
    log.error(`[wasm-worker] ${message}`);
  };
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
  /** Drop the worker: its tower goes back to the TypeScript engine. */
  const kill = (message: string) => {
    // Let the tower go first, so a detach that throws is recorded before the
    // cause and `lastError` names the cause.
    release();
    noteError(message);
    const w = worker;
    worker = null;
    if (w) {
      w.onmessage = null;
      w.onerror = null;
      w.terminate();
    }
  };
  const adoptWorker = (w: EngineWorkerLike) => {
    worker = w;
    w.onmessage = (e) => host?.receive(e.data);
    w.onerror = (e) => kill(`the engine worker crashed: ${e.message ?? "unknown error"}`);
  };
  adoptWorker(first.worker);

  const follow = (sim: Simulation) => {
    release();
    const w = worker;
    if (!w) {
      // The last worker failed: start a fresh one and host whichever tower
      // the app holds once it is ready (a tower that ticked on TypeScript
      // meanwhile and has a crowd stays there).
      if (stopped || respawning) return;
      respawning = Promise.resolve().then(respawn).then(
        (next) => {
          respawning = null;
          if (stopped) {
            next.worker.terminate();
            return;
          }
          status.workers++;
          catalogs = next.catalogs;
          adoptWorker(next.worker);
          follow(app.sim);
        },
        (e: unknown) => {
          respawning = null;
          noteError(`could not restart the engine worker: ${e instanceof Error ? e.message : String(e)}`);
        },
      );
      return;
    }
    try {
      host = attachWorkerHost(sim, {
        gen: ++gen,
        catalogs,
        send: (msg, transfer) => w.postMessage(msg, transfer ?? []),
        onFatal: (message) => kill(`tower ${status.starts}: ${message}`),
        onError: (message) => noteError(`tower ${status.starts}: ${message}`),
      });
      status.starts++;
      status.hosted = true;
      log.info(`[wasm-worker] tower ${status.starts} runs on the WASM engine in a worker`);
    } catch (e) {
      noteError(`not hosting this tower: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  follow(app.sim);

  // Anything below that throws lets the tower and the worker go first, so a
  // failed start never leaves the sim hooked to a host nobody holds.
  try {
    return finishStart();
  } catch (e) {
    release();
    (worker as EngineWorkerLike | null)?.terminate();
    worker = null;
    throw e;
  }

  function finishStart(): WorkerHostHandle {
  const adopt = app.adoptSim;
  const ownAdopt = Object.getOwnPropertyDescriptor(app, "adoptSim");
  const wrappedAdopt = function (this: WasmHostApp, sim: Simulation, preserveHistory?: boolean): void {
    if (sim === app.sim) return adopt.call(this, sim, preserveHistory);
    release();
    try {
      adopt.call(this, sim, preserveHistory);
    } finally {
      if (!stopped) follow(app.sim);
    }
  };
  Object.defineProperty(app, "adoptSim", { value: wrappedAdopt, configurable: true, writable: true });

  const handle: WorkerHostHandle = {
    status,
    current: () => host,
    settle: () => host?.settle() ?? Promise.resolve(),
    stop() {
      stopped = true;
      release();
      const w = worker;
      worker = null;
      w?.terminate();
      if (ownAdopt) Object.defineProperty(app, "adoptSim", ownAdopt);
      else delete (app as Partial<WasmHostApp>).adoptSim;
      const g = globalThis as unknown as { __vcEngine?: WorkerHostHandle };
      if (g.__vcEngine === handle) delete g.__vcEngine;
    },
  };
  (globalThis as unknown as { __vcEngine?: WorkerHostHandle }).__vcEngine = handle;
  return handle;
  }
}
