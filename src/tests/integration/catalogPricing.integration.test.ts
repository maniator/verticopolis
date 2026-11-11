import { describe, expect, it } from "vitest";
import { catalogOn } from "../../catalog/towerCatalog";
import { newViewReader } from "../../game/portAccess";
import { Cards } from "../../simport/cards";
import type { FacilityKind } from "../../shared/types";
import { unitPrice } from "../../ui/catalogPricing";
import { LOT_WIDTH, layTile, newSeededDraft } from "../portKit/draftFixtures";
import { engineFromSave, look, noEngine } from "../portKit/rustEngine";

/**
 * What a fresh build of every priced kind charges on the Rust engine, against
 * what `unitPrice` reads from the engine's catalog for the unit it stored.
 * The unit tests (`src/ui/catalogPricing.test.ts`) check the reads alone.
 */

describe.skipIf(noEngine)("a fresh build's price on the engine (#921)", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`matches the catalog's price for every ${mode} priced kind`, () => {
      const draft = newSeededDraft(5, mode);
      draft.money = 1e12;
      draft.star = 6;
      const x0 = Math.floor(LOT_WIDTH / 2) - 20;
      const eligible = catalogOn(draft.port, mode).facilities.filter((f) => f.available && f.rent && !f.transport && !f.basement);
      expect(eligible.length, `${mode}: the sweep covers priced kinds`).toBeGreaterThan(3);
      const built: { id: number; kind: FacilityKind }[] = [];
      for (let x = x0; x < x0 + 80; x++) layTile(draft, "lobby", 1, x);
      let floor = 2;
      for (const f of eligible) {
        for (let story = floor; story < floor + f.floors; story++) for (let x = x0; x < x0 + 80; x++) layTile(draft, "floor", story, x);
        const res = draft.tower.place(f.key, floor, x0 + 2);
        // Every priced kind must build, or the sweep would quietly check fewer.
        expect(res.ok, `${mode} ${f.key}: ${res.reason ?? ""}`).toBe(true);
        built.push({ id: res.unitId!, kind: f.key });
        floor += f.floors;
      }
      const engine = engineFromSave(draft.saveText());
      const catalog = catalogOn(engine, mode);
      const cards = new Cards(engine, newViewReader(engine));
      for (const { id, kind } of built) {
        const stored = look(engine).tower.units.find((u) => u.id === id) as unknown as { kind: FacilityKind; rent?: number; noRate?: boolean };
        expect(cards.unit(id)!.price, `${mode} ${kind}`).toBe(unitPrice(catalog, stored));
        expect(cards.unit(id)!.price, `${mode} ${kind} charges something`).toBeGreaterThan(0);
      }
    });
  }
});
