import { describe, it, expect } from "vitest";
import { isPhoneViewport } from "./phoneTier.ts";

// e2e/phoneTier.spec.ts checks these bounds against the page's phone query
// and phone layout in a real browser.

describe("phone tier bounds", () => {
  it("treat portrait and landscape phones, and only those, as phones", () => {
    // The gallery's portrait phone, a larger phone, and the Pixel sideways.
    expect(isPhoneViewport({ width: 390, height: 844 })).toBe(true);
    expect(isPhoneViewport({ width: 412, height: 915 })).toBe(true);
    expect(isPhoneViewport({ width: 852, height: 352 })).toBe(true);
    // A portrait tablet and the gallery's desktop.
    expect(isPhoneViewport({ width: 834, height: 1112 })).toBe(false);
    expect(isPhoneViewport({ width: 1280, height: 800 })).toBe(false);
  });

  it("include each bound and stop one pixel past it", () => {
    expect(isPhoneViewport({ width: 767, height: 1100 })).toBe(true);
    expect(isPhoneViewport({ width: 768, height: 1100 })).toBe(false);
    expect(isPhoneViewport({ width: 1023, height: 599 })).toBe(true);
    expect(isPhoneViewport({ width: 1024, height: 599 })).toBe(false);
    expect(isPhoneViewport({ width: 1023, height: 600 })).toBe(false);
  });
});
