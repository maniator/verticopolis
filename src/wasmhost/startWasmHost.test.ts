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
