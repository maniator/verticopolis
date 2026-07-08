import { describe, it, expect, beforeEach } from "vitest";
import { loadPrefs, savePrefs, reducedMotionActive } from "../storage/Prefs";

describe("Prefs (accessibility preferences)", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips reducedMotion + colorblindCue + steadyClock", () => {
    savePrefs({ reducedMotion: true, colorblindCue: false, steadyClock: true });
    expect(loadPrefs()).toEqual({ reducedMotion: true, colorblindCue: false, steadyClock: true });
  });

  it("defaults to {} when absent", () => {
    expect(loadPrefs()).toEqual({});
  });

  it("tolerates corrupt JSON and non-boolean fields", () => {
    localStorage.setItem("vc.prefs", "{not valid json");
    expect(loadPrefs()).toEqual({});
    localStorage.setItem("vc.prefs", JSON.stringify({ reducedMotion: "yes", colorblindCue: 1, steadyClock: "sure" }));
    expect(loadPrefs()).toEqual({}); // non-booleans dropped, no throw
  });

  it("is separate from the game save key (vc.prefs, not the save)", () => {
    savePrefs({ reducedMotion: true });
    expect(localStorage.getItem("vc.prefs")).toBeTruthy();
  });

  it("reducedMotionActive = OS media query OR the user pref", () => {
    expect(reducedMotionActive({}, false)).toBe(false);
    expect(reducedMotionActive({}, true)).toBe(true); // OS pref on
    expect(reducedMotionActive({ reducedMotion: true }, false)).toBe(true); // user pref on
    expect(reducedMotionActive({ reducedMotion: false }, true)).toBe(true); // OS wins
  });
});
