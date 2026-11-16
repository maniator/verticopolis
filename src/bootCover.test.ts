import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOT_DAWN_REST_MS, BOOT_FADE_MS, BOOT_READY_CLASS, finishBootCover } from "./bootCover";

/** A stand-in CSS animation: where it is, where it ends, and a rate spy. */
const fakeAnimation = (currentTime: number, endTime: number) => ({
  currentTime,
  effect: { getComputedTiming: () => ({ endTime }) },
  updatePlaybackRate: vi.fn(),
});

const cover = () => document.getElementById("boot-cover") as HTMLElement;

describe("finishBootCover", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("plays what is left of the sunrise in a moment, lets clicks through and removes the cover after the fade", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="boot-cover"></div>`;
    const early = fakeAnimation(700, 2800);
    const nearlyDone = fakeAnimation(2700, 2800);
    cover().getAnimations = vi.fn(() => [early, nearlyDone] as unknown as Animation[]);

    finishBootCover();

    expect(cover().getAnimations).toHaveBeenCalledWith({ subtree: true });
    expect(early.updatePlaybackRate).toHaveBeenCalledWith(2100 / BOOT_DAWN_REST_MS);
    expect(nearlyDone.updatePlaybackRate).not.toHaveBeenCalled();
    expect(cover().classList.contains(BOOT_READY_CLASS)).toBe(true);
    expect(cover().style.getPropertyValue("--boot-done")).toBe("1");

    vi.advanceTimersByTime(BOOT_DAWN_REST_MS + BOOT_FADE_MS - 1);
    expect(document.getElementById("boot-cover")).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.getElementById("boot-cover")).toBeNull();
  });

  it("removes the cover when its fade ends, before the fallback timer", () => {
    document.body.innerHTML = `<div id="boot-cover"></div>`;
    cover().getAnimations = vi.fn(() => []);
    finishBootCover();
    const end = new Event("transitionend") as TransitionEvent;
    Object.defineProperty(end, "propertyName", { value: "opacity" });
    cover().dispatchEvent(end);
    expect(document.getElementById("boot-cover")).toBeNull();
  });

  it("removes the cover at once under reduced motion", () => {
    document.body.innerHTML = `<div id="boot-cover"></div>`;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    finishBootCover();
    expect(document.getElementById("boot-cover")).toBeNull();
  });

  it("does nothing a second time or with no cover", () => {
    document.body.innerHTML = `<div id="boot-cover"></div>`;
    const spy = vi.fn(() => []);
    cover().getAnimations = spy;
    finishBootCover();
    finishBootCover();
    expect(spy).toHaveBeenCalledTimes(1);
    document.body.innerHTML = "";
    expect(() => finishBootCover()).not.toThrow();
  });
});
