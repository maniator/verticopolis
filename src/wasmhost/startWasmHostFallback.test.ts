import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { catalogFor } from "../engine/catalog";
import { EngineBootError } from "./engineBoot";
import { EMPTY_WASM, wasmFetch } from "./engineLoad.fixture";
import { attachMirror } from "../dualrun/mirror";
import { fakeModule } from "./fakeEngine.fixture";
import { loadWasmEngine, startWasmHost, type HostFallback, type WasmHostApp } from "./startWasmHost";

/**
 * The fallback codes the host records (`WasmHostStatus.fallbacks` and
 * `lastFallback`) and hands to `onFallback`, which the reliability instrument
 * reports (`engine_status`, issue #1081). Its own file beside
 * `startWasmHost.test.ts`, which the WASM test-parity work is editing.
 */

/** A tower the host refuses: it already has a crowd. */
function crowded(seed = 6): Simulation {
  const sim = Simulation.newGame(seed, "classic");
  sim.crowd.people.push({ id: 1, seed: 1, state: "toDest", floor: 1, fy: 0, x: 170, floors: [], originFloor: 1, shafts: [], leg: 0, shaftId: null, carIndex: null, destX: 170, wait: 0, tripWait: 0, age: 0, linger: 0 });
  return sim;
}

/** An app whose adopt takes an undo restore's `preserveHistory` flag. */
function app(first = Simulation.newGame(3, "classic")): WasmHostApp {
  return {
    sim: first,
    adoptSim(sim: Simulation) {
      sim.gameplayEvents.inherit(this.sim.gameplayEvents);
      this.sim = sim;
    },
  };
}

const quiet = () => ({ info: vi.fn(), error: vi.fn() });

