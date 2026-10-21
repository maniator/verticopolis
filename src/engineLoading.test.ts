import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENGINE_LOADING_DELAY_MS, ENGINE_LOADING_TEXT, ENGINE_SLOW_AFTER_MS, ENGINE_SLOW_TEXT, showEngineLoading } from "./engineLoading";

const line = () => document.querySelector("#boot-cover .boot-loading");
const live = () => document.getElementById("a11y-live")?.textContent;

describe("showEngineLoading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="boot-cover" aria-hidden="true"></div><div id="a11y-live" role="status"></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("shows nothing for a load that settles within the wait", () => {
    const stop = showEngineLoading();
    vi.advanceTimersByTime(ENGINE_LOADING_DELAY_MS - 1);
    stop();
    vi.advanceTimersByTime(ENGINE_SLOW_AFTER_MS * 2);
    expect(line()).toBeNull();
    expect(live()).toBe("");
  });

  it("shows the line after the wait, announces it, and adds the slow-load note later", () => {
    const stop = showEngineLoading();
    vi.advanceTimersByTime(ENGINE_LOADING_DELAY_MS);
    expect(line()?.textContent).toBe(ENGINE_LOADING_TEXT);
    vi.advanceTimersByTime(50);
    expect(live()).toBe(ENGINE_LOADING_TEXT);
    vi.advanceTimersByTime(ENGINE_SLOW_AFTER_MS);
    expect(line()?.textContent).toBe(`${ENGINE_LOADING_TEXT} ${ENGINE_SLOW_TEXT}`);
    expect(live()).toBe(ENGINE_SLOW_TEXT);
    stop();
    expect(live()).toBe("");
  });

  it("takes the line and its announcement away when the load settles", () => {
    const stop = showEngineLoading();
    vi.advanceTimersByTime(ENGINE_LOADING_DELAY_MS + 50);
    stop();
    expect(line()).toBeNull();
    expect(live()).toBe("");
    // A second stop, and the timers that were canceled, do nothing.
    stop();
    vi.advanceTimersByTime(ENGINE_SLOW_AFTER_MS * 2);
    expect(line()).toBeNull();
  });

  it("leaves a later announcement alone", () => {
    const stop = showEngineLoading();
    vi.advanceTimersByTime(ENGINE_LOADING_DELAY_MS + 50);
    document.getElementById("a11y-live")!.textContent = "Saved.";
    stop();
    expect(live()).toBe("Saved.");
  });

  it("does nothing once the cover is gone", () => {
    const stop = showEngineLoading();
    document.getElementById("boot-cover")!.remove();
    vi.advanceTimersByTime(ENGINE_SLOW_AFTER_MS * 2);
    expect(document.querySelector(".boot-loading")).toBeNull();
    stop();
  });
});
