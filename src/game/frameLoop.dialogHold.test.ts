import { describe, it, expect, vi, afterEach } from "vitest";
import { runFrame, CHOICE_WAITING_NOTICE } from "./frameLoop";
import { makeApp, makeSim } from "./frameLoop.fixture";

/**
 * How `runFrame` treats its auto-surfaced dialogs (an emergency choice, the
 * TOWER congratulations) while a dialog holds the player's work (#1121). Split
 * from `frameLoop.test.ts`, which pins the rest of the frame, with the same
 * inert collaborators.
 */

vi.mock("./trafficHud", () => ({ updateTraffic: vi.fn() }));
vi.mock("./panelAnchoring", () => ({ positionPanels: vi.fn() }));
vi.mock("./updateFlow", () => ({ maybeSurfaceUpdatePrompt: vi.fn() }));
vi.mock("./mealRush", () => ({ decideMealRush: vi.fn(() => ({ fire: false, dayOfKind: 0 })) }));

afterEach(() => {
  document.body.innerHTML = "";
});

/** Open the shared dialog and have the precedence report that it holds the
 *  player's work (unsaved schedule edits, #1121). Returns the dialog so a test
 *  can close it. */
function openDialogHoldingWork(raw: ReturnType<typeof makeApp>["raw"]): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.id = "modal";
  dialog.open = true;
  document.body.appendChild(dialog);
  raw.ui.precedence.ownsPendingWork.mockImplementation((isOpen: boolean) => isOpen);
  return dialog;
}

describe("runFrame auto-surfaced dialogs and a dialog holding the player's work (#1121)", () => {
  it("holds a pending emergency behind the dialog, stops time and says why, then opens it once the dialog closes", () => {
    const sim = makeSim({ pendingChoice: { message: "Fire on floor 30!", cost: 5000 } });
    const { app, raw } = makeApp({ sim, accMinutes: 7 });
    const dialog = openDialogHoldingWork(raw);
    runFrame(app, 1000);
    expect(raw.ui.precedence.ownsPendingWork).toHaveBeenCalledWith(true);
    expect(raw.enginePort.advance).not.toHaveBeenCalled();
    expect(raw.accMinutes).toBe(0);
    expect(raw.ui.showEventChoice).not.toHaveBeenCalled();
    expect(raw.shownChoice).toBe(false);
    // Asked not to rebuild a line the dialog already shows, since this runs every frozen frame.
    expect(raw.ui.sayVisibly).toHaveBeenCalledExactlyOnceWith(CHOICE_WAITING_NOTICE, "info", false);
    dialog.open = false;
    runFrame(app, 16);
    expect(raw.enginePort.advance).toHaveBeenCalledTimes(1);
    expect(raw.ui.showEventChoice).toHaveBeenCalledTimes(1);
    expect(raw.shownChoice).toBe(true);
  });

  it("does not open an emergency rolled by this frame's step over the dialog", () => {
    const sim = makeSim();
    const { app, raw } = makeApp({ sim });
    openDialogHoldingWork(raw);
    raw.enginePort.advance.mockImplementation((owed: number) => {
      sim.pendingChoice = { message: "Bomb threat!", cost: 20000 };
      return Float64Array.of(1, owed);
    });
    runFrame(app, 16);
    expect(raw.enginePort.advance).toHaveBeenCalledTimes(1);
    expect(raw.ui.showEventChoice).not.toHaveBeenCalled();
    // The next frame holds it, as a choice that was already pending is held.
    runFrame(app, 16);
    expect(raw.enginePort.advance).toHaveBeenCalledTimes(1);
    expect(raw.ui.sayVisibly).toHaveBeenCalledWith(CHOICE_WAITING_NOTICE, "info", false);
  });

  it("still opens an emergency over a dialog that holds nothing", () => {
    const sim = makeSim({ pendingChoice: { message: "Fire!", cost: 5000 } });
    const { app, raw } = makeApp({ sim });
    const dialog = document.createElement("dialog");
    dialog.id = "modal";
    dialog.open = true;
    document.body.appendChild(dialog);
    runFrame(app, 16);
    expect(raw.ui.precedence.ownsPendingWork).toHaveBeenCalledWith(true);
    expect(raw.enginePort.advance).toHaveBeenCalledTimes(1);
    expect(raw.ui.showEventChoice).toHaveBeenCalledTimes(1);
    expect(raw.ui.sayVisibly).not.toHaveBeenCalled();
  });

  it("keeps the TOWER congratulations waiting while the dialog holds work, and time running", () => {
    const sim = makeSim({ evaluatedTower: true });
    const { app, raw } = makeApp({ sim });
    const dialog = openDialogHoldingWork(raw);
    runFrame(app, 16);
    expect(raw.enginePort.advance).toHaveBeenCalledTimes(1);
    expect(raw.ui.congratsTower).not.toHaveBeenCalled();
    expect(raw.shownWin).toBe(false);
    dialog.open = false;
    raw.lastUiUpdate = -1e9; // past the ~6Hz throttle again
    runFrame(app, 16);
    expect(raw.ui.congratsTower).toHaveBeenCalledTimes(1);
    expect(raw.shownWin).toBe(true);
  });

  it("brings the congratulations back when an emergency replaces them, and not when the player does (#1134)", () => {
    const sim = makeSim({ evaluatedTower: true });
    const { app, raw } = makeApp({ sim });
    runFrame(app, 16);
    const replaced = raw.ui.congratsTower.mock.calls[0][0] as () => void;
    // Something the player opened over them: still a close.
    replaced();
    expect(raw.shownWin).toBe(true);
    // An emergency latches its freeze, then opens over them.
    raw.shownChoice = true;
    replaced();
    expect(raw.shownWin).toBe(false);
    raw.shownChoice = false;
    raw.lastUiUpdate = -1e9;
    runFrame(app, 16);
    expect(raw.ui.congratsTower).toHaveBeenCalledTimes(2);
  });

  it("reads a precedence that throws as holding nothing, so the choice still opens", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sim = makeSim({ pendingChoice: { message: "Fire!", cost: 5000 } });
    const { app, raw } = makeApp({ sim });
    raw.ui.precedence.ownsPendingWork.mockImplementation(() => {
      throw new Error("ui fault");
    });
    runFrame(app, 16);
    expect(raw.ui.showEventChoice).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