describe("startWasmHost fallback codes", () => {
  afterEach(() => {
    const g = globalThis as { __vcEngine?: { stop(): void } };
    g.__vcEngine?.stop();
  });

  it("counts every tower it would not take, with the stage it happened at, and reports each one", () => {
    const seen: HostFallback[] = [];
    const a = app();
    const handle = startWasmHost(a, fakeModule(), quiet(), { onFallback: (f) => seen.push({ ...f }) });
    expect(handle.status).toMatchObject({ hosted: true, fallbacks: 0, lastFallback: null });

    a.adoptSim(crowded());
    expect(handle.status).toMatchObject({ hosted: false, fallbacks: 1, lastFallback: { reason: "attach-refused", stage: "adopt" } });
    a.adoptSim(crowded(7), true); // an undo or redo restore
    expect(handle.status).toMatchObject({ fallbacks: 2, lastFallback: { reason: "attach-refused", stage: "undo" } });
    // A tower it can take is hosted again; the count stays.
    a.adoptSim(Simulation.newGame(8, "classic"));
    expect(handle.status).toMatchObject({ hosted: true, fallbacks: 2 });

    expect(seen).toEqual([
      { reason: "attach-refused", stage: "adopt" },
      { reason: "attach-refused", stage: "undo" },
    ]);
    // Codes only: the message stays in the errors and the log.
    expect(JSON.stringify(handle.status.lastFallback)).not.toMatch(/crowd/);
    expect(handle.status.errors.every((e) => /crowd/.test(e))).toBe(true);
  });

  it("reports a refused first tower as a fallback at the start", () => {
    const onFallback = vi.fn();
    const handle = startWasmHost(app(crowded()), fakeModule(), quiet(), { onFallback });
    expect(handle.status).toMatchObject({ hosted: false, fallbacks: 1, lastFallback: { reason: "attach-refused", stage: "start" } });
    expect(onFallback).toHaveBeenCalledWith({ reason: "attach-refused", stage: "start" }, false);
  });

  it("keeps the adopt going when the report throws, and logs it", () => {
    const log = quiet();
    const a = app();
    const handle = startWasmHost(a, fakeModule(), log, {
      onFallback: () => {
        throw new Error("analytics is down");
      },
    });
    const next = crowded();
    expect(() => a.adoptSim(next)).not.toThrow();
    expect(a.sim).toBe(next);
    expect(handle.status.fallbacks).toBe(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("reporting the fallback failed: analytics is down"));
  });

  it("reports before stopping a wasm-only game, so the stop is counted too", () => {
    const order: string[] = [];
    const a = app();
    startWasmHost(a, fakeModule(), quiet(), { strict: true, onFatal: (_m, reason) => order.push(`fatal ${reason}`), onFallback: (f) => order.push(`fallback ${f.stage}`) });
    a.adoptSim(crowded());
    expect(order).toEqual(["fallback adopt", "fatal attach-refused"]);
  });

  it("codes a package whose catalog this build cannot draw as a package mismatch", () => {
    // A shell and an engine from different deploys: the engine lists a kind
    // this build has never heard of, so every tower is refused (#1046).
    const mod = fakeModule();
    mod.catalog = (mode: string) => {
      const c = catalogFor(mode as "classic" | "modern");
      return JSON.stringify({ ...c, facilities: [...c.facilities, { ...c.facilities[0], key: "skyBridge" }] });
    };
    const onFallback = vi.fn();
    const onFatal = vi.fn();
    const handle = startWasmHost(app(), mod, quiet(), { strict: true, onFallback, onFatal });
    expect(handle.status).toMatchObject({ hosted: false, fallbacks: 1, lastFallback: { reason: "package-mismatch", stage: "start" } });
    expect(onFallback).toHaveBeenCalledWith({ reason: "package-mismatch", stage: "start" }, false);
    expect(onFatal).toHaveBeenCalledWith(expect.stringContaining("skyBridge"), "package-mismatch");
  });

  it("codes a catalog of another version as a package mismatch", () => {
    const mod = fakeModule();
    mod.catalog = (mode: string) => JSON.stringify({ ...catalogFor(mode as "classic" | "modern"), version: 999 });
    const handle = startWasmHost(app(), mod, quiet());
    expect(handle.status.lastFallback).toEqual({ reason: "package-mismatch", stage: "start" });
  });

  it("keeps an engine whose catalog call fails on attach-refused, and asks again at the next refusal", () => {
    // An engine that cannot answer is failing on its own; that is a fault to
    // count, never a deploy race to set aside.
    const mod = fakeModule();
    let answer: (mode: string) => string = () => {
      throw new Error("unreachable executed");
    };
    mod.catalog = (mode: string) => answer(mode);
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    expect(handle.status.lastFallback).toEqual({ reason: "attach-refused", stage: "start" });
    answer = () => "not json";
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(handle.status.lastFallback).toEqual({ reason: "attach-refused", stage: "adopt" });
    answer = (mode) => JSON.stringify({ ...catalogFor(mode as "classic" | "modern"), version: 999 });
    a.adoptSim(Simulation.newGame(5, "classic"));
    expect(handle.status.lastFallback).toEqual({ reason: "package-mismatch", stage: "adopt" });
  });
});

/** A fake module that records every call into it, whose next engine load
 *  throws `failNext`'s error, and whose catalog call number `trapCatalogAt`
 *  traps. */
function counted() {
  const mod = fakeModule();
  const calls: string[] = [];
  let next: unknown = null;
  let catalogTrap = 0;
  const fromSave = mod.Engine.fromSave.bind(mod.Engine);
  const catalog = mod.catalog!.bind(mod);
  mod.catalog = (mode: string) => {
    calls.push("catalog");
    if (calls.filter((c) => c === "catalog").length === catalogTrap) throw new WebAssembly.RuntimeError("unreachable");
    return catalog(mode);
  };
  mod.Engine = {
    fromSave(save: string, markers?: string) {
      calls.push("fromSave");
      if (next !== null) {
        const error = next;
        next = null;
        throw error;
      }
      return fromSave(save, markers);
    },
  } as unknown as typeof mod.Engine;
  return Object.assign(mod, { calls, failNext: (error: unknown) => void (next = error), trapCatalogAt: (n: number) => void (catalogTrap = n) });
}

