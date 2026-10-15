import { describe, expect, it } from "vitest";
import { catalogFor } from "../engine/catalog";
import { catalogFacility } from "../engine/catalogTypes";
import { ECON } from "../engine/econConfig";
import { ALL_KINDS, FACILITIES } from "../engine/facilities";
import { subtypeListFor } from "../engine/retailSubtypes";
import type { Unit } from "../engine/types";
import { hasAccessDiagnostic } from "./facilityDiagnostics";

/**
 * #921 moved these readouts from the engine tables to the catalog with no
 * change a player can see. Each check below states the old table formula and
 * holds the catalog read to it, kind by kind, for every kind a mode builds.
 */
describe("diagnostics read the catalog with the old tables' answers (#921)", () => {
  for (const mode of ["classic", "modern"] as const) {
    const catalog = catalogFor(mode);
    const buildable = ALL_KINDS.filter((k) => catalogFacility(catalog, k).available);

    it(`${mode}: the access line goes to the same kinds`, () => {
      for (const kind of buildable) {
        const before = FACILITIES[kind].population > 0 || ECON.dailyTrafficIncome[kind] !== undefined;
        expect(hasAccessDiagnostic(catalog, { kind } as Unit), kind).toBe(before);
      }
    });

    it(`${mode}: the retail block goes to the same kinds`, () => {
      for (const kind of buildable) {
        const before =
          subtypeListFor(kind) !== null && ECON.dailyTrafficIncome[kind] !== undefined && ECON.retailSpendPerCustomer[kind] !== undefined;
        expect(catalogFacility(catalog, kind).spendPerCustomer !== null, kind).toBe(before);
      }
    });
  }

  it("the patronage yardstick is the Modern table in both modes", () => {
    const modern = catalogFor("modern");
    for (const kind of ALL_KINDS) {
      if (subtypeListFor(kind) === null) continue;
      const f = catalogFacility(modern, kind);
      expect(f.dailyIncome ?? undefined, kind).toBe(ECON.dailyTrafficIncome[kind]);
      if (f.spendPerCustomer !== null) expect(f.spendPerCustomer, kind).toBe(ECON.retailSpendPerCustomer[kind]);
    }
  });
});
