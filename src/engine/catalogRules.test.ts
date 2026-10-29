import { describe, expect, it } from "vitest";
// The rules a frontend reads off the catalog instead of the engine's tables
// (#921 part 2b): opening hours, households and the price ladder's rung.
import { catalogFor } from "./catalog";
import { catalogFacility, catalogHouseholdPrice, catalogOpenAt, catalogResidents, rungFor } from "./catalogTypes";
import { residentCount } from "./census";
import { ALL_KINDS, hasBusinessHours, isOpenAt } from "./facilities";
import { householdPrice } from "./households";
import { ladderRungFor, snapToLadder } from "./pricing";

describe("the catalog's rules match the engine's", () => {
  for (const mode of ["classic", "modern"] as const) {
    const catalog = catalogFor(mode);

    it(`${mode}: opening hours, every kind and hour, fractions and midnight included`, () => {
      for (const kind of ALL_KINDS) {
        const f = catalogFacility(catalog, kind);
        expect(f.openHours === null, kind).toBe(!hasBusinessHours(kind));
        for (const hour of [0, 1.5, 2, 6.99, 7, 10, 13.9, 14, 17, 19.5, 20, 21, 22, 23, 23.75, 24]) expect(catalogOpenAt(f, hour), `${kind} at ${hour}`).toBe(isOpenAt(kind, hour));
      }
    });

    it(`${mode}: residents and the household price`, () => {
      for (const kind of ALL_KINDS) {
        const f = catalogFacility(catalog, kind);
        for (const residents of [undefined, null, 2, 5]) expect(catalogResidents(f, residents), `${kind} with ${residents}`).toBe(residentCount({ kind, residents: residents ?? undefined }));
      }
      for (const [base, residents] of [[150_000, undefined], [150_000, 2], [150_000, 5], [99_999, 4]] as const) expect(catalogHouseholdPrice(catalog, base, residents)).toBe(householdPrice(base, residents));
      expect(catalogHouseholdPrice(catalog, 150_000, null)).toBe(150_000);
    });
  }

  it("names the rung the engine snaps to: nearest, ties up, Average when not finite", () => {
    const rungs = [10, 20, 30, 40, 50].map((value, level) => ({ level, label: `r${level}`, value }));
    for (const v of [-5, 10, 14.9, 15, 25, 31, 45, 99, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rungFor(rungs, v), String(v)).toBe(ladderRungFor(rungs, v));
      expect(rungFor(rungs, v).value).toBe(snapToLadder(rungs, v));
    }
    expect(rungFor(rungs, 15).value).toBe(20);
    expect(rungFor(rungs, Number.NaN).value).toBe(30);
  });
});
