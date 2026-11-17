import { describe, it, expect, vi } from "vitest";
import { DEFAULT_SCHEME, SCHEME_ATTRIBUTE, applyScheme, loadScheme, saveScheme } from "./appearancePrefs";

const store = (raw: string | null) => ({ getItem: vi.fn(() => raw) });

describe("appearance prefs", () => {
  it("start every player on Standard", () => {
    expect(DEFAULT_SCHEME).toBe("standard");
    expect(loadScheme(store(null))).toBe("standard");
  });

  it("read back the kept scheme", () => {
    const s = store("skyline");
    expect(loadScheme(s)).toBe("skyline");
    expect(s.getItem).toHaveBeenCalledWith("vc.appearance");
    expect(loadScheme(store("high_contrast"))).toBe("high_contrast");
  });

  it("keep Standard for anything that is not a scheme the dialog offers", () => {
    expect(loadScheme(store("luna"))).toBe("standard");
    expect(loadScheme(store(""))).toBe("standard");
  });

  it("fall back to Standard on blocked or missing storage", () => {
    const throwing = { getItem: vi.fn(() => { throw new Error("blocked"); }) };
    expect(loadScheme(throwing)).toBe("standard");
    expect(loadScheme(null)).toBe("standard");
  });

  it("save the scheme's id, and a full storage does not throw", () => {
    const s = { setItem: vi.fn() };
    saveScheme("skyline", s);
    expect(s.setItem).toHaveBeenCalledWith("vc.appearance", "skyline");
    const full = { setItem: vi.fn(() => { throw new Error("quota"); }) };
    expect(() => saveScheme("standard", full)).not.toThrow();
  });

  it("put the scheme on the root element, and Standard takes the attribute off", () => {
    const root = document.createElement("html");
    applyScheme("skyline", root);
    expect(root.getAttribute(SCHEME_ATTRIBUTE)).toBe("skyline");
    applyScheme("high_contrast", root);
    expect(root.getAttribute(SCHEME_ATTRIBUTE)).toBe("high_contrast");
    applyScheme("standard", root);
    expect(root.hasAttribute(SCHEME_ATTRIBUTE)).toBe(false);
  });
});