describe("a trap while a tower attaches (#1113)", () => {
  afterEach(() => {
    const g = globalThis as { __vcEngine?: { stop(): void } };
    g.__vcEngine?.stop();
  });

  it("latches hosting off when a later tower's engine load traps, and calls the module no more", () => {
    const mod = counted();
    const a = app();
    const seen: unknown[] = [];
    const handle = startWasmHost(a, mod, quiet(), { onFallback: (f, latched) => seen.push({ ...f, latched }) });
    expect(handle.status).toMatchObject({ hosted: true, latched: false });
    mod.failNext(new WebAssembly.RuntimeError("unreachable"));
    a.adoptSim(Simulation.newGame(4, "classic"));
    const trapped = mod.calls.length;
    expect(mod.calls[trapped - 1]).toBe("fromSave");
    expect(handle.status).toMatchObject({ hosted: false, latched: true, starts: 1, fallbacks: 1, lastFallback: { reason: "attach-refused", stage: "adopt" } });
    expect(handle.status.lastError).toBe("not hosting this tower or any later one, since the WASM engine trapped: unreachable");
    expect(seen).toEqual([{ reason: "attach-refused", stage: "adopt", latched: true }]);
    expect(mod.engines[0].freed).toBe(true); // the first tower's, let go before
    // A load, an undo and a stop: none asks the module again.
    a.adoptSim(Simulation.newGame(5, "classic"));
    a.adoptSim(Simulation.newGame(6, "classic"), true);
    expect(handle.status).toMatchObject({ hosted: false, starts: 1, fallbacks: 1 });
    expect(handle.current()).toBeNull();
    handle.stop();
    expect(mod.calls).toHaveLength(trapped);
  });

  it("latches at the start on a first tower's trap, without the catalog check behind a refusal", () => {
    const mod = counted();
    mod.failNext(new WebAssembly.RuntimeError("unreachable"));
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    expect(mod.calls).toEqual(["catalog", "catalog", "fromSave"]);
    expect(handle.status).toMatchObject({ hosted: false, latched: true, starts: 0, lastFallback: { reason: "attach-refused", stage: "start" } });
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(mod.calls).toHaveLength(3);
  });

  it.each([
    ["the borrow error a trap leaves", new Error("recursive use of an object detected which would lead to unsafe aliasing in rust")],
    ["a stack overflow", new RangeError("Maximum call stack size exceeded")],
    ["another realm's RuntimeError", Object.assign(new Error("unreachable executed"), { name: "RuntimeError" })],
  ])("latches on %s", (_name, error) => {
    const mod = counted();
    mod.failNext(error);
    const handle = startWasmHost(app(), mod, quiet());
    expect(handle.status).toMatchObject({ hosted: false, latched: true });
  });

  it("keeps the engine's clean refusal a refusal, so the next tower is hosted", () => {
    const mod = counted();
    mod.failNext(new Error("unknown mode: tower")); // the engine's Result::Err
    const onFallback = vi.fn();
    const a = app();
    const handle = startWasmHost(a, mod, quiet(), { onFallback });
    expect(handle.status).toMatchObject({ hosted: false, latched: false, lastFallback: { reason: "attach-refused", stage: "start" } });
    expect(onFallback).toHaveBeenCalledWith({ reason: "attach-refused", stage: "start" }, false);
    // A refusal asks the catalogs again, to tell a foreign package apart.
    expect(mod.calls).toEqual(["catalog", "catalog", "fromSave", "catalog", "catalog"]);
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(handle.status).toMatchObject({ hosted: true, starts: 1 });
  });

  it("frees the engine a refusal built, and leaves one that trapped alone", () => {
    const mod = fakeModule();
    const fromSave = mod.Engine.fromSave.bind(mod.Engine);
    let error: unknown = new Error("a frame the host cannot read");
    mod.Engine = {
      fromSave(save: string, markers?: string) {
        const engine = fromSave(save, markers);
        mod.engines[mod.engines.length - 1].frameView = () => {
          throw error;
        };
        return engine;
      },
    } as unknown as typeof mod.Engine;
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    expect(handle.status).toMatchObject({ hosted: false, latched: false });
    expect(mod.engines[0].freed).toBe(true);
    error = new WebAssembly.RuntimeError("unreachable");
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(handle.status).toMatchObject({ hosted: false, latched: true });
    // A free would call into the module; the engine is taken off the
    // finalizer instead.
    expect(mod.engines[1]).toMatchObject({ freed: false, abandoned: true });
  });

  it("latches on a trap in the attach's catalog read, and calls nothing after it", () => {
    const mod = counted();
    mod.trapCatalogAt(1);
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    expect(mod.calls).toEqual(["catalog"]);
    expect(handle.status).toMatchObject({ hosted: false, latched: true, lastFallback: { reason: "attach-refused", stage: "start" } });
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(mod.calls).toEqual(["catalog"]);
  });

  it("latches when the catalog check behind a clean refusal traps, and keeps the refusal's message", () => {
    const mod = counted();
    mod.failNext(new Error("unknown mode: tower"));
    mod.trapCatalogAt(3);
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    expect(mod.calls).toEqual(["catalog", "catalog", "fromSave", "catalog"]);
    expect(handle.status).toMatchObject({ hosted: false, latched: true, fallbacks: 1, lastFallback: { reason: "attach-refused", stage: "start" } });
    expect(handle.status.errors).toEqual(["not hosting this tower: unknown mode: tower", "not hosting this tower or any later one, since the WASM engine trapped: unreachable"]);
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(mod.calls).toHaveLength(4);
  });

  /** A module whose first engine refuses its frame, then throws `freeError`
   *  from the free behind that refusal. */
  const refusingFree = (freeError: Error) => {
    const mod = fakeModule();
    const fromSave = mod.Engine.fromSave.bind(mod.Engine);
    mod.Engine = {
      fromSave(save: string, markers?: string) {
        const engine = fromSave(save, markers);
        const fake = mod.engines[mod.engines.length - 1];
        if (mod.engines.length > 1) return engine;
        fake.frameView = () => {
          throw new Error("a frame the host cannot read");
        };
        fake.free = () => {
          throw freeError;
        };
        return engine;
      },
    } as unknown as typeof mod.Engine;
    return mod;
  };

  it("latches when the free behind a refusal traps, and keeps the refusal's message", () => {
    const handle = startWasmHost(app(), refusingFree(new WebAssembly.RuntimeError("unreachable")), quiet());
    expect(handle.status).toMatchObject({ hosted: false, latched: true });
    expect(handle.status.errors).toEqual(["not hosting this tower or any later one, since the WASM engine trapped: unreachable, while freeing the engine after a refusal: a frame the host cannot read"]);
  });

  it("answers the refusal when the free behind it throws a clean error, and hosts the next tower", () => {
    const a = app();
    const handle = startWasmHost(a, refusingFree(new Error("null pointer passed to rust")), quiet());
    expect(handle.status).toMatchObject({ hosted: false, latched: false, lastError: "not hosting this tower: a frame the host cannot read" });
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(handle.status).toMatchObject({ hosted: true, latched: false, starts: 1 });
  });

  it("latches the next tower off when a healthy tower's free traps as it is let go, and ends the redo hold", () => {
    const mod = fakeModule();
    const holds: boolean[] = [];
    const a = Object.assign(app(), { holdClearedRedo: (on: boolean) => void holds.push(on) });
    const onFallback = vi.fn();
    const handle = startWasmHost(a, mod, quiet(), { onFallback });
    mod.engines[0].free = () => {
      throw new WebAssembly.RuntimeError("unreachable");
    };
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(mod.engines).toHaveLength(1);
    expect(handle.status).toMatchObject({ hosted: false, latched: true, starts: 1, lastFallback: { reason: "attach-refused", stage: "adopt" } });
    expect(onFallback).toHaveBeenCalledWith({ reason: "attach-refused", stage: "adopt" }, true);
    expect(handle.status.errors[0]).toBe("letting go of the last tower: unreachable");
    expect(holds).toEqual([true, false]);
  });

  it("hosts the next tower when a healthy tower's free throws a clean error as it is let go", () => {
    const mod = fakeModule();
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    mod.engines[0].free = () => {
      throw new Error("null pointer passed to rust");
    };
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(handle.status).toMatchObject({ hosted: true, latched: false, starts: 2, errors: ["letting go of the last tower: null pointer passed to rust"] });
  });

  // The let-go runs every step and throws one error: a trap in the free
  // wins over a clean throw before it, so the next tower is not hosted.
  it("latches the next tower off when a healthy tower's free traps behind a clean throw as it is let go", () => {
    const mod = fakeModule();
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    a.sim.gameplayEvents.restore = () => {
      throw new Error("the events do not go back");
    };
    mod.engines[0].free = () => {
      throw new WebAssembly.RuntimeError("unreachable");
    };
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(mod.engines).toHaveLength(1);
    expect(handle.status).toMatchObject({ hosted: false, latched: true });
    expect(handle.status.errors[0]).toBe("letting go of the last tower: unreachable, and the events do not go back");
  });

  // A relay already on the tower (the dual run's mirror) refuses the attach,
  // and the tower keeps its own events whatever the free behind it does.
  it.each([
    ["latches when the free traps", new WebAssembly.RuntimeError("unreachable"), true],
    ["hosts the next tower when the free throws a clean error", new Error("null pointer passed to rust"), false],
  ])("answers a relay's refusal, and %s", (_, freeError, latched) => {
    const mod = fakeModule();
    const fromSave = mod.Engine.fromSave.bind(mod.Engine);
    mod.Engine = {
      fromSave(save: string, markers?: string) {
        const engine = fromSave(save, markers);
        mod.engines[mod.engines.length - 1].free = () => {
          throw freeError;
        };
        return engine;
      },
    } as unknown as typeof mod.Engine;
    const a = app();
    const detachMirror = attachMirror(a.sim, () => {});
    const handle = startWasmHost(a, mod, quiet());
    detachMirror();
    expect(handle.status).toMatchObject({ hosted: false, latched });
    const refusal = "mirror: a mirror is already attached to this simulation";
    const lastError = latched ? `not hosting this tower or any later one, since the WASM engine trapped: unreachable, while freeing the engine after a refusal: ${refusal}` : `not hosting this tower: ${refusal}`;
    expect(handle.status.lastError).toBe(lastError);
    expect(a.sim.drainGameplayEvents()).toEqual([{ name: "tower_founded", payload: { mode: "classic" } }]);
    a.adoptSim(Simulation.newGame(4, "classic"));
    expect(handle.status.hosted).toBe(!latched);
    handle.stop();
  });

  it("stops a wasm-only build on an attach trap, with hosting off", () => {
    const mod = counted();
    mod.failNext(new WebAssembly.RuntimeError("unreachable"));
    const onFatal = vi.fn();
    const handle = startWasmHost(app(), mod, quiet(), { strict: true, onFatal });
    expect(onFatal).toHaveBeenCalledWith(expect.stringContaining("trapped: unreachable"), "attach-refused");
    expect(handle.status.latched).toBe(true);
  });
});

describe("loadWasmEngine", () => {
  it("codes a package that lacks what this shell calls as a package mismatch", async () => {
    // A data URL module that loads and initializes but exports no Engine.
    const url = `data:text/javascript,${encodeURIComponent("export default async function init() {}")}`;
    // The bytes path: this file runs in a DOM environment whose Response is not the engine's own.
    vi.stubGlobal("fetch", wasmFetch(EMPTY_WASM, { type: "application/octet-stream" }));
    const err = await loadWasmEngine(url, undefined, { wasmUrl: "http://x/e.wasm" }).catch((e: unknown) => e);
    vi.unstubAllGlobals();
    expect(err).toBeInstanceOf(EngineBootError);
    expect(err).toMatchObject({ reason: "package-mismatch", message: expect.stringContaining("no Engine class") });
  });
});
