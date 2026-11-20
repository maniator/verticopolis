import { describe, expect, it } from "vitest";
import { looksLikeLegacyTower } from "./tdtImportHelpers";

/** The first two bytes of every `.TDT` file: the magic 0x2400, little-endian. */
const TDT_HEAD = new Uint8Array([0x00, 0x24, 0x01, 0x00]);

describe("looksLikeLegacyTower", () => {
  it("takes a .tdt name in any case, whatever the bytes", () => {
    expect(looksLikeLegacyTower("TOWER.TDT")).toBe(true);
    expect(looksLikeLegacyTower("tower.tdt", new Uint8Array([1, 2]))).toBe(true);
  });

  it("takes any other name only when the bytes start with the magic", () => {
    expect(looksLikeLegacyTower("tower.vctower")).toBe(false);
    expect(looksLikeLegacyTower("tower.sav")).toBe(false);
    expect(looksLikeLegacyTower("tower.sav", TDT_HEAD)).toBe(true);
    expect(looksLikeLegacyTower("mystery.bin", TDT_HEAD)).toBe(true);
    expect(looksLikeLegacyTower("mystery.bin", new Uint8Array([1, 2, 3]))).toBe(false);
    expect(looksLikeLegacyTower("mystery.bin", new Uint8Array([0x00]))).toBe(false);
  });
});
