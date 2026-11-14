import { describe, it, expect, vi } from "vitest";
import * as ex from "excalibur";
import { inputEng, ptr } from "./towerInputCamera.fixture";

/**
 * A mouse's back and forward side buttons do nothing on the tower (#2073).
 * Excalibur reports them as an unknown button, which the tower read as a left
 * click. Driven through the real handlers `bindInput` binds.
 */

const sideButton = { button: ex.PointerButton.Unknown, primary: true, buttons: 8 };

describe("a mouse side button over the tower", () => {
  it("places, taps and pans nothing on its press and release", () => {
    const classifyDown = vi.fn(() => "action" as const);
    const { e, handlers } = inputEng({ classifyDown });
    handlers.down(ptr({ tile: 2, floor: 3, ...sideButton }));
    handlers.up(ptr({ tile: 2, floor: 3, ...sideButton }));
    expect(classifyDown, "no gesture starts").not.toHaveBeenCalled();
    expect(e.onActionDown).not.toHaveBeenCalled();
    expect(e.onTap).not.toHaveBeenCalled();
    expect(e.gesture).toBeNull();
  });

  it("leaves a left press already open alone", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ tile: 2, floor: 3, primary: true, buttons: 1 }));
    handlers.down(ptr({ tile: 2, floor: 3, ...sideButton }));
    expect(e.onActionDown).toHaveBeenCalledOnce();
    expect(e.onActionCancel, "the open press is not cancelled").not.toHaveBeenCalled();
    expect(e.gesture).toBe("action");
  });

  it("still lets a finger press, which also reports an unknown button", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ tile: 2, floor: 3, touch: true, button: ex.PointerButton.Unknown, primary: true }));
    expect(e.onActionDown).toHaveBeenCalledOnce();
  });
});
