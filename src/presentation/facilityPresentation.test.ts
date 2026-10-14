import { describe, expect, it } from "vitest";
import { catalogFor } from "../engine/catalog";
import { FACILITY_PRESENTATION, facilityColor, facilityDescription } from "./facilityPresentation";

describe("the facility presentation table (#921)", () => {
  it("covers exactly the kinds the catalogs list, with a hex color and a description each", () => {
    for (const mode of ["classic", "modern"] as const) {
      const kinds = catalogFor(mode).facilities.map((f) => f.key).sort();
      expect(Object.keys(FACILITY_PRESENTATION).sort(), mode).toEqual(kinds);
      for (const kind of kinds) {
        expect(facilityColor(kind), kind).toMatch(/^#[0-9a-f]{6}$/i);
        expect(facilityDescription(kind).length, kind).toBeGreaterThan(10);
      }
    }
  });
});
