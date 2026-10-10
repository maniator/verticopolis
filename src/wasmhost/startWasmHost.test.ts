import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { WasmEngine, WasmModule } from "../dualrun/binding";
import { FRAME_HEADER } from "./frameView";
import { enginePackageUrl, startWasmHost, type WasmHostApp } from "./startWasmHost";

/** An engine stand-in: holds the save it was built from, answers a frame
 *  view that says nothing moved, and counts its ticks. */
class FakeEngine {
  ticks = 0;
  freed = false;
  constructor(private readonly save: string) {}
  frameView(): Float64Array {
    const v = new Float64Array(FRAME_HEADER);
    const data = JSON.parse(this.save) as { minutes: number; money: number; star: number };
    v[0] = data.minutes;
    v[4] = data.money;
    v[5] = data.star;
    return v;
  }
  serialize(): string { return this.save; }
  tick(): void { this.ticks++; }
  free(): void { this.freed = true; }
  pendingChoice(): string | undefined { return undefined; }
  logSince(): string { return "[]"; }
  /** What the engine still owes: handed over once, then empty. */
  owed: unknown[] = [];
  drainGameplayEvents(): string {
    const out = JSON.stringify(this.owed);
    this.owed = [];
    return out;
  }
  /** The engine's own ring drops. */
  dropped = 0;
  gameplayEventsDropped(): number { return this.dropped; }
}

function fakeModule(): WasmModule & { engines: FakeEngine[] } {
  const engines: FakeEngine[] = [];
  const Engine = {
    fromSave(save: string) {
      const e = new FakeEngine(save);
      engines.push(e);
      return e as unknown as WasmEngine;
    },
  };
  return { Engine: Engine as unknown as WasmModule["Engine"], engines };
}

function app(): WasmHostApp & { adopted: Simulation[] } {
  const a = {
    sim: Simulation.newGame(3, "classic"),
    adopted: [] as Simulation[],
    adoptSim(sim: Simulation) {
      sim.gameplayEvents.inherit(this.sim.gameplayEvents); // as GameApp.adoptSim does
      this.sim = sim;
      this.adopted.push(sim);
    },
  };
  return a;
}

const quiet = () => ({ info: vi.fn(), error: vi.fn() });

