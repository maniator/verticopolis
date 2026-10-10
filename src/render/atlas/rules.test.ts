import { describe, expect, it } from "vitest";
import { rand } from "../sprites/common";
import { skyColor } from "../sprites/sky";
import { signature } from "./archive";

/**
 * The manifest spells out two of the game's formulas for frontends in other
 * languages. These implement the rules exactly as written there and check
 * them against the game's code, so the text cannot drift from it.
 */

describe("manifest formula rules", () => {
  const rules = signature().rules;

  it("the sky rule reproduces skyColor at every quarter hour", () => {
    expect(rules.sky).toContain("#1c2246");
    expect(rules.sky).toContain("#82afe0");
    const ends = [
      [0x1c, 0x82],
      [0x22, 0xaf],
      [0x46, 0xe0],
    ];
    for (let q = 0; q < 96; q++) {
      const hour = q / 4;
      const t = Math.cos(((hour - 13) / 24) * 2 * Math.PI) * 0.5 + 0.5;
      const hex = ends.map(([a, b]) => Math.round(a + (b - a) * t).toString(16).padStart(2, "0")).join("");
      expect(`#${hex}`).toBe(skyColor(hour));
    }
  });

  it("the parking roll rule reproduces the game's hash", () => {
    expect(rules.parkingRoll).toContain("2654435761");
    const imul32 = (a: number, b: number) => Math.imul(a, b);
    const documented = (n: number) => {
      let x = imul32(n, 2654435761);
      x = imul32(x ^ (x >>> 15), 0x2c1b3c6d);
      x = imul32(x ^ (x >>> 13), 0x297a2d39);
      return ((x ^ (x >>> 16)) >>> 0) / 2 ** 32;
    };
    for (const id of [0, 1, 7, 12, 99, 4321, 65535]) expect(documented(id * 31)).toBe(rand((id * 31) | 0));
  });
});
