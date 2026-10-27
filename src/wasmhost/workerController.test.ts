import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { EngineWorkerCore } from "./workerCore";
import { spawnEngineWorker, startWorkerHost, type EngineWorkerLike, type SpawnedWorker } from "./workerController";
import type { WasmHostApp } from "./startWasmHost";
import { settleEngine, stepGate, setStepGate, SETTLE_TIMEOUT_MS } from "./stepGate";
import type { FromWorker, ToWorker } from "./workerProtocol";
import { fakeModule } from "./fakeEngine.fixture";
import { EngineBootError } from "./engineBoot";
import { HOST_ERROR_HISTORY } from "./hostErrors";

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
  it("retains the latest failure once the error list is full, including after recovery", async () => {
    const a = app();
    const failedTower = (i: number) => {
      const sim = Simulation.newGame(i, "classic");
      sim.serialize = () => { throw new Error(`failure ${i}`); };
      return sim;
    };
    a.sim = failedTower(1);
    const log = { info: vi.fn(), error: vi.fn() };
    const h = startWorkerHost(a, await spawnEngineWorker(fakeWorker, "u"), () => Promise.reject(new Error("unexpected restart")), log);
    const lastFailed = HOST_ERROR_HISTORY + 1;
    try {
      for (let i = 2; i <= lastFailed; i++) a.adoptSim(failedTower(i));
      expect(h.status.errors).toHaveLength(HOST_ERROR_HISTORY);
      expect(h.status.lastError).toBe(`not hosting this tower: failure ${lastFailed}`);
      expect(h.status.droppedErrors).toBe(1);
      expect(log.error).toHaveBeenCalledTimes(lastFailed);
      a.adoptSim(Simulation.newGame(lastFailed + 1, "classic"));
      await h.settle();
      expect(h.status.hosted).toBe(true);
      a.adoptSim(failedTower(lastFailed + 2));
      expect(h.status).toMatchObject({ hosted: false, lastError: `not hosting this tower: failure ${lastFailed + 2}`, droppedErrors: 2 });
      expect(h.status.errors).toHaveLength(HOST_ERROR_HISTORY);
      expect(h.status.errors[0]).toBe("not hosting this tower: failure 1");
      expect(log.error).toHaveBeenCalledTimes(lastFailed + 1);
    } finally {
      h.stop();
    }
  });

  it("names a worker crash as the latest error even when letting go of the tower throws", async () => {
    const first = await spawnEngineWorker(fakeWorker, "u");
    const w = first.worker;
    const h = startWorkerHost(app(), first, () => Promise.reject(new Error("no restart")), quiet);
    try {
      await h.settle();
      const host = h.current()!;
      host.detach = () => {
        throw new Error("detach broke");
      };
      w.onerror?.({ message: "boom" });
      expect(h.status).toMatchObject({
        hosted: false,
        errors: ["letting go of the last tower: detach broke", "the engine worker crashed: boom"],
        lastError: "the engine worker crashed: boom",
        droppedErrors: 0,
      });
    } finally {
      h.stop();
    }
  });

  it("spawns through the ready handshake, hosts, follows adopts and stops", async () => {
    const first = await spawnEngineWorker(fakeWorker, "u");
    const a = app();
    const h = startWorkerHost(a, first, () => spawnEngineWorker(fakeWorker, "u"), quiet);
    expect(h.status).toMatchObject({ hosted: true, starts: 1, placement: "worker", errors: [], lastError: null, droppedErrors: 0 });
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

  it("stops restarting after a refused package, and keeps restarting after a failed download", async () => {
    const reasonOf = { mismatch: "package-mismatch", unverifiable: "unverifiable", "load-failed": "boot-error" } as const;
    const refusal = (kind: "mismatch" | "unverifiable" | "load-failed") =>
      new EngineBootError(reasonOf[kind], "refused", { kind, file: "wasm", expected: null, found: null, expectedPackage: null, servedPackage: null, controlled: true });
    for (const [kind, latched] of [["mismatch", true], ["unverifiable", true], ["load-failed", false]] as const) {
      const a = app();
      let respawns = 0;
      const h = startWorkerHost(a, await spawnEngineWorker(fakeWorker, "u"), () => { respawns++; return Promise.reject(refusal(kind)); }, quiet);
      h.current()!.receive({ type: "error", fatal: true, message: "gone" });
      a.adoptSim(Simulation.newGame(5, "classic"));
      await tasks();
      expect(respawns).toBe(1);
      a.adoptSim(Simulation.newGame(6, "classic"));
      await tasks();
      expect(respawns, `${kind}: a later tower ${latched ? "does not ask again" : "asks again"}`).toBe(latched ? 1 : 2);
      expect(h.status.refusal, kind).toEqual(latched ? expect.objectContaining({ kind, file: "wasm" }) : null);
      if (latched) expect(last(h.status.errors)).toMatch(new RegExp(`package ${kind}, wasm; not trying again`));
      h.stop();
    }
  });

  it("names no file in the refusal note when the package detail has none, and stays unhosted", async () => {
    const a = app();
    const detail = { kind: "mismatch", file: null, expected: null, found: null, expectedPackage: null, servedPackage: null, controlled: true } as const;
    const h = startWorkerHost(a, await spawnEngineWorker(fakeWorker, "u"), () => Promise.reject(new EngineBootError("package-mismatch", "refused", detail)), quiet);
    h.current()!.receive({ type: "error", fatal: true, message: "gone" });
    a.adoptSim(Simulation.newGame(5, "classic"));
    await tasks();
    expect(last(h.status.errors)).toMatch(/\(package mismatch; not trying again\)/);
    a.adoptSim(Simulation.newGame(6, "classic"));
    await tasks();
    expect(h.status).toMatchObject({ hosted: false, refusal: expect.objectContaining({ kind: "mismatch" }) });
    expect(h.current()).toBeNull();
    h.stop();
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

  it("keeps a refused package's kind and ids when the worker's byte check refuses it (#985)", async () => {
    const package_ = { kind: "mismatch" as const, file: "wasm" as const, expected: "aaaaaaaaaaaa", found: "bbbbbbbbbbbb", expectedPackage: "111111111111", servedPackage: "222222222222", controlled: true };
    const refusing = (kind: "mismatch" | "load-failed" | "unverifiable"): EngineWorkerLike => {
      const w = fakeWorker();
      w.postMessage = () => {
        setTimeout(() => w.onmessage?.({ data: { type: "error", fatal: true, message: "could not load the WASM engine: refused", package: { ...package_, kind } } }), 0);
      };
      return w;
    };
    const mismatch = await spawnEngineWorker(() => refusing("mismatch"), "x").catch((e: unknown) => e);
    expect(mismatch).toBeInstanceOf(EngineBootError);
    expect(mismatch).toMatchObject({ reason: "package-mismatch", package: { kind: "mismatch", servedPackage: "222222222222" } });
    const missing = await spawnEngineWorker(() => refusing("load-failed"), "x").catch((e: unknown) => e);
    expect(missing).toMatchObject({ reason: "boot-error", package: { kind: "load-failed" } });
    // The browser could not hash the files: its own code, sent by the worker or derived from the kind.
    const unverifiable = await spawnEngineWorker(() => refusing("unverifiable"), "x").catch((e: unknown) => e);
    expect(unverifiable).toMatchObject({ reason: "unverifiable", package: { kind: "unverifiable" } });
  });

  it("keeps the code a worker gave a failed load, a binding the shell cannot use included (#1086)", async () => {
    const coded = (reason: "package-mismatch" | "boot-error"): EngineWorkerLike => {
      const w = fakeWorker();
      w.postMessage = () => {
        setTimeout(() => w.onmessage?.({ data: { type: "error", fatal: true, message: "could not load the WASM engine: the WASM binding lacks Engine", reason } }), 0);
      };
      return w;
    };
    expect(await spawnEngineWorker(() => coded("package-mismatch"), "x").catch((e: unknown) => e)).toMatchObject({ reason: "package-mismatch" });
    expect(await spawnEngineWorker(() => coded("boot-error"), "x").catch((e: unknown) => e)).toMatchObject({ reason: "boot-error" });
  });

  it("ignores a code a failed load cannot carry, and rebuilds the detail from known values only", async () => {
    const reply = (data: object): EngineWorkerLike => {
      const w = fakeWorker();
      w.postMessage = () => {
        setTimeout(() => w.onmessage?.({ data: { type: "error", fatal: true, message: "could not load the WASM engine", ...data } }), 0);
      };
      return w;
    };
    // `none` would hide the failure from the fault rate; a trap code is for a running engine.
    expect(await spawnEngineWorker(() => reply({ reason: "none" }), "x").catch((e: unknown) => e)).not.toBeInstanceOf(EngineBootError);
    expect(await spawnEngineWorker(() => reply({ reason: "trap-tick" }), "x").catch((e: unknown) => e)).not.toBeInstanceOf(EngineBootError);
    const dirty = { kind: "mismatch", file: "/etc/passwd", expected: "not hex", found: "A".repeat(40), expectedPackage: "111111111111", servedPackage: null, controlled: "yes" };
    const err = (await spawnEngineWorker(() => reply({ package: dirty }), "x").catch((e: unknown) => e)) as EngineBootError;
    expect(err.reason).toBe("package-mismatch");
    expect(err.package).toEqual({ kind: "mismatch", file: null, expected: null, found: null, expectedPackage: "111111111111", servedPackage: null, controlled: false });
    // No usable kind: no detail, and no code from it.
    expect(await spawnEngineWorker(() => reply({ package: { kind: "other" } }), "x").catch((e: unknown) => e)).not.toBeInstanceOf(EngineBootError);
  });

  it("reports the page's own controlled state for a refused package, whatever the worker says (#985)", async () => {
    const refused = (controlled: boolean): EngineWorkerLike => {
      const w = fakeWorker();
      w.postMessage = () => {
        setTimeout(() => w.onmessage?.({ data: { type: "error", fatal: true, message: "refused", package: { kind: "mismatch", file: "wasm", controlled } as never } }), 0);
      };
      return w;
    };
    const controlledBy = (controller: object | null) => vi.stubGlobal("navigator", { serviceWorker: { controller } });
    try {
      controlledBy({});
      expect(await spawnEngineWorker(() => refused(false), "x").catch((e: unknown) => e)).toMatchObject({ package: { controlled: true } });
      controlledBy(null);
      expect(await spawnEngineWorker(() => refused(true), "x").catch((e: unknown) => e)).toMatchObject({ package: { controlled: false } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rebuilds the build section's account from known values only", async () => {
    const hash = "ab".repeat(32);
    const reply = (build: unknown): EngineWorkerLike => {
      const w = fakeWorker();
      w.postMessage = () => {
        setTimeout(() => w.onmessage?.({ data: { type: "error", fatal: true, message: "could not load the WASM engine", build: build as never } }), 0);
      };
      return w;
    };
    const built = async (build: unknown) => ((await spawnEngineWorker(() => reply(build), "x").catch((e: unknown) => e)) as { build?: unknown }).build;
    expect(await built({ state: "ok", sourceHash: hash, extra: "x" })).toEqual({ state: "ok", sourceHash: hash });
    expect(await built({ state: "missing" })).toEqual({ state: "missing" });
    expect(await built({ state: "malformed", why: "w".repeat(500) })).toEqual({ state: "malformed", why: "w".repeat(120) });
    expect(await built({ state: "ok", sourceHash: "not a hash" })).toBeUndefined();
    expect(await built({ state: "other" })).toBeUndefined();
  });

  it("rebuilds the build section's account on the build message and on ready too", async () => {
    const hash = "ab".repeat(32);
    const dirty = { state: "ok", sourceHash: hash, extra: "not wanted" };
    const answering = (messages: object[]): EngineWorkerLike => {
      const w = fakeWorker();
      w.postMessage = () => {
        messages.forEach((m, i) => setTimeout(() => w.onmessage?.({ data: m as never }), i));
      };
      return w;
    };
    // A build message, then a failure that carries none: the message's account is kept, cleaned.
    const failed = (await spawnEngineWorker(() => answering([{ type: "build", build: dirty }, { type: "error", fatal: true, message: "late failure" }]), "x").catch((e: unknown) => e)) as { build?: unknown };
    expect(failed.build).toEqual({ state: "ok", sourceHash: hash });
    // A ready that carries a dirty account: only the known values reach the caller.
    const catalogs = { classic: "{}", modern: "{}" };
    const spawned = await spawnEngineWorker(() => answering([{ type: "ready", catalogs, build: dirty }]), "x");
    expect(spawned.build).toEqual({ state: "ok", sourceHash: hash });
    const bad = await spawnEngineWorker(() => answering([{ type: "ready", catalogs, build: { state: "ok", sourceHash: "short" } }]), "x");
    expect(bad.build).toBeUndefined();
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

describe("spawnEngineWorker, engine identity (#963)", () => {
  const readyWorker = (identity: string | undefined): EngineWorkerLike => {
    const w: EngineWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage() {
        setTimeout(() => w.onmessage?.({ data: { type: "ready", catalogs: { classic: "c", modern: "m" }, ...(identity === undefined ? {} : { identity }) } satisfies FromWorker }), 0);
      },
      terminate() {},
    };
    return w;
  };

  it("hands the worker's identity record to the caller", async () => {
    const spawned = await spawnEngineWorker(() => readyWorker('{"schema":1}'), "u");
    expect(spawned.identity).toBe('{"schema":1}');
  });

  it("leaves it undefined for a worker whose package has no such call", async () => {
    const spawned = await spawnEngineWorker(() => readyWorker(undefined), "u");
    expect(spawned.identity).toBeUndefined();
  });
});

describe("spawnEngineWorker, the engine binary's build metadata (#963)", () => {
  const answering = (reply: FromWorker): EngineWorkerLike => {
    const w: EngineWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage() {
        setTimeout(() => w.onmessage?.({ data: reply }), 0);
      },
      terminate() {},
    };
    return w;
  };
  const ok = { state: "ok", sourceHash: "a".repeat(64) } as const;

  it("hands the worker's read of the section to the caller", async () => {
    const reply: FromWorker = { type: "ready", catalogs: { classic: "c", modern: "m" }, build: ok };
    expect((await spawnEngineWorker(() => answering(reply), "u")).build).toEqual(ok);
  });

  it("leaves it undefined for a worker that did not say", async () => {
    const reply: FromWorker = { type: "ready", catalogs: { classic: "c", modern: "m" } };
    expect((await spawnEngineWorker(() => answering(reply), "u")).build).toBeUndefined();
  });

  it("carries it on the rejection of a load that failed after the binary compiled", async () => {
    const err = await spawnEngineWorker(() => answering({ type: "error", fatal: true, message: "link failed", build: ok }), "u").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ message: "link failed", build: ok });
  });

  it("adds no build to a rejection that has none", async () => {
    const err = await spawnEngineWorker(() => answering({ type: "error", fatal: true, message: "404" }), "u").catch((e: unknown) => e);
    expect("build" in (err as object)).toBe(false);
  });

  /** A worker that reports the binary's build, then does `then`. */
  const reporting = (then: (w: EngineWorkerLike) => void): EngineWorkerLike => {
    const w: EngineWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage() {
        setTimeout(() => {
          w.onmessage?.({ data: { type: "build", build: ok } });
          then(w);
        }, 0);
      },
      terminate() {},
    };
    return w;
  };

  it("keeps the build a worker reported when it then never answers", async () => {
    const err = await spawnEngineWorker(() => reporting(() => undefined), "u", 20).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineBootError);
    expect(err).toMatchObject({ reason: "boot-timeout", build: ok });
  });

  it("keeps the build a worker reported when it then fails to start", async () => {
    const err = await spawnEngineWorker(() => reporting((w) => w.onerror?.({ message: "boom" } as ErrorEvent)), "u").catch((e: unknown) => e);
    expect(err).toMatchObject({ build: ok });
  });

  it("prefers the build an error reply carries over the one reported earlier", async () => {
    const other = { state: "missing" } as const;
    const err = await spawnEngineWorker(() => reporting((w) => w.onmessage?.({ data: { type: "error", fatal: true, message: "x", build: other } })), "u").catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ build: other });
  });
});
