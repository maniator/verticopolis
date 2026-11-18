import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackAppAction } from "../analyticsActions";
import { countShaftRoomRefusal, ROOM_IN_SHAFT, SHAFT_THROUGH_ROOM, shaftRoomSide } from "./shaftRoomRefusal";

vi.mock("../analyticsActions", () => ({ trackAppAction: vi.fn() }));

beforeEach(() => vi.mocked(trackAppAction).mockClear());

describe("the shaft and room refusals' count", () => {
  it("names the side each refusal met", () => {
    expect(shaftRoomSide(ROOM_IN_SHAFT)).toBe("room");
    expect(shaftRoomSide(SHAFT_THROUGH_ROOM)).toBe("shaft");
    expect(shaftRoomSide("Not enough money.")).toBeUndefined();
    expect(shaftRoomSide(undefined)).toBeUndefined();
  });

  it("counts a room refused where a shaft runs as `room`", () => {
    countShaftRoomRefusal(ROOM_IN_SHAFT);
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("shaft_room_refused", "room");
  });

  it("counts a shaft refused through a room as `shaft`", () => {
    countShaftRoomRefusal(SHAFT_THROUGH_ROOM);
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("shaft_room_refused", "shaft");
  });

  it("counts no other refusal, and nothing without a reason", () => {
    countShaftRoomRefusal("Not enough money.");
    countShaftRoomRefusal(undefined);
    expect(trackAppAction).not.toHaveBeenCalled();
  });
});
