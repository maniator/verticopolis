import { describe, expect, it } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
import type { Catalog } from "./catalogTypes";
import { catalogFacility, findCatalogFacility } from "./catalogTypes";
import { towerCatalog, useTowerCatalogSource } from "./towerCatalog";
import type { GameMode } from "../shared/types";

/** A tower as the handle reads it: a key with a mode. */
const tower = (mode: GameMode): { readonly mode: GameMode } => ({ mode });

describe("a tower's catalog handle (#921)", () => {
  it("reads the fallback source for the tower's own mode by default", () => {
    for (const mode of ["classic", "modern"] as const) {
      const sim = tower(mode);
      expect(towerCatalog(sim)).toEqual(catalogFor(mode));
      expect(towerCatalog(sim).mode).toBe(mode);
    }
  });

  it("reads each mode once and hands back the same catalog after", () => {
    const sim = tower("classic");
    expect(towerCatalog(sim)).toBe(towerCatalog(sim));
    expect(towerCatalog(sim, "modern")).toBe(towerCatalog(sim, "modern"));
    expect(towerCatalog(sim, "modern").mode).toBe("modern");
  });

  it("keeps each tower's catalog apart", () => {
    const a = tower("classic");
    const b = tower("classic");
    useTowerCatalogSource(a, () => ({ ...catalogFor("classic"), version: 0 }));
    expect(towerCatalog(a).version).toBe(0);
    expect(towerCatalog(b)).toEqual(catalogFor("classic"));
  });

  it("switches to another source and back", () => {
    const sim = tower("modern");
    const asked: GameMode[] = [];
    const marked: Catalog = { ...catalogFor("modern"), economy: { ...catalogFor("modern").economy, addCarCost: 1 } };
    useTowerCatalogSource(sim, (mode) => {
      asked.push(mode);
      return marked;
    });
    expect(towerCatalog(sim).economy.addCarCost).toBe(1);
    expect(towerCatalog(sim).economy.addCarCost).toBe(1);
    expect(asked).toEqual(["modern"]);
    useTowerCatalogSource(sim, null);
    expect(towerCatalog(sim)).toEqual(catalogFor("modern"));
  });

  it("finds a facility by kind, and refuses an unknown one only when asked to", () => {
    const catalog = catalogFor("classic");
    expect(catalogFacility(catalog, "office").key).toBe("office");
    expect(findCatalogFacility(catalog, "castle" as "office")).toBeUndefined();
    expect(() => catalogFacility(catalog, "castle" as "office")).toThrow(/lists no facility "castle"/);
  });
});
