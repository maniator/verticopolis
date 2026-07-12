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

  it("round-trips the audio fields (muted + volumes)", () => {
    savePrefs({ muted: true, musicVolume: 0.4, sfxVolume: 0.75 });
    expect(loadPrefs()).toEqual({ muted: true, musicVolume: 0.4, sfxVolume: 0.75 });
  });

  it("clamps out-of-range volumes to 0..1 on load", () => {
    localStorage.setItem("vc.prefs", JSON.stringify({ musicVolume: 2, sfxVolume: -0.5 }));
    expect(loadPrefs()).toEqual({ musicVolume: 1, sfxVolume: 0 });
  });

  it("drops non-finite and non-numeric volumes and non-boolean muted", () => {
    // 1e999 parses to Infinity; null and strings are the other malformed shapes.
    localStorage.setItem("vc.prefs", '{"muted":1,"musicVolume":"loud","sfxVolume":1e999}');
    expect(loadPrefs()).toEqual({});
    localStorage.setItem("vc.prefs", JSON.stringify({ musicVolume: null, sfxVolume: true }));
    expect(loadPrefs()).toEqual({});
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
