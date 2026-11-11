import { describe, expect, it } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
import type { Catalog } from "../catalog/catalogTypes";
import { refuseForeignCatalogs } from "./catalogCheck";

/**
 * The boot check the shipped host runs on the engine package's catalogs
 * (`rustEngine.ts`): a catalog that lists other facility kinds than this build
 * draws, or lays the ground floor with one it does not, is refused, and so are
 * two modes that state different worlds, naming what differs. The catalogs here
 * are the TypeScript reference engine's, used only as sample input; the game
 * reads the Rust engine's, which `conformance/catalog-digests.json` pins.
 * Reading a catalog the build
 * cannot parse (its version, a kind listed twice) is `readCatalog`'s, in
 * `src/dualrun/catalog.test.ts`.
 */

const MODES = ["classic", "modern"] as const;
type Editable = { world: Record<string, unknown>; facilities: { key: string }[] };

/** Both modes' catalogs, with `edit` applied to a copy of `mode`'s. */
function catalogs(mode?: (typeof MODES)[number], edit?: (c: Editable) => void): Record<(typeof MODES)[number], Catalog> {
  const out = { classic: structuredClone(catalogFor("classic")), modern: structuredClone(catalogFor("modern")) };
  if (mode && edit) edit(out[mode] as unknown as Editable);
  return out;
}

describe("refuseForeignCatalogs", () => {
  it("accepts this build's own catalogs", () => {
    expect(() => refuseForeignCatalogs(catalogs())).not.toThrow();
  });

  it("refuses two modes whose lot or floor range differ, naming the field", () => {
    for (const field of ["lotWidth", "minFloor", "maxFloor"]) {
      const other = catalogs("modern", (c) => {
        c.world[field] = (c.world[field] as number) + 1;
      });
      expect(() => refuseForeignCatalogs(other), field).toThrow(`the Rust engine's classic and modern catalogs state different worlds (${field}), and the view draws one world for the page`);
    }
  });

  for (const mode of MODES) {
    it(`${mode}: refuses a kind this build cannot draw and a kind it drops`, () => {
      const first = catalogFor(mode).facilities[0].key;
      const unknown = catalogs(mode, (c) => c.facilities.push({ ...c.facilities[0], key: "hangar" }));
      expect(() => refuseForeignCatalogs(unknown)).toThrow(`the Rust engine's ${mode} catalog lists other facility kinds than this build draws (unknown hangar)`);
      const dropped = catalogs(mode, (c) => c.facilities.shift());
      expect(() => refuseForeignCatalogs(dropped)).toThrow(`(missing ${first})`);
      const both = catalogs(mode, (c) => {
        c.facilities.shift();
        c.facilities.push({ ...c.facilities[0], key: "hangar" });
      });
      expect(() => refuseForeignCatalogs(both)).toThrow(`(unknown hangar; missing ${first})`);
    });

    it(`${mode}: refuses a ground floor laid with a kind this build does not draw`, () => {
      const other = catalogs(mode, (c) => {
        c.world.groundFloorStructure = "hangar";
      });
      expect(() => refuseForeignCatalogs(other)).toThrow(`the Rust engine's ${mode} catalog lays the ground floor with a kind this build does not draw (hangar)`);
    });
  }
});
