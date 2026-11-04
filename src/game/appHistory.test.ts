import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { UNDO_DONE, UNDO_NOTHING_TO_STEP, UNDO_REFUSED } from "../simport/enginePort";
import { createAppHistory, NO_GESTURE } from "./appHistory";

describe("createAppHistory", () => {
  it("forwards a gesture to the engine and follows the step it takes, keeping the trail", async () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const followSwap = vi.fn();
    const toast = vi.fn();
    const hist = createAppHistory({ enginePort, ui: { toast }, followSwap, showSteps: () => {} });
    const capture = vi.spyOn(enginePort, "undoCapture");
    hist.capture("build");
    expect(capture).toHaveBeenCalledWith("build");
    enginePort.sim.build("lobby", 1, 160);
    hist.commit();
    await hist.undo();
    expect(followSwap, "a step keeps the camera, the scene and the tower's latches").toHaveBeenCalledWith("step");
    expect(toast).toHaveBeenCalledWith("Undid: build", "info");
  });

  it("forwards a discard and clears the trail through the engine", () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const hist = createAppHistory({ enginePort, ui: { toast: () => {} }, followSwap: () => {}, showSteps: () => {} });
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
    const hist = createAppHistory({ enginePort, ui: { toast: () => {} }, followSwap: () => {}, showSteps: () => {} });
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

  it("shows the steps the engine holds after every call that reaches it", async () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    // Each show reads the depths, so it proves the call ran after the engine moved them.
    const shown: number[][] = [];
    const showSteps = () => void shown.push(Array.from(enginePort.undoDepths()));
    const hist = createAppHistory({ enginePort, ui: { toast: () => {} }, followSwap: () => {}, showSteps });
    hist.capture("a");
    enginePort.sim.build("lobby", 1, 160);
    const calls = [hist.commit, hist.undo, hist.redo, hist.discard, hist.clear];
    for (const call of calls) await call();
    expect(shown).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 0],
      [1, 0],
      [0, 0],
    ]);
  });

  it("shows the steps once the host has followed a step", async () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const order: string[] = [];
    const hist = createAppHistory({
      enginePort,
      ui: { toast: () => {} },
      followSwap: () => order.push("follow"),
      showSteps: () => order.push("show"),
    });
    hist.capture("build");
    enginePort.sim.build("lobby", 1, 160);
    hist.commit();
    order.length = 0;
    await hist.undo();
    expect(order).toEqual(["follow", "show"]);
  });

  it("shows the engine's reason for a refused step and resolves", async () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const followSwap = vi.fn();
    const toast = vi.fn();
    const showSteps = vi.fn();
    const hist = createAppHistory({ enginePort, ui: { toast }, followSwap, showSteps });
    vi.spyOn(enginePort, "undo").mockReturnValue(Float64Array.of(UNDO_REFUSED, enginePort.generation()));
    vi.spyOn(enginePort, "lastReason").mockReturnValue("Not enough money to undo that.");
    await expect(hist.undo()).resolves.toBeUndefined();
    expect(toast).toHaveBeenCalledExactlyOnceWith("Not enough money to undo that.", "info");
    expect(followSwap).not.toHaveBeenCalled();
    // An undo may close an open gesture before it is refused, so the depths can move.
    expect(showSteps, "the refused step still shows the steps").toHaveBeenCalledOnce();
  });

  it("rejects a status the port does not name, and follows no tower", async () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const followSwap = vi.fn();
    const toast = vi.fn();
    const hist = createAppHistory({ enginePort, ui: { toast }, followSwap, showSteps: () => {} });
    const unnamed = Math.max(UNDO_DONE, UNDO_NOTHING_TO_STEP, UNDO_REFUSED) + 1;
    vi.spyOn(enginePort, "redo").mockReturnValue(Float64Array.of(unnamed, enginePort.generation()));
    await expect(hist.redo()).rejects.toThrow(`status ${unnamed}`);
    expect(followSwap).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
