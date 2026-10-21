import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { attachWasmHost } from "./wasmHost";
import { stepGate } from "./stepGate";
import { fakeModule } from "./fakeEngine.fixture";
import { advanceOwedMinutes } from "../game/frameLoop";
import { engineSuffix } from "./engineLabel";

describe("the attach", () => {
  // Two header fields, one read of the frame view, checked whole as the
  // decoder checks it (#1158 A25).
  it("reads the engine's frame view once", () => {
    const mod = fakeModule();
    const host = attachWasmHost(Simulation.newGame(9, "classic"), mod);
    expect(mod.engines[0].frameViews).toBe(1);
    host.detach();
  });
});

describe("the coalesced main-thread host (sync: frame)", () => {
  it.each(["frame", "step"] as const)("hands current commute rows back before an hourly merge (%s)", (sync) => {
    const sim = Simulation.newGame(9, "classic");
    const mod = fakeModule();
    const host = attachWasmHost(sim, mod, { sync });
    const engine = mod.engines[0];
    host.syncStructure();
    sim.crowd.adoptCommuteStress([[2, 10], [7, 80]]);
    engine.commuteRows = "[[2,25]]";
    engine.commuteRevision++;
    const merges = host.merges;
    sim.tick(1);
    host.flush();
    expect([...sim.crowd.commuteStressByFloor]).toEqual([[2, 25]]);
    expect(host.merges).toBe(merges);
    const save = engine.serialize();
    engine.commuteRows = "[[2,30],[3,15]]";
    engine.commuteRevision++;
    engine.owed = [{ name: "star_reached", payload: { star: 2 } }];
    host.detach();
    expect([...sim.crowd.commuteStressByFloor]).toEqual([[2, 30], [3, 15]]);
    expect(engine.serialize()).toBe(save);
    expect(sim.drainGameplayEvents().filter((e) => e.name === "star_reached")).toHaveLength(1);
    expect(sim.drainGameplayEvents()).toEqual([]);
  });
  it("faults, lets the engine go and freezes the tower when the commute rows at detach are malformed (#874)", () => {
    const sim = Simulation.newGame(9, "classic");
    const mod = fakeModule();
    const host = attachWasmHost(sim, mod, { sync: "frame" });
    const engine = mod.engines[0];
    sim.crowd.adoptCommuteStress([[2, 10]]);
    engine.commuteRows = '[[2,"x"]]';
    engine.commuteRevision++;
    sim.tick(1);
    expect(() => host.detach()).not.toThrow();
    expect(host.fault).toMatchObject({ reason: "other", message: expect.stringMatching(/while letting a tower go: .*commute stress/) });
    // After a fault the module is not called again, its free included (#1113).
    expect(engine).toMatchObject({ freed: false, abandoned: true });
    expect([...sim.crowd.commuteStressByFloor]).toEqual([[2, 10]]);
    // A faulted tower never runs on TypeScript, and its save is the newest
    // restore point (here the attach save).
    const minutes = sim.clock.minutes;
    sim.tick(30);
    expect(sim.clock.minutes).toBe(minutes);
    expect(Object.getOwnPropertyDescriptor(sim, "serialize")).toBeDefined();
    expect(sim.serialize().minutes).toBe(Simulation.newGame(9, "classic").clock.minutes);
  });
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
    expect(engineSuffix({ __vcEngine: { status: { hosted: true, placement: "worker" } } })).toBe(" · Rust engine (worker)");
    expect(engineSuffix({ __vcEngine: { status: { hosted: true } } })).toBe(" · Rust engine");
    expect(engineSuffix({ __vcEngine: { status: { hosted: false, placement: "worker" } } })).toBe("");
  });
});
