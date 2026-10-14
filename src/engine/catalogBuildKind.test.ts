import { describe, expect, it } from "vitest";
import { catalogFor } from "./catalog";
import { catalogBuildKind } from "./catalogTypes";
import { groundFloorStructureKind } from "./tower/towerTopology";
import { ALL_KINDS } from "./facilities";

describe("catalogBuildKind (#921)", () => {
  it("gives the engine's ground-floor rule for every kind and floor, in both modes", () => {
    for (const mode of ["classic", "modern"] as const) {
      const catalog = catalogFor(mode);
      for (const kind of ALL_KINDS) {
        for (const floor of [-9, 0, 1, 2, 15, 100]) {
          expect(catalogBuildKind(catalog, kind, floor), `${mode} ${kind} @ ${floor}`).toBe(groundFloorStructureKind(kind, floor));
        }
      }
    }
  });

  it("follows the catalog's world rather than a fixed floor", () => {
    const base = catalogFor("modern");
    const moved = { ...base, world: { ...base.world, groundFloor: 2 } };
    expect(catalogBuildKind(moved, "floor", 2)).toBe("lobby");
    expect(catalogBuildKind(moved, "floor", 1)).toBe("floor");
  });
});
