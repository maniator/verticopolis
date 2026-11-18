import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackAppAction } from "../../analyticsActions";
import { BuildActions } from "../../game/buildActions";
import { portDeps } from "../../game/portDeps.fixture";
import { ROOM_IN_SHAFT, SHAFT_THROUGH_ROOM } from "../../game/shaftRoomRefusal";
import { draftTower, type Draft } from "../portKit/drafts";
import { noEngine } from "../portKit/rustEngine";

vi.mock("../../analyticsActions", async (importOriginal) => ({ ...(await importOriginal<object>()), trackAppAction: vi.fn() }));

/** A lobby and two floors over tiles 10 to 49, with a standard elevator at
 *  tile 12 serving floors 1 to 3. Every placement is asserted. */
function tower(): Draft {
  const sim = draftTower();
  for (let x = 10; x < 50; x++) {
    expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    expect(sim.tower.place("floor", 3, x).ok).toBe(true);
  }
  expect(sim.buildTransport("elevatorStandard", 12, 1, 3).ok).toBe(true);
  return sim;
}

describe.skipIf(noEngine)("a shaft and a room on the same tile, through the real engine", () => {
  let toasts: string[];
  let build: BuildActions;

  beforeEach(() => {
    vi.mocked(trackAppAction).mockClear();
    toasts = [];
    build = new BuildActions({
      ...portDeps(tower()).deps,
      ui: { toast: (text: string) => void toasts.push(text) },
      audio: { sfx: () => {} },
      selectedId: () => null,
      clearSelection: () => {},
    });
  });

  it("says the engine's words for a room where a shaft runs, and counts it as `room`", () => {
    expect(build.tryBuild("office", 2, 10)).toBe(false);
    expect(toasts).toEqual([ROOM_IN_SHAFT]);
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("shaft_room_refused", "room");
  });

  it("says the engine's words for a shaft through a room, and counts it as `shaft`", () => {
    expect(build.tryBuild("office", 3, 30)).toBe(true);
    expect(build.tryBuildTransport("elevatorStandard", 32, 1, 3).ok).toBe(false);
    expect(toasts).toEqual([SHAFT_THROUGH_ROOM]);
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("shaft_room_refused", "shaft");
  });

  it("counts nothing for a room built beside the shaft", () => {
    expect(build.tryBuild("office", 2, 30)).toBe(true);
    expect(trackAppAction).not.toHaveBeenCalled();
  });
});
