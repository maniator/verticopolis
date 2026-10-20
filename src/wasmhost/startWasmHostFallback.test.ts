import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { catalogFor } from "../engine/catalog";
import { EngineBootError } from "./engineBoot";
import { EMPTY_WASM, wasmFetch } from "./engineLoad.fixture";
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
    expect(onFallback).toHaveBeenCalledWith({ reason: "attach-refused", stage: "start" });
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
    expect(onFallback).toHaveBeenCalledWith({ reason: "package-mismatch", stage: "start" });
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

describe("loadWasmEngine", () => {
  it("codes a package that lacks what this shell calls as a package mismatch", async () => {
    // A data URL module that loads and initializes but exports no Engine.
    const url = `data:text/javascript,${encodeURIComponent("export default async function init() {}")}`;
    // The bytes path: this file runs in a DOM environment whose Response is not the engine's own.
    vi.stubGlobal("fetch", wasmFetch(EMPTY_WASM, { type: "application/octet-stream" }));
    const err = await loadWasmEngine(url, { wasmUrl: "http://x/e.wasm" }).catch((e: unknown) => e);
    vi.unstubAllGlobals();
    expect(err).toBeInstanceOf(EngineBootError);
    expect(err).toMatchObject({ reason: "package-mismatch", message: expect.stringContaining("no Engine class") });
  });
});
