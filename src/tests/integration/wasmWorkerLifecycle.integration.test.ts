import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { startWorkerHost, spawnEngineWorker, type WorkerHostHandle } from "../../wasmhost/workerController";
import type { WasmHostApp } from "../../wasmhost/startWasmHost";
import { stepGate, settleEngine } from "../../wasmhost/stepGate";
import { activeEngine, engineSuffix } from "../../wasmhost/engineLabel";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { buildScenarios } from "../perfCompare/scenarios";
import { drain, spawned, testWorker, until, type TestWorker } from "../wasmWorker/channel";
import { script, type Hosted } from "../wasmWorker/hostDriver";

/**
 * The worker host's lifecycle on the real package: start, follow every
 * adopted tower in one worker, fall back to the TypeScript engine on a
 * crash or a refused reply, start a fresh worker for the next tower, and
 * let go of everything on stop, many times over without leaking engines.
 */

const quiet = { info: () => {}, error: () => {} };

function app(sim: Simulation): WasmHostApp {
  const a: WasmHostApp = {
    sim,
    adoptSim(next) {
      a.sim = next;
    },
  };
  return a;
}

/** The handle as a driver for `script`. */
function driven(handle: WorkerHostHandle, a: WasmHostApp): Hosted {
  return {
    kind: "worker",
    sim: a.sim,
    sync: async () => {
      stepGate(a.sim)?.flush();
      await until(() => !stepGate(a.sim) || stepGate(a.sim)!.canStep(), "the reply");
    },
    exactSave: async () => {
      await handle.settle();
      return a.sim.serialize();
    },
    detach: () => handle.stop(),
  };
}

const save = () => buildScenarios()[0].save;

