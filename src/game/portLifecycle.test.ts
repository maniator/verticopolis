import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { SaveGame } from "../storage/SaveGame";
import { SWAP_REFUSED, loadStored, saveText, swapDone } from "./portLifecycle";

const textOf = (sim: Simulation): string => JSON.stringify(sim.serialize());

describe("swapDone", () => {
  it("returns on a done swap and throws the engine's refusal otherwise", () => {
    const engine = new TsEngine(Simulation.newGame(1));
    expect(() => swapDone(engine, engine.loadSave(textOf(Simulation.newGame(2))))).not.toThrow();
    const refused = engine.loadSave("not a save");
    expect(() => swapDone(engine, refused)).toThrow(engine.lastReason()!);
  });

  it("says the stock refusal when the engine gives no reason", () => {
    expect(() => swapDone({ lastReason: () => undefined }, Float64Array.of(0, 0))).toThrow(SWAP_REFUSED);
  });
});

describe("saveText", () => {
  it("stamps the live camera before the save, so the view travels with it", () => {
    const sim = Simulation.newGame(1);
    const engine = new TsEngine(sim);
    const text = saveText(engine, { tile: 120, floor: 7, zoom: 2 });
    expect((JSON.parse(text) as { view: unknown }).view).toEqual({ tile: 120, floor: 7, zoom: 2 });
  });

  it("stamps nothing without a camera, keeping the view the tower carries", () => {
    const sim = Simulation.newGame(1);
    sim.view = { tile: 33, floor: 4, zoom: 1 };
    const setCamera = vi.fn();
    const text = saveText({ setCamera, serialize: () => textOf(sim) }, null);
    expect(setCamera).not.toHaveBeenCalled();
    expect((JSON.parse(text) as { view: unknown }).view).toEqual({ tile: 33, floor: 4, zoom: 1 });
  });
});

describe("loadStored", () => {
  it("loads a stored save through the engine, which applies the founder rule", () => {
    localStorage.clear();
    const engine = new TsEngine(Simulation.newGame(1));
    const unstamped = Simulation.newGame(5);
    unstamped.founder = false;
    // A save with no appVersion predates the stamp, so its tower is a founder's.
    expect(loadStored(engine)(textOf(unstamped))).toBe(true);
    expect(engine.sim.founder).toBe(true);
    // SaveGame stamps what it writes, so a stored save keeps its own status.
    SaveGame.saveSlot(2, textOf(unstamped));
    expect(SaveGame.loadSlot(2, loadStored(engine))).toBe(true);
    expect(engine.sim.founder).toBe(false);
  });

  it("answers false for a save the engine refuses", () => {
    expect(loadStored(new TsEngine(Simulation.newGame(1)))("not a save")).toBe(false);
  });
});

describe("TsEngine.handOff (PR 5's bridge to GameApp.adoptSim)", () => {
  it("hands a done swap's tower to the app, keeping history only for a restore", () => {
    const engine = new TsEngine(Simulation.newGame(1));
    const handOff = vi.fn<(next: Simulation, keepHistory: boolean) => void>((next) => engine.take(next));
    engine.handOff = handOff;
    const before = engine.generation();
    const loaded = engine.loadSave(textOf(Simulation.newGame(2)));
    expect(handOff).toHaveBeenCalledOnce();
    expect(handOff.mock.calls[0][1]).toBe(false);
    expect(handOff.mock.calls[0][0]).toBe(engine.sim);
    expect(loaded[1]).toBeGreaterThan(before);
    engine.restore(engine.serialize());
    expect(handOff.mock.calls[1][1]).toBe(true);
  });

  it("hands nothing over for a refused swap", () => {
    const engine = new TsEngine(Simulation.newGame(1));
    const handOff = vi.fn();
    engine.handOff = handOff;
    expect(engine.loadSave("nope")[0]).toBe(0);
    expect(handOff).not.toHaveBeenCalled();
  });
});
