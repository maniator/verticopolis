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

describe("loadStored's follow (PR 5e: the app follows a swap itself)", () => {
  it("calls the follow once a load is done, after the engine holds the new tower", () => {
    const engine = new TsEngine(Simulation.newGame(1));
    const before = engine.generation();
    const followed = vi.fn(() => expect(engine.generation()).toBeGreaterThan(before));
    expect(loadStored(engine, followed)(textOf(Simulation.newGame(2)))).toBe(true);
    expect(followed).toHaveBeenCalledOnce();
  });

  it("calls nothing for a refused load", () => {
    const engine = new TsEngine(Simulation.newGame(1));
    const followed = vi.fn();
    expect(loadStored(engine, followed)("nope")).toBe(false);
    expect(followed).not.toHaveBeenCalled();
  });
});
