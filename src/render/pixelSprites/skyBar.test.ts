import { describe, expect, it } from "vitest";
import { bartenderX } from "./skyBar";

describe("bartenderX", () => {
  it("stands halfway between the two stools that straddle the counter's middle", () => {
    // Stools on a 7px pitch; the middle (40) falls between 38 and 45.
    expect(bartenderX([3, 10, 17, 24, 31, 38, 45, 52], 40)).toBe(41);
  });

  it("keeps at least 3px from both neighboring stool columns on a 7px pitch", () => {
    const stools = [3, 10, 17, 24, 31, 38];
    for (let mid = 0; mid <= 45; mid++) {
      const at = bartenderX(stools, mid);
      const nearest = Math.min(...stools.map((s) => Math.abs(s - at)));
      expect(nearest).toBeGreaterThanOrEqual(3);
    }
  });

  it("moves off a stool's column when the middle lands on it", () => {
    expect(bartenderX([10, 17, 24], 17)).toBe(20);
  });

  it("uses the end pair when the middle is past either end of the row", () => {
    expect(bartenderX([10, 17, 24], 2)).toBe(13);
    expect(bartenderX([10, 17, 24], 30)).toBe(20);
  });

  it("with one stool or none, stands at the middle unless that is the stool's column", () => {
    expect(bartenderX([], 12)).toBe(12);
    expect(bartenderX([12], 12)).toBe(13);
    expect(bartenderX([12], 20)).toBe(20);
  });

  it("rounds a half-pixel middle to a whole column", () => {
    expect(bartenderX([], 12.5)).toBe(13);
  });
});
