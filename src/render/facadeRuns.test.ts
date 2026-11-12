import { describe, it, expect } from "vitest";
import { facadeGeometry } from "./facadeGeometry";
import { catalogFor } from "../tests/catalogFixture";
import type { FacilityKind, Unit } from "../shared/types";

const MODERN = catalogFor("modern");

/** One unit per tile from `lo` to `hi` on `floor`. Only the fields
 *  facadeGeometry reads are set. */
function tiles(floor: number, lo: number, hi: number, kind: FacilityKind = "floor"): Unit[] {
  const out: Unit[] = [];
  for (let x = lo; x <= hi; x++) out.push({ floor, x, width: 1, kind } as unknown as Unit);
  return out;
}

/**
 * Each tower on a lot hangs fire escapes on both of its sides. Security walks
 * them during a bomb search, so a tower standing apart from its neighbors
 * needs its own, and not only the floor's leftmost and rightmost edges.
 */
describe("the facade's runs: one per tower on each floor", () => {
  it("gives each tower standing apart its own run, left to right", () => {
    const units = [...tiles(5, 200, 239), ...tiles(5, 100, 139), ...tiles(5, 300, 339)];
    const { runs, edges } = facadeGeometry(units, 5, MODERN);
    expect(runs.get(5)).toEqual([
      { min: 100, max: 140 },
      { min: 200, max: 240 },
      { min: 300, max: 340 },
    ]);
    // The floor's outer edges are unchanged.
    expect(edges.get(5)).toEqual({ min: 100, max: 340 });
  });

  it("joins tiles that touch, and rooms standing on them, into one run", () => {
    const units = [...tiles(3, 100, 119), ...tiles(3, 120, 139), { floor: 3, x: 110, width: 9, kind: "office" } as unknown as Unit];
    expect(facadeGeometry(units, 3, MODERN).runs.get(3)).toEqual([{ min: 100, max: 140 }]);
  });

  it("splits a floor where a gap of one tile opens", () => {
    const units = [...tiles(2, 100, 119), ...tiles(2, 121, 139)];
    expect(facadeGeometry(units, 2, MODERN).runs.get(2)).toEqual([
      { min: 100, max: 120 },
      { min: 121, max: 140 },
    ]);
  });
});
