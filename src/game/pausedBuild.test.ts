import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
import { KeyboardPlay, type KeyboardPlayDeps } from "./keyboardPlay";
import { nudgePlayButton, placementRefusedWhilePaused, refusePausedPlacement, UNPAUSE_TO_BUILD } from "./pausedBuild";

/**
 * Building while paused (#1936): the catalog's `buildsWhilePaused` rule and
 * the host's speed decide whether a new placement is refused, and a refusal
 * says so. The pointer and touch paths are in engineWiringPaused.test.ts.
 */

describe("placementRefusedWhilePaused", () => {
  it("refuses only a paused placement in a mode whose rule says no", () => {
    expect(placementRefusedWhilePaused({ buildsWhilePaused: false }, true)).toBe(true);
    expect(placementRefusedWhilePaused({ buildsWhilePaused: false }, false)).toBe(false);
    expect(placementRefusedWhilePaused({ buildsWhilePaused: true }, true)).toBe(false);
    expect(placementRefusedWhilePaused({ buildsWhilePaused: true }, false)).toBe(false);
  });
});

function deps(buildsWhilePaused: boolean, paused: boolean) {
  return {
    rules: vi.fn(() => ({ buildsWhilePaused })),
    paused: vi.fn(() => paused),
    toast: vi.fn(),
    sfx: vi.fn(),
    nudgePlay: vi.fn(),
  };
}

describe("refusePausedPlacement", () => {
  it("plays the error sound, shows the note as an alert toast and points at Play", () => {
    const d = deps(false, true);
    expect(refusePausedPlacement(d)).toBe(true);
    expect(d.sfx).toHaveBeenCalledExactlyOnceWith("error");
    expect(d.toast).toHaveBeenCalledExactlyOnceWith(UNPAUSE_TO_BUILD, "bad");
    expect(d.nudgePlay).toHaveBeenCalledOnce();
  });

  it("lets the placement through, silently, where the mode builds while paused or the clock runs", () => {
    for (const d of [deps(true, true), deps(false, false)]) {
      expect(refusePausedPlacement(d)).toBe(false);
      expect(d.sfx).not.toHaveBeenCalled();
      expect(d.toast).not.toHaveBeenCalled();
      expect(d.nudgePlay).not.toHaveBeenCalled();
    }
  });
});

describe("nudgePlayButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="speed"><button data-speed="0"></button><button data-speed="1"></button></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("highlights Play alone for a moment, and a second refusal restarts the moment", () => {
    const play = document.querySelector<HTMLElement>('#speed button[data-speed="1"]')!;
    const pause = document.querySelector<HTMLElement>('#speed button[data-speed="0"]')!;
    nudgePlayButton();
    expect(play.classList.contains("play-nudge")).toBe(true);
    expect(pause.classList.contains("play-nudge")).toBe(false);
    vi.advanceTimersByTime(1500);
    nudgePlayButton();
    vi.advanceTimersByTime(1500);
    expect(play.classList.contains("play-nudge"), "the restarted highlight is still lit").toBe(true);
    vi.advanceTimersByTime(400);
    expect(play.classList.contains("play-nudge")).toBe(false);
  });

  it("does nothing on a page without a speed bar", () => {
    document.body.innerHTML = "";
    expect(() => nudgePlayButton()).not.toThrow();
  });
});

/** A keyboard cursor under a build tool, with the paused-placement answer set. */
function keyboardUnder(kind: "office" | "elevatorStandard", refused: boolean) {
  const engine = { ensureVisible: vi.fn(), preview: null as unknown, transportPreview: null as unknown };
  const d = {
    engine: () => engine,
    tool: () => ({ type: "build", kind }),
    isTransportTool: () => kind === "elevatorStandard",
    updateBuildPreview: vi.fn(),
    refusePausedPlacement: vi.fn(() => refused),
    placeSimpleBuild: vi.fn(() => (kind === "elevatorStandard" ? null : { what: "room", ok: true })),
    pickedAt: () => null,
    announce: vi.fn(),
    captureUndo: vi.fn(),
    commitUndo: vi.fn(),
    catalog: () => catalogFor("classic"),
    enginePort: () => ({}),
    portCodes: () => ({}),
    isUnlocked: () => true,
  };
  const keyboard = new KeyboardPlay(d as unknown as KeyboardPlayDeps);
  keyboard.moveCursor(0, 0); // reveal the cursor
  return { keyboard, deps: d };
}

describe("a keyboard placement while paused", () => {
  it("places nothing and opens no undo step where the mode refuses it", () => {
    const { keyboard, deps: d } = keyboardUnder("office", true);
    keyboard.commitCursor();
    expect(d.refusePausedPlacement).toHaveBeenCalledOnce();
    expect(d.placeSimpleBuild).not.toHaveBeenCalled();
    expect(d.captureUndo).not.toHaveBeenCalled();
    expect(d.commitUndo).not.toHaveBeenCalled();
  });

  it("anchors no shaft where the mode refuses it", () => {
    const { keyboard, deps: d } = keyboardUnder("elevatorStandard", true);
    keyboard.commitCursor();
    expect(d.announce).not.toHaveBeenCalledWith(expect.stringContaining("anchored"));
  });

  it("places as usual where the mode allows it", () => {
    const { keyboard, deps: d } = keyboardUnder("office", false);
    keyboard.commitCursor();
    expect(d.placeSimpleBuild).toHaveBeenCalledOnce();
    expect(d.captureUndo).toHaveBeenCalledOnce();
  });
});
