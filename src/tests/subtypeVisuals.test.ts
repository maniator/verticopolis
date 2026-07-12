import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";
import { FASTFOOD_SUBTYPES, RESTAURANT_SUBTYPES, SHOP_SUBTYPES } from "../engine/retailSubtypes";
import { FASTFOOD_LOOKS, RESTAURANT_LOOKS, SHOP_LOOKS } from "../render/pixelSprites";
import { buildTDT } from "../storage/tdtExport";
import { parseTDT } from "../storage/tdtImport";
import type { FacilityKind } from "../engine/types";

/**
 * Guards the retail-subtype visual system:
 *   - Every canon variant name has its own look entry (and no look entry
 *     names a variant that does not exist), so a new canon name cannot ship
 *     without art and a typo cannot orphan an entry.
 *   - Within a kind, every look is distinct: "different visuals for every
 *     different type" is the feature, so two variants collapsing onto the
 *     same colors is a regression even though nothing crashes.
 *   - The look is a pure function of `Unit.subtype`, which round-trips
 *     through the TDT variant byte; the exhaustive loop below proves every
 *     canon variant survives export -> import, which is exactly the claim
 *     that the visuals carry over into the 1994 save format and back.
 */

const KINDS: [FacilityKind, readonly string[], Record<string, unknown>][] = [
  ["fastFood", FASTFOOD_SUBTYPES, FASTFOOD_LOOKS],
  ["restaurant", RESTAURANT_SUBTYPES, RESTAURANT_LOOKS],
  ["shop", SHOP_SUBTYPES, SHOP_LOOKS],
];

describe("retail subtype look tables", () => {
  for (const [kind, names, looks] of KINDS) {
    it(`${kind}: every canon variant has a look, and no look is orphaned`, () => {
      expect(Object.keys(looks).sort()).toEqual([...names].sort());
    });

    it(`${kind}: every variant look is visually distinct`, () => {
      const seen = new Map<string, string>();
      for (const name of names) {
        const key = JSON.stringify(looks[name]);
        const clash = seen.get(key);
        expect(clash, `${name} and ${clash ?? "?"} share an identical look`).toBeUndefined();
        seen.set(key, name);
      }
    });
  }
});

describe("every canon subtype survives the TDT round-trip (visuals carry over)", () => {
  /** One Classic tower with a single retail unit of `kind`, ready to export. */
  function fixture(kind: FacilityKind): { sim: Simulation; unitId: number } {
    const sim = Simulation.newGame(3);
    sim.money = 1e12;
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0 + 30, 1, 2);
    const r = sim.tower.place(kind, 2, x0)!;
    return { sim, unitId: r.unitId! };
  }

  for (const [kind, names] of KINDS) {
    it(`${kind}: all ${names.length} canon variants round-trip through export and import`, () => {
      const { sim, unitId } = fixture(kind);
      for (const name of names) {
        sim.tower.getUnit(unitId)!.subtype = name;
        const { bytes } = buildTDT(sim.serialize());
        const back = parseTDT(bytes.buffer as ArrayBuffer, "R.TDT").save;
        const unit = back.units.find((u) => u.kind === kind);
        expect(unit?.subtype, `${kind} variant "${name}" lost in round-trip`).toBe(name);
      }
    });
  }
});