describe.skipIf(!hasWasmPackage())("worker host lifecycle", () => {
  it("starts through the ready handshake and publishes its handle and label", async () => {
    const workers: TestWorker[] = [];
    const first = await spawnEngineWorker(() => { const w = testWorker(wasm()); workers.push(w); return w; }, "pkg://engine");
    expect(workers[0].sent[0]).toEqual({ type: "init", url: "pkg://engine" });
    const a = app(Simulation.deserialize(JSON.parse(save())));
    const handle = startWorkerHost(a, first, () => Promise.reject(new Error("unused")), quiet);
    expect((globalThis as { __vcEngine?: unknown }).__vcEngine).toBe(handle);
    expect(handle.status).toMatchObject({ engine: "wasm", placement: "worker", hosted: true, starts: 1 });
    expect(activeEngine()).toBe("wasm");
    expect(engineSuffix()).toBe(" · WASM engine (worker)");
    await until(() => handle.current()!.loaded(), "load");
    handle.stop();
    expect((globalThis as { __vcEngine?: unknown }).__vcEngine).toBeUndefined();
    expect(workers[0].terminated).toBe(true);
    expect(stepGate(a.sim)).toBeUndefined();
  });

  it("refuses a worker that never answers, or answers with an error", async () => {
    const silent = { postMessage: () => {}, onmessage: null, onerror: null, terminate: vi.fn() };
    await expect(spawnEngineWorker(() => silent, "x", 20)).rejects.toThrow(/did not answer/);
    expect(silent.terminate).toHaveBeenCalled();
    const broken: { postMessage: () => void; onmessage: ((e: { data: unknown }) => void) | null; onerror: null; terminate: () => void } = {
      postMessage: () => queueMicrotask(() => broken.onmessage?.({ data: { type: "error", message: "no package" } })),
      onmessage: null, onerror: null, terminate: vi.fn(),
    };
    await expect(spawnEngineWorker(() => broken as never, "x")).rejects.toThrow(/no package/);
  });

  it("follows adopted towers in one worker, freeing each engine it lets go", async () => {
    const first = spawned(wasm());
    const a = app(Simulation.deserialize(JSON.parse(save())));
    const handle = startWorkerHost(a, first, () => Promise.reject(new Error("unused")), quiet);
    for (let i = 0; i < 25; i++) {
      await until(() => handle.current()?.loaded() ?? false, "load");
      a.sim.tick(2);
      stepGate(a.sim)!.flush();
      await drain();
      a.adoptSim(Simulation.deserialize(JSON.parse(save())));
    }
    await until(() => handle.current()?.loaded() ?? false, "load");
    const frees = first.worker.sent.filter((m) => m.type === "free").length;
    const loads = first.worker.sent.filter((m) => m.type === "load").length;
    expect(loads).toBe(26);
    expect(frees).toBe(25);
    expect(handle.status.starts).toBe(26);
    expect(handle.status.errors).toEqual([]);
    // Replies for an older tower are ignored: every one the current host saw is its own.
    handle.stop();
  }, 120_000);

  it("falls back to the TypeScript engine on a crash, and a fresh worker hosts the next tower", async () => {
    const first = spawned(wasm());
    const second = spawned(wasm());
    let respawns = 0;
    const a = app(Simulation.deserialize(JSON.parse(save())));
    const handle = startWorkerHost(a, first, async () => { respawns++; return second; }, quiet);
    await script(driven(handle, a), 16);
    const old = a.sim;
    first.worker.crash("boom");
    expect(first.worker.terminated).toBe(true);
    expect(handle.status.hosted).toBe(false);
    expect(handle.status.errors.join()).toMatch(/crashed: boom/);
    // The tower runs on the TypeScript engine again: its own tick moves it.
    expect(stepGate(old)).toBeUndefined();
    const m = old.clock.minutes;
    old.tick(5);
    expect(old.clock.minutes).toBe(m + 5);
    a.adoptSim(Simulation.deserialize(JSON.parse(save())));
    await until(() => handle.current()?.loaded() ?? false, "the fresh worker to load");
    expect(respawns).toBe(1);
    expect(handle.status).toMatchObject({ hosted: true, workers: 2, starts: 2 });
    await script(driven(handle, a), 8);
    handle.stop();
    expect(second.worker.terminated).toBe(true);
  }, 120_000);

  it("falls back on a reply it cannot apply, and reports an op the engine refused without letting go", async () => {
    const first = spawned(wasm());
    const a = app(Simulation.deserialize(JSON.parse(save())));
    const handle = startWorkerHost(a, first, () => Promise.reject(new Error("no restart")), quiet);
    await until(() => handle.current()!.loaded(), "load");
    const h = handle.current()!;
    h.receive({ type: "error", gen: h.gen, seq: 3, message: "refused" });
    expect(handle.status.hosted).toBe(true);
    expect(handle.status.errors.join()).toMatch(/op 3: refused/);
    // A malformed frame view is fatal: the tower goes back to TypeScript.
    h.receive({ type: "frame", gen: h.gen, req: 1, seq: 0, view: new Float64Array(3), events: "[]", dropped: 0, log: null, pending: null, merge: null, workMs: { ops: 0, reply: 0 }, memoryBytes: null });
    expect(handle.status.hosted).toBe(false);
    expect(handle.status.errors.join()).toMatch(/frame view: 3 numbers/);
    // The restart fails: reported, the tower stays on TypeScript.
    a.adoptSim(Simulation.deserialize(JSON.parse(save())));
    await drain();
    expect(handle.status.hosted).toBe(false);
    expect(handle.status.errors.join()).toMatch(/could not restart the engine worker: no restart/);
    handle.stop();
  }, 60_000);

  it("a refused load falls back before any step runs", async () => {
    const first = spawned(wasm());
    const a = app(Simulation.deserialize(JSON.parse(save())));
    // Corrupt the load in flight: the engine refuses the save.
    const post = first.worker.postMessage.bind(first.worker);
    first.worker.postMessage = (msg, t) => post(msg.type === "load" ? { ...msg, save: "{not json" } : msg, t);
    const handle = startWorkerHost(a, first, () => Promise.reject(new Error("no restart")), quiet);
    expect(stepGate(a.sim)!.canStep(), "no steps before the engine has the tower").toBe(false);
    await until(() => !handle.status.hosted, "the fallback");
    expect(handle.status.errors.join()).toMatch(/load:/);
    handle.stop();
  }, 60_000);

  it("settle waits for the exact save, and settleEngine gives up after its timeout", async () => {
    const first = spawned(wasm());
    const a = app(Simulation.deserialize(JSON.parse(save())));
    const handle = startWorkerHost(a, first, () => Promise.reject(new Error("unused")), quiet);
    await script(driven(handle, a), 12);
    a.sim.money = 77;
    await settleEngine(a.sim);
    expect((a.sim.serialize() as { money: number }).money).toBe(77);
    // A worker that stops answering: the save goes ahead with the read model.
    first.worker.onmessage = null;
    a.sim.money = 78;
    const t0 = Date.now();
    await settleEngine(a.sim, 50);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((a.sim.serialize() as { money: number }).money).toBe(78);
    handle.stop();
  }, 60_000);
});
