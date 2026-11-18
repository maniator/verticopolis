import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackAppAction } from "../analyticsActions";
import { holdRefusal, sayHeldRefusal, sayPressRefusal, type HeldRefusal } from "./dragRefusal";
import { SHAFT_THROUGH_ROOM } from "./shaftRoomRefusal";

vi.mock("../analyticsActions", () => ({ trackAppAction: vi.fn() }));

const deps = () => ({ audio: { sfx: vi.fn() }, ui: { toast: vi.fn() } });

beforeEach(() => vi.mocked(trackAppAction).mockClear());

describe("a drag's held refusal (#1847, #2046)", () => {
  it("holds the latest reason and says it once on release, counted", () => {
    const d = deps();
    const drag: HeldRefusal = {};
    const hold = holdRefusal(drag);
    hold("first");
    hold("second");
    sayHeldRefusal(d, drag, "bulldoze");
    sayHeldRefusal(d, drag, "bulldoze");
    expect(d.ui.toast).toHaveBeenCalledExactlyOnceWith("second", "bad");
    expect(d.audio.sfx).toHaveBeenCalledExactlyOnceWith("error");
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("drag_stopped", "bulldoze");
  });

  it("counts an extend that stopped at a room as a shaft and room refusal too", () => {
    const d = deps();
    const drag: HeldRefusal = {};
    holdRefusal(drag)(SHAFT_THROUGH_ROOM);
    sayHeldRefusal(d, drag, "extend");
    expect(trackAppAction).toHaveBeenCalledTimes(2);
    expect(trackAppAction).toHaveBeenCalledWith("drag_stopped", "extend");
    expect(trackAppAction).toHaveBeenCalledWith("shaft_room_refused", "shaft");
  });

  it("says nothing for a drag that holds no reason", () => {
    const d = deps();
    sayHeldRefusal(d, {}, "extend");
    expect(d.ui.toast).not.toHaveBeenCalled();
    expect(trackAppAction).not.toHaveBeenCalled();
  });

  it("says the press's refusal at once and does not repeat it on release", () => {
    const d = deps();
    const drag: HeldRefusal = {};
    sayPressRefusal(d, drag)("kept");
    expect(d.ui.toast).toHaveBeenCalledExactlyOnceWith("kept", "bad");
    holdRefusal(drag)("kept");
    sayHeldRefusal(d, drag, "bulldoze");
    expect(d.ui.toast).toHaveBeenCalledOnce();
    expect(trackAppAction).not.toHaveBeenCalled();
    holdRefusal(drag)("another");
    sayHeldRefusal(d, drag, "bulldoze");
    expect(d.ui.toast).toHaveBeenLastCalledWith("another", "bad");
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("drag_stopped", "bulldoze");
  });
});
