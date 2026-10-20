import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { EngineWorkerCore } from "./workerCore";
import { spawnEngineWorker, startWorkerHost, type EngineWorkerLike, type SpawnedWorker } from "./workerController";
import type { WasmHostApp } from "./startWasmHost";
import { settleEngine, stepGate, setStepGate, SETTLE_TIMEOUT_MS } from "./stepGate";
import type { FromWorker, ToWorker } from "./workerProtocol";
import { fakeModule } from "./fakeEngine.fixture";
import { EngineBootError } from "./engineBoot";

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

/** A worker stand-in around a core on the fake engine, async both ways. */
function fakeWorker(): EngineWorkerLike & { sent: ToWorker[]; terminated: boolean } {
  const core = new EngineWorkerCore(fakeModule(), (msg) => setTimeout(() => !w.terminated && w.onmessage?.({ data: structuredClone(msg) }), 0));
  const w: EngineWorkerLike & { sent: ToWorker[]; terminated: boolean } = {
    sent: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      w.sent.push(msg);
      const copy = structuredClone(msg);
      setTimeout(() => {
        if (w.terminated) return;
        if (copy.type === "init") w.onmessage?.({ data: { type: "ready", catalogs: core.catalogs() } satisfies FromWorker });
        else core.handle(copy);
      }, 0);
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

const tasks = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const quiet = { info: vi.fn(), error: vi.fn() };

function app(): WasmHostApp {
  const a: WasmHostApp = { sim: Simulation.newGame(3, "classic"), adoptSim(sim) { a.sim = sim; } };
  return a;
}

describe("worker controller (fake engine)", () => {
  it("spawns through the ready handshake, hosts, follows adopts and stops", async () => {
    const first = await spawnEngineWorker(fakeWorker, "u");
    const a = app();
    const h = startWorkerHost(a, first, () => spawnEngineWorker(fakeWorker, "u"), quiet);
    expect(h.status).toMatchObject({ hosted: true, starts: 1, placement: "worker" });
    await tasks();
    expect(h.current()?.loaded()).toBe(true);
    a.adoptSim(a.sim); // the tower already held keeps its host
    expect(h.status.starts).toBe(1);
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(h.status.starts).toBe(2);
    await h.settle();
    h.stop();
    expect((first.worker as ReturnType<typeof fakeWorker>).terminated).toBe(true);
    await h.settle();
  });

  it("falls back on a crash and restarts on the next tower; a stop during the restart wins", async () => {
    const first = await spawnEngineWorker(fakeWorker, "u");
    const a = app();
    let resolveNext: (w: SpawnedWorker) => void = () => {};
    let respawns = 0;
    const h = startWorkerHost(a, first, () => { respawns++; return new Promise((r) => { resolveNext = r; }); }, quiet);
    first.worker.onerror?.({});
    expect(h.status.hosted).toBe(false);
    expect(last(h.status.errors)).toMatch(/crashed: unknown error/);
    a.adoptSim(Simulation.newGame(5, "classic"));
    a.adoptSim(Simulation.newGame(6, "classic")); // a second adopt while restarting waits for the same one
    const next = await spawnEngineWorker(fakeWorker, "u");
    resolveNext(next);
    await tasks();
    expect(h.status).toMatchObject({ hosted: true, workers: 2 });
    expect(respawns, "one restart for both adopts").toBe(1);
    h.stop();
    // A restart that finishes after a stop terminates its worker.
    const b = app();
    let late: (w: SpawnedWorker) => void = () => {};
    const h2 = startWorkerHost(b, await spawnEngineWorker(fakeWorker, "u"), () => new Promise((r) => { late = r; }), quiet);
    h2.current()!.receive({ type: "error", fatal: true, message: "gone" });
    b.adoptSim(Simulation.newGame(8, "classic"));
    h2.stop();
    const orphan = await spawnEngineWorker(fakeWorker, "u");
    late(orphan);
    await tasks();
    expect((orphan.worker as ReturnType<typeof fakeWorker>).terminated).toBe(true);
  });

  it("reports a tower it cannot host and keeps it on TypeScript", async () => {
    const a = app();
    a.sim.crowd.people.push({ id: 1 } as never);
    const h = startWorkerHost(a, await spawnEngineWorker(fakeWorker, "u"), () => Promise.reject(new Error("x")), quiet);
    expect(h.status.hosted).toBe(false);
    expect(last(h.status.errors)).toMatch(/not hosting this tower/);
    h.stop();
  });

  it("refuses a worker that crashes while starting", async () => {
    const w = fakeWorker();
    const crashing = () => { setTimeout(() => w.onerror?.({ message: "no module" }), 0); return w; };
    await expect(spawnEngineWorker(crashing, "u")).rejects.toThrow(/failed to start: no module/);
    await expect(spawnEngineWorker(crashing, "u")).rejects.not.toBeInstanceOf(EngineBootError);
  });

  it("codes a worker that never answers ready as a boot timeout", async () => {
    const silent: EngineWorkerLike = { onmessage: null, onerror: null, postMessage() {}, terminate: vi.fn() };
    const err = await spawnEngineWorker(() => silent, "u", 5).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineBootError);
    expect(err).toMatchObject({ reason: "boot-timeout", message: "the engine worker did not answer within 5 ms" });
    expect(silent.terminate).toHaveBeenCalled();
  });
});

describe("settleEngine", () => {
  it("resolves at once without a gate, waits for a gate, and gives up at the timeout", async () => {
    const sim = {};
    await settleEngine(sim);
    setStepGate(sim, { canStep: () => true, flush: () => {}, settle: () => new Promise<void>(() => {}) });
    expect(stepGate(sim)).toBeDefined();
    const t0 = Date.now();
    await settleEngine(sim, 5); // a gate that never settles: the timeout ends it
    expect(Date.now() - t0).toBeLessThan(1000);
    setStepGate(sim, { canStep: () => true, flush: () => {}, settle: () => Promise.reject(new Error("no")) });
    await expect(settleEngine(sim)).resolves.toBeUndefined(); // never rejects
    expect(SETTLE_TIMEOUT_MS).toBeGreaterThan(0);
    setStepGate(sim, null);
    expect(stepGate(sim)).toBeUndefined();
  });
});
