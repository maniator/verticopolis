import { describe, it, expect, vi } from "vitest";
import { holdTowerFrames } from "./frameHold";

function tower(running: boolean) {
  const clock = {
    isRunning: running,
    stop: vi.fn(() => {
      clock.isRunning = false;
    }),
    start: vi.fn(() => {
      clock.isRunning = true;
    }),
  };
  return { engine: { clock } };
}

describe("holdTowerFrames", () => {
  it("stops a running clock and starts it again once on release", () => {
    const t = tower(true);
    const release = holdTowerFrames(() => t);
    expect(t.engine.clock.stop).toHaveBeenCalledTimes(1);
    expect(t.engine.clock.isRunning).toBe(false);
    release();
    release();
    expect(t.engine.clock.start).toHaveBeenCalledTimes(1);
    expect(t.engine.clock.isRunning).toBe(true);
  });

  it("leaves a renderer that a context-loss rebuild replaced during the hold alone", () => {
    const old = tower(true);
    let live = old;
    const release = holdTowerFrames(() => live);
    live = tower(true); // the rebuild's fresh renderer, already running
    release();
    expect(old.engine.clock.start).not.toHaveBeenCalled();
    expect(live.engine.clock.stop).not.toHaveBeenCalled();
    expect(live.engine.clock.start).not.toHaveBeenCalled();
  });

  it("leaves a stopped clock (a lost GL context) stopped", () => {
    const t = tower(false);
    holdTowerFrames(() => t)();
    expect(t.engine.clock.stop).not.toHaveBeenCalled();
    expect(t.engine.clock.start).not.toHaveBeenCalled();
  });
});
