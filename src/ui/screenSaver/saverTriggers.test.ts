import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { IDLE_POLL_MS, watchForSaver, type SaverTriggerPorts } from "./saverTriggers";
import type { SaverPrefs } from "./saverPrefs";

let visibility: DocumentVisibilityState = "visible";

function ports(prefs: SaverPrefs, over: Partial<SaverTriggerPorts> = {}) {
  return {
    prefs: vi.fn(() => prefs),
    canShow: vi.fn(() => true),
    paused: vi.fn(() => true),
    start: vi.fn(),
    ...over,
  };
}

function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

const MIN = 60_000;

describe("the screen saver's triggers", () => {
  let stop = () => {};
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("start it once a paused tower sits untouched for the wait", () => {
    const p = ports({ saver: "night", waitMinutes: 1, onReturn: false });
    stop = watchForSaver(p).stop;
    vi.advanceTimersByTime(MIN - IDLE_POLL_MS);
    expect(p.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE_POLL_MS);
    expect(p.start).toHaveBeenCalledWith("idle");
  });

  it("count the wait from the player's last input", () => {
    const p = ports({ saver: "night", waitMinutes: 1, onReturn: false });
    stop = watchForSaver(p).stop;
    vi.advanceTimersByTime(MIN - IDLE_POLL_MS);
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(IDLE_POLL_MS * 2);
    expect(p.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MIN);
    expect(p.start).toHaveBeenCalledWith("idle");
  });

  it("never start it over a running tower, or when something is in the way", () => {
    const running = ports({ saver: "night", waitMinutes: 1, onReturn: false }, { paused: vi.fn(() => false) });
    stop = watchForSaver(running).stop;
    vi.advanceTimersByTime(5 * MIN);
    expect(running.start).not.toHaveBeenCalled();
    stop();
    const blocked = ports({ saver: "night", waitMinutes: 1, onReturn: false }, { canShow: vi.fn(() => false) });
    stop = watchForSaver(blocked).stop;
    vi.advanceTimersByTime(5 * MIN);
    expect(blocked.start).not.toHaveBeenCalled();
  });

  it("run no timer at all with the saver set to none", () => {
    const p = ports({ saver: "none", waitMinutes: 1, onReturn: true });
    stop = watchForSaver(p).stop;
    expect(vi.getTimerCount()).toBe(0);
    setVisibility("hidden");
    vi.advanceTimersByTime(5 * MIN);
    setVisibility("visible");
    expect(p.start).not.toHaveBeenCalled();
  });

  it("start it on the way back to the tab after the wait, when asked to", () => {
    const p = ports({ saver: "night", waitMinutes: 3, onReturn: true });
    stop = watchForSaver(p).stop;
    setVisibility("hidden");
    vi.advanceTimersByTime(2 * MIN);
    setVisibility("visible");
    expect(p.start).not.toHaveBeenCalled();
    setVisibility("hidden");
    vi.advanceTimersByTime(3 * MIN);
    setVisibility("visible");
    expect(p.start).toHaveBeenCalledWith("return");
  });

  it("not start it on the way back when the player turned that off", () => {
    const p = ports({ saver: "night", waitMinutes: 1, onReturn: false });
    stop = watchForSaver(p).stop;
    setVisibility("hidden");
    vi.advanceTimersByTime(10 * MIN);
    setVisibility("visible");
    expect(p.start).not.toHaveBeenCalledWith("return");
  });

  it("stop listening when stopped", () => {
    const p = ports({ saver: "night", waitMinutes: 1, onReturn: true });
    const w = watchForSaver(p);
    w.stop();
    vi.advanceTimersByTime(10 * MIN);
    setVisibility("hidden");
    vi.advanceTimersByTime(10 * MIN);
    setVisibility("visible");
    expect(p.start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