describe("startWasmHost", () => {
  it("hosts the current tower and every adopted one, and publishes its status", () => {
    const mod = fakeModule();
    const a = app();
    const log = quiet();
    const handle = startWasmHost(a, mod, log);
    expect(handle.status).toMatchObject({ engine: "wasm", starts: 1, hosted: true, errors: [] });
    expect(mod.engines.length).toBe(1);
    expect((globalThis as { __vcEngine?: unknown }).__vcEngine).toBe(handle);
    a.sim.tick(1);
    expect(mod.engines[0].ticks).toBe(1);

    const next = Simulation.newGame(4, "modern");
    a.adoptSim(next);
    expect(a.adopted).toEqual([next]);
    expect(handle.status.starts).toBe(2);
    expect(mod.engines[0].freed).toBe(true);
    expect(mod.engines.length).toBe(2);
    next.tick(1);
    expect(mod.engines[1].ticks).toBe(1);

    handle.stop();
    expect(mod.engines[1].freed).toBe(true);
    expect(Object.getOwnPropertyDescriptor(a, "adoptSim")).toBeDefined();
    expect((globalThis as { __vcEngine?: unknown }).__vcEngine).toBeUndefined();
    // The app's own adopt still works and no longer hosts.
    a.adoptSim(Simulation.newGame(5, "classic"));
    expect(mod.engines.length).toBe(2);
  });

  // The host lets the old tower go before the app swaps, so the app's own
  // hand-off passes what the old engine still owed to the new tower, once.
  it("hands the replaced tower's owed events to the tower the app adopts", () => {
    const mod = fakeModule();
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    const old = a.sim;
    old.drainGameplayEvents(); // the founding
    mod.engines[0].owed = [{ name: "facility_placed", payload: { kind: "office", floor: 2, count: 1 } }];
    const next = Simulation.newGame(4, "modern");
    a.adoptSim(next);
    expect(handle.status.hosted).toBe(true);
    expect(next.drainGameplayEvents()).toEqual([
      { name: "facility_placed", payload: { kind: "office", floor: 2, count: 1 } },
      { name: "tower_founded", payload: { mode: "modern" } },
    ]);
    expect(old.drainGameplayEvents()).toEqual([]);
    handle.stop();
  });

  // A load or a new game is the way out of a trapped engine: the swap goes
  // through, the new tower is hosted, and the counted loss moves with it.
  it("swaps away from a trapped engine and carries the loss to the new tower", () => {
    const mod = fakeModule();
    const a = app();
    const log = quiet();
    const handle = startWasmHost(a, mod, log);
    a.sim.drainGameplayEvents(); // the founding
    const trapped = mod.engines[0];
    trapped.drainGameplayEvents = () => { throw new Error("unreachable executed"); };
    // The read model's copy of a command's event the engine still owed.
    a.sim.gameplayEvents.push("facility_placed", { kind: "office", floor: 2, count: 1 });
    const next = Simulation.newGame(4, "modern");
    a.adoptSim(next);
    expect(a.sim).toBe(next);
    expect(handle.status).toMatchObject({ starts: 2, hosted: true });
    expect(handle.status.errors).toEqual(["letting go of the last tower: unreachable executed"]);
    expect(trapped.freed).toBe(true);
    expect(next.drainGameplayEvents()).toEqual([{ name: "tower_founded", payload: { mode: "modern" } }]);
    expect(next.gameplayEventsDropped).toBe(1);
    handle.stop();
  });

  // An engine that traps at its first call (the drop count) loses its whole
  // batch; the read model's copies stand in.
  it("counts a trap at the drop count from the read model", () => {
    const mod = fakeModule();
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    a.sim.drainGameplayEvents(); // the founding
    mod.engines[0].gameplayEventsDropped = () => { throw new Error("unreachable executed"); };
    a.sim.gameplayEvents.push("facility_placed", { kind: "office", floor: 2, count: 1 });
    const next = Simulation.newGame(4, "modern");
    a.adoptSim(next);
    expect(handle.status).toMatchObject({ starts: 2, hosted: true });
    expect(next.drainGameplayEvents()).toEqual([{ name: "tower_founded", payload: { mode: "modern" } }]);
    expect(next.gameplayEventsDropped).toBe(1);
    handle.stop();
  });

  it("stops cleanly on a trapped engine", () => {
    const mod = fakeModule();
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    mod.engines[0].drainGameplayEvents = () => { throw new Error("unreachable executed"); };
    handle.stop();
    expect(handle.status.errors).toEqual(["letting go of the last tower: unreachable executed"]);
    expect(mod.engines[0].freed).toBe(true);
    expect(handle.status.hosted).toBe(false);
    a.adoptSim(Simulation.newGame(5, "classic"));
    expect(mod.engines.length).toBe(1); // no longer follows swaps
    expect((globalThis as { __vcEngine?: unknown }).__vcEngine).toBeUndefined();
  });

  it("carries the engine's drop count to the tower the app adopts", () => {
    const mod = fakeModule();
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    mod.engines[0].dropped = 4;
    expect(a.sim.gameplayEventsDropped).toBe(4);
    const next = Simulation.newGame(4, "modern");
    a.adoptSim(next);
    expect(next.gameplayEventsDropped).toBe(4);
    handle.stop();
  });

  it("keeps the host when the app adopts the tower it already holds", () => {
    const mod = fakeModule();
    const a = app();
    const handle = startWasmHost(a, mod, quiet());
    a.adoptSim(a.sim);
    expect(handle.status.starts).toBe(1);
    expect(mod.engines[0].freed).toBe(false);
    handle.stop();
  });

  it("stays stopped when the adopt stops the host", () => {
    const mod = fakeModule();
    const a = app();
    const own = a.adoptSim;
    let handle: ReturnType<typeof startWasmHost> | null = null;
    a.adoptSim = function (this: typeof a, sim: Simulation) {
      own.call(this, sim);
      handle?.stop();
    };
    handle = startWasmHost(a, mod, quiet());
    a.adoptSim(Simulation.newGame(4, "modern"));
    expect(mod.engines.length).toBe(1);
    expect(mod.engines[0].freed).toBe(true);
    expect(handle.current()).toBeNull();
  });

  // An adopt that throws before its swap leaves the app on the old tower, and
  // the host takes that tower up again on a fresh engine (it has no crowd
  // yet; one with a crowd is refused and reported).
  it("hosts the tower the app still holds when the adopt throws", () => {
    const mod = fakeModule();
    const a = app();
    a.adoptSim = function () { throw new Error("adopt failed"); };
    const old = a.sim;
    const handle = startWasmHost(a, mod, quiet());
    expect(() => a.adoptSim(Simulation.newGame(4, "modern"))).toThrow(/adopt failed/);
    expect(a.sim).toBe(old);
    expect(mod.engines[0].freed).toBe(true);
    expect(handle.status).toMatchObject({ starts: 2, hosted: true, errors: [] });
    handle.stop();
  });

  it("reports a tower it cannot host and leaves it on the TypeScript engine", () => {
    const mod = fakeModule();
    const a = app();
    const log = quiet();
    const handle = startWasmHost(a, mod, log);
    const crowded = Simulation.newGame(6, "classic");
    crowded.crowd.people.push({ id: 1, seed: 1, state: "toDest", floor: 1, fy: 0, x: 170, floors: [], originFloor: 1, shafts: [], leg: 0, shaftId: null, carIndex: null, destX: 170, wait: 0, tripWait: 0, age: 0, linger: 0 });
    a.adoptSim(crowded);
    expect(handle.status).toMatchObject({ starts: 1, hosted: false });
    expect(handle.status.errors[0]).toMatch(/crowd/);
    expect(handle.current()).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyDescriptor(crowded, "money")?.value).toBeDefined();
    handle.stop();
  });

  it("resolves the package beside the app, under the page's base", () => {
    expect(enginePackageUrl("./", "https://example.test/play/index.html")).toBe("https://example.test/play/engine/verticopolis_engine.js");
    expect(enginePackageUrl("/", "https://example.test/play/")).toBe("https://example.test/engine/verticopolis_engine.js");
  });
});
