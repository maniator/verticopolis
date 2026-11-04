import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { UNDO_REFUSED } from "../simport/enginePort";
import { createAppHistory, NO_GESTURE } from "./appHistory";

describe("createAppHistory", () => {
  it("forwards a gesture to the engine and follows the step it takes, keeping the trail", async () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const followSwap = vi.fn();
    const toast = vi.fn();
    const hist = createAppHistory({ enginePort, ui: { toast }, followSwap });
    const capture = vi.spyOn(enginePort, "undoCapture");
    hist.capture("build");
    expect(capture).toHaveBeenCalledWith("build");
    enginePort.sim.build("lobby", 1, 160);
    hist.commit();
    await hist.undo();
    expect(followSwap).toHaveBeenCalledWith(true);
    expect(toast).toHaveBeenCalledWith("Undid: build", "info");
  });

  it("forwards a discard and clears the trail through the engine", () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const hist = createAppHistory({ enginePort, ui: { toast: () => {} }, followSwap: () => {} });
    const discard = vi.spyOn(enginePort, "undoDiscard");
    hist.capture("peek");
    hist.discard();
    expect(discard).toHaveBeenCalledOnce();
    expect(Array.from(enginePort.undoDepths()), "a peek that changed nothing").toEqual([0, 0]);
    hist.capture("build");
    enginePort.sim.build("lobby", 1, 160);
    hist.commit();
    hist.clear();
    expect(Array.from(enginePort.undoDepths())).toEqual([0, 0]);
  });

  it("numbers the gesture under way until anything closes it", () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const hist = createAppHistory({ enginePort, ui: { toast: () => {} }, followSwap: () => {} });
    expect(hist.gesture(), "none open").toBe(NO_GESTURE);
    hist.capture("a");
    const first = hist.gesture();
    expect(first).toBeGreaterThan(0);
    hist.capture("b");
    expect(hist.gesture(), "a capture over it is another gesture").not.toBe(first);
    const closes = [hist.commit, hist.discard, hist.clear, () => void hist.undo(), () => void hist.redo()];
    for (const close of closes) {
      hist.capture("c");
      close();
      expect(hist.gesture()).toBe(NO_GESTURE);
    }
  });

  it("shows the engine's reason for a refused step and resolves", async () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const followSwap = vi.fn();
    const toast = vi.fn();
    const hist = createAppHistory({ enginePort, ui: { toast }, followSwap });
    vi.spyOn(enginePort, "undo").mockReturnValue(Float64Array.of(UNDO_REFUSED, enginePort.generation()));
    vi.spyOn(enginePort, "lastReason").mockReturnValue("Not enough money to undo that.");
    await expect(hist.undo()).resolves.toBeUndefined();
    expect(toast).toHaveBeenCalledExactlyOnceWith("Not enough money to undo that.", "info");
    expect(followSwap).not.toHaveBeenCalled();
  });
});
