import { describe, it, expect } from "vitest";
import { newSeededGame } from "../fixtures/towerFixtures";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { AMUSEMENTS_SUBTYPES, FASTFOOD_SUBTYPES, FOODHALL_SUBTYPES, RESTAURANT_SUBTYPES, SHOP_SUBTYPES } from "../../engine/retailSubtypes";
import { AMUSEMENTS_LOOKS, FASTFOOD_LOOKS, FOODHALL_LOOKS, RESTAURANT_LOOKS, SHOP_LOOKS } from "../../render/pixelSprites";
import { buildTDT } from "../../storage/tdtExport";
import { parseTDT } from "../../storage/tdtImport";
import type { FacilityKind } from "../../engine/types";

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

// The Modern Food Hall's stalls carry the same "every variant is visually
// distinct" guarantee, but they are Modern-only content and so are deliberately
// NOT in the TDT round-trip loop below: a Modern tower is never exported to the
// 1994 .TDT format, so these stalls have no ordinal and never touch it.
describe("Modern Food Hall stall looks", () => {
  it("every stall has a look, and no look is orphaned", () => {
    expect(Object.keys(FOODHALL_LOOKS).sort()).toEqual([...FOODHALL_SUBTYPES].sort());
  });

  it("every stall look is visually distinct", () => {
    const seen = new Map<string, string>();
    const walls = new Set<string>();
    for (const name of FOODHALL_SUBTYPES) {
      const look = FOODHALL_LOOKS[name];
      const key = JSON.stringify(look);
      const clash = seen.get(key);
      expect(clash, `${name} and ${clash ?? "?"} share an identical look`).toBeUndefined();
      seen.set(key, name);
      walls.add(look.wall);
    }
    // Distinct WALL colors too, not just distinct objects: two stalls whose only
    // difference is an imperceptible field would still read as the same room.
    expect(walls.size, "two stalls share a wall color").toBe(FOODHALL_SUBTYPES.length);
  });
});

// The Modern Amusements attractions carry the same "every variant is visually
// distinct" guarantee, and like the Food Hall they are Modern-only and so are
// deliberately NOT in the TDT round-trip loop below: a Modern tower is never
// exported to the 1994 .TDT format, so these attractions have no ordinal.
describe("Modern Amusements attraction looks", () => {
  it("every attraction has a look, and no look is orphaned", () => {
    expect(Object.keys(AMUSEMENTS_LOOKS).sort()).toEqual([...AMUSEMENTS_SUBTYPES].sort());
  });

  it("every attraction look is visually distinct", () => {
    const seen = new Map<string, string>();
    const walls = new Set<string>();
    const attractions = new Set<string>();
    for (const name of AMUSEMENTS_SUBTYPES) {
      const look = AMUSEMENTS_LOOKS[name];
      const key = JSON.stringify(look);
      const clash = seen.get(key);
      expect(clash, `${name} and ${clash ?? "?"} share an identical look`).toBeUndefined();
      seen.set(key, name);
      walls.add(look.wall);
      attractions.add(look.attraction);
    }
    // Distinct WALL colors AND distinct interiors: each attraction draws its own
    // room, not just a recolor, so all four render unmistakably differently.
    expect(walls.size, "two attractions share a wall color").toBe(AMUSEMENTS_SUBTYPES.length);
    expect(attractions.size, "two attractions share an interior").toBe(AMUSEMENTS_SUBTYPES.length);
  });
});

describe("every canon subtype survives the TDT round-trip (visuals carry over)", () => {
  /** One Classic tower with a single retail unit of `kind`, ready to export. */
  function fixture(kind: FacilityKind): { sim: Simulation; unitId: number } {
    const sim = newSeededGame(3);
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
