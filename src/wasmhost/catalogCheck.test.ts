import { describe, expect, it } from "vitest";
import { catalogFor } from "../engine/catalog";
import type { Catalog, CatalogWorld } from "../catalog/catalogTypes";
import { refuseForeignCatalog } from "./catalogCheck";

/**
 * The boot check the shipped host runs on each of the engine package's
 * catalogs (`rustEngine.ts`): a catalog that states another world, or lists
 * other facility kinds, than this build draws is refused, naming what
 * differs. The mirror host's catalog suite held these refusals until #1421
 * deleted it; reading a catalog the build cannot parse (its version, a kind
 * listed twice) is `readCatalog`'s, in `src/dualrun/catalog.test.ts`.
 */

const MODES = ["classic", "modern"] as const;

/** This build's own catalog for `mode`, with `edit` applied to a copy. */
function edited(mode: (typeof MODES)[number], edit: (c: { world: Record<string, unknown>; facilities: { key: string }[] }) => void): Catalog {
  const c = structuredClone(catalogFor(mode)) as unknown as { world: Record<string, unknown>; facilities: { key: string }[] };
  edit(c);
  return c as unknown as Catalog;
}

describe("refuseForeignCatalog", () => {
  for (const mode of MODES) {
    it(`${mode}: accepts this build's own catalog`, () => {
      expect(() => refuseForeignCatalog(catalogFor(mode))).not.toThrow();
    });

    it(`${mode}: refuses a world that differs in any one field, naming it`, () => {
      const fields = Object.keys(catalogFor(mode).world) as (keyof CatalogWorld)[];
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        const other = edited(mode, (c) => {
          c.world[field] = typeof c.world[field] === "number" ? (c.world[field] as number) + 1 : `${String(c.world[field])}-other`;
        });
        expect(() => refuseForeignCatalog(other), field).toThrow(`the Rust engine's ${mode} catalog states a different world from this build's tables (${field})`);
      }
    });

    it(`${mode}: refuses a kind this build cannot draw and a kind it drops`, () => {
      const first = catalogFor(mode).facilities[0].key;
      const unknown = edited(mode, (c) => c.facilities.push({ ...c.facilities[0], key: "hangar" }));
      expect(() => refuseForeignCatalog(unknown)).toThrow(`the Rust engine's ${mode} catalog lists other facility kinds than this build draws (unknown hangar)`);
      const dropped = edited(mode, (c) => c.facilities.shift());
      expect(() => refuseForeignCatalog(dropped)).toThrow(`(missing ${first})`);
      const both = edited(mode, (c) => {
        c.facilities.shift();
        c.facilities.push({ ...c.facilities[0], key: "hangar" });
      });
      expect(() => refuseForeignCatalog(both)).toThrow(`(unknown hangar; missing ${first})`);
    });
  }
});
