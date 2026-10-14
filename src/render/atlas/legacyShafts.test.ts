import { describe, expect, it } from "vitest";
import { FACILITIES } from "../../engine/facilities";
import { TILE } from "../scale";
import { LEGACY_SHAFT_WIDTHS, legacyShaftJobs, transportJobs } from "./catalogExtras";
import { stretch } from "./compose";
import { lookupShaft } from "./lookup";
import type { Image } from "./pixels";

describe("legacy shaft widths (#917)", () => {
  it("bakes each legacy width's frames under a w<tiles> name, on pages of their own", () => {
    const legacy = legacyShaftJobs();
    expect(legacy.every((j) => j.ownPages === "legacy-shafts")).toBe(true);
    for (const [kind, widths] of Object.entries(LEGACY_SHAFT_WIDTHS)) {
      const cat = transportJobs().filter((j) => j.keys.kind === kind);
      for (const tiles of widths!) {
        expect(tiles).toBeLessThan(FACILITIES[kind as keyof typeof FACILITIES].width);
        const mine = legacy.filter((j) => j.keys.kind === kind && j.keys.width === tiles);
        // One legacy frame for each catalog frame, renamed and narrower.
        expect(mine.map((j) => j.name)).toEqual(cat.map((j) => j.name.replace(`/${kind}`, `/${kind}/w${tiles}`)));
        expect(mine.every((j) => j.w === tiles * TILE)).toBe(true);
        // The reader names exactly these frames.
        const names = lookupShaft(kind as keyof typeof FACILITIES, tiles);
        expect(mine.every((j) => j.name.startsWith(names.shaft) || (names.car !== undefined && j.name.startsWith(names.car)))).toBe(true);
      }
    }
  });
  it("stretches a composed picture by nearest neighbor from its left edge", () => {
    // Two columns, red then blue, stretched to five.
    const px = (r: number, g: number, b: number) => [r, g, b, 255];
    const src: Image = { w: 2, h: 1, data: new Uint8ClampedArray([...px(255, 0, 0), ...px(0, 0, 255)]) };
    const out = stretch(src, 5);
    expect(out.w).toBe(5);
    expect(Array.from(out.data)).toEqual([...px(255, 0, 0), ...px(255, 0, 0), ...px(255, 0, 0), ...px(0, 0, 255), ...px(0, 0, 255)]);
    expect(Array.from(stretch(src, 1).data)).toEqual(px(255, 0, 0));
  });
});
