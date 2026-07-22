import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { announceLive } from "./liveRegion";

/**
 * The polite live region's clear-then-set announce (#541 / AUD-022). Screen
 * readers usually will not re-speak a live region whose text is replaced with
 * the SAME string, so an identical consecutive announcement must clear to "" and
 * re-set on the next frame to register as a change.
 */
describe("announceLive (#541)", () => {
  let raf: { cb: FrameRequestCallback | null };
  let orig: typeof window.requestAnimationFrame;
  let el: HTMLElement;
  const win = window as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number };

  beforeEach(() => {
    el = document.createElement("div");
    el.id = "a11y-live";
    document.body.appendChild(el);
    raf = { cb: null };
    orig = window.requestAnimationFrame;
    win.requestAnimationFrame = (cb: FrameRequestCallback) => ((raf.cb = cb), 1);
  });
  afterEach(() => {
    win.requestAnimationFrame = orig;
    document.body.innerHTML = "";
  });

  const flush = (): void => raf.cb?.(0);

  it("clears synchronously, then sets on the next frame", () => {
    announceLive("Saved.");
    expect(el.textContent).toBe(""); // cleared first
    flush();
    expect(el.textContent).toBe("Saved.");
  });

  it("re-fires an identical consecutive message (clear-then-set both times)", () => {
    announceLive("On notice.");
    flush();
    expect(el.textContent).toBe("On notice.");
    // The same string again must still clear to "" and re-set, so the live
    // region registers a change and the screen reader re-speaks it.
    announceLive("On notice.");
    expect(el.textContent).toBe("");
    flush();
    expect(el.textContent).toBe("On notice.");
  });

  it("is a no-op when the live region is absent", () => {
    document.body.innerHTML = "";
    expect(() => announceLive("nothing here")).not.toThrow();
  });

  it("sets synchronously when requestAnimationFrame is unavailable", () => {
    (win as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame =
      undefined as unknown as typeof window.requestAnimationFrame;
    announceLive("no raf here");
    expect(el.textContent).toBe("no raf here");
  });
});
