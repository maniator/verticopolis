import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { attachWasmHost } from "./wasmHost";
import { stepGate } from "./stepGate";
import { fakeModule } from "./fakeEngine.fixture";
import { advanceOwedMinutes } from "../game/frameLoop";
import { engineSuffix } from "./engineLabel";

describe("the coalesced main-thread host (sync: frame)", () => {
  it("advances the clock per step and applies the frame once, at the flush", () => {
    const sim = Simulation.newGame(9, "classic");
    const mod = fakeModule();
    const host = attachWasmHost(sim, mod, { sync: "frame" });
    const engine = mod.engines[0];
    const frames = host.frames;
    const t0 = sim.clock.minutes;
    sim.tick(2);
    sim.tick(3);
    expect(sim.clock.minutes).toBe(t0 + 5);
    expect(host.frames, "no sync between steps").toBe(frames);
    engine.money = 777;
    stepGate(sim)!.flush();
    expect(host.frames).toBe(frames + 1);
    expect(sim.money).toBe(777);
    stepGate(sim)!.flush(); // nothing stepped since: no second sync
    expect(host.frames).toBe(frames + 1);
    sim.tick(1);
    void stepGate(sim)!.settle();
    expect(host.frames).toBe(frames + 2);
    expect(stepGate(sim)!.canStep()).toBe(true);
    host.detach();
    expect(stepGate(sim)).toBeUndefined();
  });

  it("the step host registers no gate", () => {
    const sim = Simulation.newGame(9, "classic");
    const host = attachWasmHost(sim, fakeModule());
    expect(stepGate(sim)).toBeUndefined();
    host.detach();
  });
});

describe("advanceOwedMinutes with the steps held back", () => {
  it("owes the minutes under the cap and steps nothing", () => {
    const ticks: number[] = [];
    const host = { sim: { tick: (dt: number) => { ticks.push(dt); }, clock: { minuteOfDay: 600 } }, accMinutes: 0 };
    const debt = { minutes: 0 };
    advanceOwedMinutes(host, debt, 1000, 120, true, false);
    expect(ticks).toEqual([]);
    expect(host.accMinutes).toBe(30);
    advanceOwedMinutes(host, debt, 16, 120, true, true);
    expect(ticks.length).toBe(4);
  });
});

describe("engineSuffix", () => {
  it("names the worker placement", () => {
    expect(engineSuffix({ __vcEngine: { status: { hosted: true, placement: "worker" } } })).toBe(" · WASM engine (worker)");
    expect(engineSuffix({ __vcEngine: { status: { hosted: true } } })).toBe(" · WASM engine");
    expect(engineSuffix({ __vcEngine: { status: { hosted: false, placement: "worker" } } })).toBe("");
  });
});
