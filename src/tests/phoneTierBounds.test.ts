import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PHONE_TIER, isPhoneViewport } from "./phoneTier.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const query = `(max-width: ${PHONE_TIER.maxWidth}px), (max-width: ${PHONE_TIER.shortMaxWidth}px) and (max-height: ${PHONE_TIER.shortMaxHeight}px)`;

describe("phone tier bounds", () => {
  it("match the page's phone query and the phone block", () => {
    // The gallery decides which scenes present as a touch device from these
    // numbers, so they have to be the ones the page lays out by.
    expect(read("src/main.ts")).toContain(JSON.stringify(query));
    expect(read("src/styles.css")).toContain(`@media ${query} {`);
    // The landscape block is the short half of the tier, held sideways.
    const landscape = `(max-width: ${PHONE_TIER.shortMaxWidth}px) and (max-height: ${PHONE_TIER.shortMaxHeight}px) and (orientation: landscape)`;
    expect(read("src/styles.css")).toContain(`@media ${landscape} {`);
    // The one-row tabs: under 340px tall or 540px wide, held sideways. The
    // .98 bounds stand in for range syntax, which Safari before 16.4 ignores.
    expect(read("src/styles.css")).toContain(
      `@media (max-width: ${PHONE_TIER.shortMaxWidth}px) and (max-height: 339.98px) and (orientation: landscape),\n  (max-width: 539.98px) and (orientation: landscape) {`,
    );
  });

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

  it("keeps the landscape onboarding card clear and readable on split-screen widths", () => {
    const css = read("src/styles.css");
    expect(css).toContain("#onboard.onboard--mobile {\n    top: 118px;\n  }");
    expect(css).toContain("width: max(200px, min(300px, calc(100vw - 360px - env(safe-area-inset-left, 0px))));");
  });
});
