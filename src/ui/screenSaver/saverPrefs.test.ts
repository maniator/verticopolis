import { describe, it, expect, vi } from "vitest";
import { defaultSaverPrefs, loadSaverPrefs, saveSaverPrefs } from "./saverPrefs";

const store = (raw: string | null) => ({ getItem: vi.fn(() => raw) });

describe("screen saver prefs", () => {
  it("default to Night Shift after 5 minutes, on the way back only on a computer", () => {
    expect(defaultSaverPrefs(false)).toEqual({ saver: "night", waitMinutes: 5, onReturn: true });
    expect(defaultSaverPrefs(true)).toEqual({ saver: "night", waitMinutes: 5, onReturn: false });
  });

  it("read back what was saved", () => {
    const s = store(JSON.stringify({ saver: "marquee", waitMinutes: 10, onReturn: false }));
    expect(loadSaverPrefs(false, s)).toEqual({ saver: "marquee", waitMinutes: 10, onReturn: false });
    expect(s.getItem).toHaveBeenCalledWith("vc.screensaver");
  });

  it("keep the default for any value that is not one the dialog offers", () => {
    const s = store(JSON.stringify({ saver: "pipes", waitMinutes: 7, onReturn: "yes" }));
    expect(loadSaverPrefs(false, s)).toEqual(defaultSaverPrefs(false));
  });

  it("fall back to the defaults on unreadable or blocked storage", () => {
    expect(loadSaverPrefs(true, store("{nope"))).toEqual(defaultSaverPrefs(true));
    const throwing = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    expect(loadSaverPrefs(false, throwing)).toEqual(defaultSaverPrefs(false));
    expect(loadSaverPrefs(false, null)).toEqual(defaultSaverPrefs(false));
  });

  it("save as JSON, and a full storage does not throw", () => {
    const s = { setItem: vi.fn() };
    saveSaverPrefs({ saver: "none", waitMinutes: 1, onReturn: true }, s);
    expect(s.setItem).toHaveBeenCalledWith(
      "vc.screensaver",
      JSON.stringify({ saver: "none", waitMinutes: 1, onReturn: true }),
    );
    const full = {
      setItem: vi.fn(() => {
        throw new Error("quota");
      }),
    };
    expect(() => saveSaverPrefs(defaultSaverPrefs(false), full)).not.toThrow();
  });
});
