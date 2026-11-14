import { describe, it, expect, vi } from "vitest";
import { inputEng, ptr } from "./towerInputCamera.fixture";

/**
 * A canvas press whose release the canvas never heard (#1014, #824), driven
 * through the real handlers `bindInput` binds. Each test asserts which hook
 * ends the press and that the stale press drives nothing after.
 */

/** The selected shaft the extend arrow belongs to, and its arrow's hit box. */
const SHAFT = 5;
const ARROW_UP = { up: { x: 380, y: 280, w: 40, h: 40 } };
const onArrow = { sx: 400, sy: 300 };

describe("a press whose release was lost", () => {
  it("a mouse back over the canvas with its button up cancels the tool press and only hovers", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ tile: 2, floor: 3, primary: true, buttons: 1 }));
    handlers.move(ptr({ tile: 4, floor: 3, buttons: 0 }));
    expect(e.onActionCancel).toHaveBeenCalledOnce();
    expect(e.onActionMove, "no paint, bulldoze or sizing with the button up").not.toHaveBeenCalled();
    expect(e.onHover).toHaveBeenCalledWith(4, 3, null);
    expect(e.gesture).toBeNull();
  });

  it("a held button keeps driving the press", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ tile: 2, floor: 3, primary: true, buttons: 1 }));
    handlers.move(ptr({ tile: 4, floor: 3, buttons: 1 }));
    expect(e.onActionMove).toHaveBeenCalledWith(4, 3, null);
    expect(e.onActionCancel).not.toHaveBeenCalled();
  });

  it("a fresh press ends the tool press still open before it starts its own", () => {
    const order: string[] = [];
    const { handlers } = inputEng({
      classifyDown: () => "action",
      onActionCancel: vi.fn(() => order.push("cancel")),
      onActionDown: vi.fn(() => order.push("down")),
    });
    handlers.down(ptr({ tile: 2, floor: 3, primary: true }));
    handlers.down(ptr({ tile: 7, floor: 3, primary: true }));
    expect(order).toEqual(["down", "cancel", "down"]);
  });

  it("a fresh press ends an extend drag still open, so its floors bill as a new step", () => {
    const { e, handlers } = inputEng({ selectedId: SHAFT, arrowHit: ARROW_UP, classifyDown: () => "action" });
    handlers.down(ptr({ ...onArrow, primary: true }));
    expect(e.arrowDrag).toEqual({ end: "up", shaft: SHAFT });
    handlers.down(ptr({ ...onArrow, primary: true }));
    expect(e.onExtendEnd, "the old drag closed its step").toHaveBeenCalledOnce();
    expect(e.arrowDrag, "the new press is a drag of its own").toEqual({ end: "up", shaft: SHAFT });
  });

  it("a second finger is no fresh press: it still pinches over the first", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ pointerId: 1, sx: 100, sy: 100, touch: true, primary: true }));
    handlers.down(ptr({ pointerId: 2, sx: 300, sy: 300, touch: true, primary: false }));
    expect(e.tracker.pinching).toBe(true);
    expect(e.onActionCancel, "the pinch cancels the press, once").toHaveBeenCalledOnce();
  });

  it("an extend drag ends when its shaft is no longer the one selected", () => {
    const { e, handlers } = inputEng({ selectedId: SHAFT, arrowHit: ARROW_UP });
    handlers.down(ptr({ ...onArrow, primary: true, buttons: 1 }));
    e.selectedId = SHAFT + 1;
    handlers.move(ptr({ sx: 400, sy: 120, buttons: 1 }));
    expect(e.onExtendEnd).toHaveBeenCalledOnce();
    expect(e.onExtendTo, "the other shaft is never resized by this drag").not.toHaveBeenCalled();
    expect(e.arrowDrag).toBeNull();
  });

  it("a hovering mouse that never pressed here leaves a finger's press alone", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ pointerId: 7, touch: true, primary: true }));
    handlers.move(ptr({ pointerId: 1, buttons: 0 }));
    expect(e.onActionCancel).not.toHaveBeenCalled();
    expect(e.gesture).toBe("action");
  });
});
