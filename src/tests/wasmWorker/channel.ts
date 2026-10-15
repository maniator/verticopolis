import { MessageChannel } from "node:worker_threads";
import { setImmediate as tick } from "node:timers/promises";
import type { WasmModule } from "../../dualrun/binding";
import { EngineWorkerCore } from "../../wasmhost/workerCore";
import type { EngineWorkerLike, SpawnedWorker } from "../../wasmhost/workerController";
import type { FromWorker, ToWorker } from "../../wasmhost/workerProtocol";

/**
 * The engine worker in Node: the real {@link EngineWorkerCore} on the real
 * package, behind a `MessageChannel`, so every message is structured-cloned
 * and every frame buffer transferred exactly as between a page and its
 * worker, and every reply arrives in a later task. `sent` and `received`
 * record the traffic for the tests that check its order and size.
 */
export interface TestWorker extends EngineWorkerLike {
  sent: ToWorker[];
  received: FromWorker[];
  terminated: boolean;
  /** Make the worker fail as a crashed one does. */
  crash(message: string): void;
  core: EngineWorkerCore;
}

export function testWorker(mod: WasmModule): TestWorker {
  const { port1, port2 } = new MessageChannel();
  const core = new EngineWorkerCore(mod, (msg, transfer) => port2.postMessage(msg, (transfer ?? []) as never));
  const w: TestWorker = {
    sent: [],
    received: [],
    terminated: false,
    core,
    onmessage: null,
    onerror: null,
    postMessage(msg, transfer) {
      if (w.terminated) return;
      w.sent.push(msg);
      port1.postMessage(msg, (transfer ?? []) as never);
    },
    terminate() {
      w.terminated = true;
      port1.close();
      port2.close();
    },
    crash(message) {
      w.onerror?.({ message });
    },
  };
  port2.on("message", (msg: ToWorker) => {
    if (msg.type === "init") port2.postMessage({ type: "ready", catalogs: core.catalogs() } satisfies FromWorker);
    else core.handle(msg);
  });
  port1.on("message", (msg: FromWorker) => {
    if (w.terminated) return;
    w.received.push(msg);
    w.onmessage?.({ data: msg });
  });
  port1.unref();
  port2.unref();
  return w;
}

export function spawned(mod: WasmModule): SpawnedWorker & { worker: TestWorker } {
  const worker = testWorker(mod);
  return { worker, catalogs: worker.core.catalogs() };
}

/** Let queued messages flow both ways (a few task turns). */
export async function drain(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) await tick();
}

/** Wait until `done()` holds, letting messages flow, or fail by name. */
export async function until(done: () => boolean, what: string, turns = 20_000): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (done()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}
