import { describe, expect, it, vi } from "vitest";
import { UNDO_DONE, UNDO_NOTHING_TO_STEP, UNDO_REFUSED } from "../simport/enginePort";
import { mockPort } from "../tests/portKit/mockPort";
import { createAppHistory, NO_GESTURE } from "./appHistory";

/**
 * The app's history over a mock port: the calls it forwards and what it does
 * with the engine's answers. The steps themselves (depths, discard, clear,
 * refusals) are the Rust engine's, checked in `engine-rs/src/sim_undo_tests.rs`
 * and `engine-rs/src/wasm_port_undo_refusal_tests.rs`.
 */

const GENERATION = 4;

/** A port whose undo and redo answer `status`, with the engine's notice and
 *  refusal reason (`null`: the engine gave none). */
function historyPort(status: number = UNDO_DONE, notice?: string, reason: string | null = "Not enough money to undo that.") {
  return mockPort({
    undoCapture: () => undefined,
    undoCommit: () => true,
    undoDiscard: () => undefined,
    undoClear: () => undefined,
    undo: () => Float64Array.of(status, GENERATION),
    redo: () => Float64Array.of(status, GENERATION),
    undoNotice: () => notice,
    lastReason: () => reason ?? undefined,
  });
}

const quiet = () => ({ ui: { toast: vi.fn() }, followSwap: vi.fn(), showSteps: vi.fn() });

describe("createAppHistory", () => {
  it("forwards a gesture to the engine and follows the step it takes, toasting the engine's notice", async () => {
    const enginePort = historyPort(UNDO_DONE, "Undid: build");
    const app = quiet();
    const hist = createAppHistory({ enginePort, ...app });
    hist.capture("build");
    expect(enginePort.undoCapture).toHaveBeenCalledExactlyOnceWith("build");
    hist.commit();
    expect(enginePort.undoCommit).toHaveBeenCalledOnce();
    await hist.undo();
    expect(enginePort.undo).toHaveBeenCalledOnce();
    expect(app.followSwap, "a step keeps the camera, the scene and the tower's latches").toHaveBeenCalledExactlyOnceWith("step");
    expect(app.ui.toast).toHaveBeenCalledExactlyOnceWith("Undid: build", "info");
    await hist.redo();
    expect(enginePort.redo).toHaveBeenCalledOnce();
    expect(app.followSwap).toHaveBeenCalledTimes(2);
  });

  it("forwards a discard and a clear, one engine call each", () => {
    const enginePort = historyPort();
    const hist = createAppHistory({ enginePort, ...quiet() });
    hist.capture("peek");
    hist.discard();
    expect(enginePort.undoDiscard).toHaveBeenCalledOnce();
    expect(enginePort.undoClear).not.toHaveBeenCalled();
    hist.clear();
    expect(enginePort.undoClear).toHaveBeenCalledOnce();
    expect(enginePort.undoCommit, "neither commits the gesture").not.toHaveBeenCalled();
  });

  it("numbers the gesture under way until anything closes it", () => {
    const hist = createAppHistory({ enginePort: historyPort(UNDO_NOTHING_TO_STEP), ...quiet() });
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

  it("shows the steps after every call that reaches the engine, once that call ran", async () => {
    const order: string[] = [];
    const record = (name: string) => () => void order.push(name);
    const enginePort = mockPort({
      undoCapture: record("capture"),
      undoCommit: () => (order.push("commit"), true),
      undoDiscard: record("discard"),
      undoClear: record("clear"),
      undo: () => (order.push("undo"), Float64Array.of(UNDO_DONE, GENERATION)),
      redo: () => (order.push("redo"), Float64Array.of(UNDO_DONE, GENERATION)),
      undoNotice: () => undefined,
    });
    const hist = createAppHistory({ enginePort, ui: { toast: vi.fn() }, followSwap: vi.fn(), showSteps: record("show") });
    hist.capture("a");
    for (const call of [hist.commit, hist.undo, hist.redo, hist.discard, hist.clear]) await call();
    expect(order).toEqual(["capture", "show", "commit", "show", "undo", "show", "redo", "show", "discard", "show", "clear", "show"]);
  });

  it("shows the steps once the host has followed a step", async () => {
    const order: string[] = [];
    const hist = createAppHistory({
      enginePort: historyPort(UNDO_DONE),
      ui: { toast: () => {} },
      followSwap: () => order.push("follow"),
      showSteps: () => order.push("show"),
    });
    await hist.undo();
    expect(order).toEqual(["follow", "show"]);
  });

  it("follows nothing when the engine had nothing to step, and toasts its notice", async () => {
    const app = quiet();
    const hist = createAppHistory({ enginePort: historyPort(UNDO_NOTHING_TO_STEP, "Nothing to undo."), ...app });
    await hist.undo();
    expect(app.followSwap).not.toHaveBeenCalled();
    expect(app.ui.toast).toHaveBeenCalledExactlyOnceWith("Nothing to undo.", "info");
    expect(app.showSteps).toHaveBeenCalledOnce();
  });

  it("toasts nothing for a step the engine gave no notice", async () => {
    const app = quiet();
    const hist = createAppHistory({ enginePort: historyPort(UNDO_DONE), ...app });
    await hist.undo();
    expect(app.followSwap).toHaveBeenCalledOnce();
    expect(app.ui.toast).not.toHaveBeenCalled();
  });

  it("shows the engine's reason for a refused step and resolves", async () => {
    const enginePort = historyPort(UNDO_REFUSED);
    const app = quiet();
    const hist = createAppHistory({ enginePort, ...app });
    await expect(hist.undo()).resolves.toBeUndefined();
    expect(app.ui.toast).toHaveBeenCalledExactlyOnceWith("Not enough money to undo that.", "info");
    expect(enginePort.lastReason).toHaveBeenCalledOnce();
    expect(enginePort.undoNotice, "a refusal has no notice to read").not.toHaveBeenCalled();
    expect(app.followSwap).not.toHaveBeenCalled();
    expect(app.showSteps, "the refused step still shows the steps").toHaveBeenCalledOnce();
  });

  it("words a refusal itself when the engine gave no reason", async () => {
    const app = quiet();
    const hist = createAppHistory({ enginePort: historyPort(UNDO_REFUSED, undefined, null), ...app });
    await hist.redo();
    expect(app.ui.toast).toHaveBeenCalledExactlyOnceWith("That step can't be taken right now.", "info");
  });

  it("rejects a status the port does not name, and follows no tower", async () => {
    const unnamed = Math.max(UNDO_DONE, UNDO_NOTHING_TO_STEP, UNDO_REFUSED) + 1;
    const app = quiet();
    const hist = createAppHistory({ enginePort: historyPort(unnamed), ...app });
    await expect(hist.redo()).rejects.toThrow(`status ${unnamed}`);
    expect(app.followSwap).not.toHaveBeenCalled();
    expect(app.ui.toast).not.toHaveBeenCalled();
    expect(app.showSteps).not.toHaveBeenCalled();
  });
});
