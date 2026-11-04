// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUI, mountAppDom } from "../tests/uiFixture";
import { setHistoryButtons } from "./uiStatus";

/**
 * The toolbar's Undo and Redo as `UI` wires them. A click on a gray Undo
 * asks the game whether a gesture is still open (`undoUnderWay`), since a
 * release the canvas never saw can leave one open with nothing on the
 * stacks yet; a gray Redo has nothing to run either way.
 */

/** A port holding `depths` steps, [undo, redo]. */
const holding = (depths: number[]) => ({ undoDepths: () => Float64Array.from(depths) });

beforeEach(() => {
  mountAppDom();
});

describe("the toolbar's Undo and Redo", () => {
  it("run a click on a gray Undo only while a gesture is still open", () => {
    const underWay = vi.fn(() => true);
    const { ui, cb } = makeUI({ undoUnderWay: underWay });
    setHistoryButtons(ui, holding([0, 0]));
    const undo = document.getElementById("btn-undo")!;
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    undo.click();
    expect(cb.onUndo).toHaveBeenCalledTimes(1);
    underWay.mockReturnValue(false);
    undo.click();
    expect(cb.onUndo).toHaveBeenCalledTimes(1);
  });

  it("leave a click on a gray Redo alone, with a gesture open or not", () => {
    const { ui, cb } = makeUI({ undoUnderWay: vi.fn(() => true) });
    setHistoryButtons(ui, holding([0, 0]));
    document.getElementById("btn-redo")!.click();
    expect(cb.onRedo).not.toHaveBeenCalled();
  });
});
