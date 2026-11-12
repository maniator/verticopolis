import { describe, expect, it } from "vitest";
import { catalogFacility } from "../catalog/catalogTypes";
import { catalogFor } from "../tests/catalogFixture";
import { FACILITY_PRESENTATION, facilityColor, facilityDescription } from "./facilityPresentation";

describe("the facility presentation table (#921)", () => {
  it("covers exactly the kinds the catalogs list, with a hex color and a description each", () => {
    for (const mode of ["classic", "modern"] as const) {
      const kinds = catalogFor(mode).facilities.map((f) => f.key).sort();
      expect(Object.keys(FACILITY_PRESENTATION).sort(), mode).toEqual(kinds);
      for (const kind of kinds) {
        expect(facilityColor(kind), kind).toMatch(/^#[0-9a-f]{6}$/i);
        expect(facilityDescription(kind, catalogFor(mode).world).length, kind).toBeGreaterThan(10);
      }
    }
  });

  it("stands the wedding hall on the top floor the tower's catalog states (#1987)", () => {
    const world = catalogFor("modern").world;
    expect(facilityDescription("weddingHall", world)).toContain(`standing on floor ${world.maxFloor}.`);
    expect(facilityDescription("weddingHall", { maxFloor: 120 }), "a taller tower").toContain("standing on floor 120.");
  });

  it("sizes the wedding hall as both catalogs do", () => {
    // The card words the hall's size; the catalog owns it.
    const words: Record<number, string> = { 5: "five" };
    for (const mode of ["classic", "modern"] as const) {
      const catalog = catalogFor(mode);
      const hall = catalogFacility(catalog, "weddingHall");
      expect(facilityDescription("weddingHall", catalog.world), mode).toContain(`${hall.width} tiles wide and ${words[hall.floors]} floors tall`);
    }
  });
});
