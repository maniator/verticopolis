// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEBUG_HUD_ID,
  DEBUG_HUD_REFRESH_MS,
  DEBUG_HUD_VIEW_ID,
  debugHudText,
  mountDebugHud,
  type FrameStatsLike,
} from "./debugHud";

const frame = (fps: number, drawCalls: number): FrameStatsLike => ({
  fps,
  elapsed: 16.66,
  duration: { update: 2.04, draw: 5.5 },
  graphics: { drawCalls, drawnImages: 340 },
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the debug HUD text (#645)", () => {
  it("shows fps, frame time, update and draw time, and draw calls", () => {
    expect(debugHudText(frame(59.6, 12))).toBe(
      "fps 60  frame 16.7 ms\nupdate 2.0 ms  draw 5.5 ms\ndraw calls 12  images 340",
    );
  });

  it("says so when no tower is open", () => {
    expect(debugHudText(undefined)).toBe("fps: no tower open");
  });
});

describe("mounting the debug HUD (#645)", () => {
  it("reads the renderer on each refresh, so a rebuilt engine is picked up", () => {
    vi.useFakeTimers();
    const renderer: { frame?: FrameStatsLike } = {};
    const source = vi.fn(() => (renderer.frame ? { stats: { prevFrame: renderer.frame } } : undefined));
    const stop = mountDebugHud(source);
    const box = document.getElementById(DEBUG_HUD_ID);
    expect(box?.textContent).toBe("fps: no tower open");
    renderer.frame = frame(30, 7); // a tower opens, or the engine is rebuilt
    vi.advanceTimersByTime(DEBUG_HUD_REFRESH_MS);
    expect(box?.textContent).toContain("fps 30");
    expect(box?.textContent).toContain("draw calls 7");
    expect(source).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stays out of the way: fixed, not clickable, hidden from screen readers", () => {
    const stop = mountDebugHud(() => undefined);
    const box = document.getElementById(DEBUG_HUD_ID)!;
    expect(box.style.position).toBe("fixed");
    expect(box.style.pointerEvents).toBe("none");
    expect(box.getAttribute("aria-hidden")).toBe("true");
    stop();
  });

  it("sits in the game view's bottom-left corner and follows it on refresh", () => {
    vi.useFakeTimers();
    const view = document.createElement("canvas");
    view.id = DEBUG_HUD_VIEW_ID;
    document.body.append(view);
    const rect = { left: 180, bottom: 900, width: 1000, height: 850 };
    vi.spyOn(view, "getBoundingClientRect").mockImplementation(() => rect as DOMRect);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(1000);
    const stop = mountDebugHud(() => undefined);
    const box = document.getElementById(DEBUG_HUD_ID)!;
    expect([box.style.left, box.style.bottom]).toEqual(["184px", "104px"]);
    // A phone rotating moves the view; the next refresh moves the box with it.
    Object.assign(rect, { left: 0, bottom: 600 });
    vi.advanceTimersByTime(DEBUG_HUD_REFRESH_MS);
    expect([box.style.left, box.style.bottom]).toEqual(["4px", "404px"]);
    stop();
    vi.restoreAllMocks();
  });

  it("falls back to the page's corner while the view has no size", () => {
    const view = document.createElement("canvas");
    view.id = DEBUG_HUD_VIEW_ID;
    document.body.append(view);
    const stop = mountDebugHud(() => undefined);
    const box = document.getElementById(DEBUG_HUD_ID)!;
    expect([box.style.left, box.style.bottom]).toEqual(["4px", "4px"]);
    stop();
  });

  it("replaces an earlier overlay, stopping its timer", () => {
    vi.useFakeTimers();
    const first = vi.fn(() => undefined);
    mountDebugHud(first);
    const second = vi.fn(() => undefined);
    const stop = mountDebugHud(second);
    expect(document.querySelectorAll(`#${DEBUG_HUD_ID}`)).toHaveLength(1);
    const firstCalls = first.mock.calls.length;
    vi.advanceTimersByTime(DEBUG_HUD_REFRESH_MS * 4);
    expect(first.mock.calls.length).toBe(firstCalls);
    expect(second.mock.calls.length).toBe(5);
    stop();
  });

  it("removes itself and stops reading when stopped", () => {
    vi.useFakeTimers();
    const source = vi.fn(() => undefined);
    const stop = mountDebugHud(source);
    stop();
    expect(document.getElementById(DEBUG_HUD_ID)).toBeNull();
    vi.advanceTimersByTime(DEBUG_HUD_REFRESH_MS * 4);
    expect(source).toHaveBeenCalledTimes(1);
  });
});
