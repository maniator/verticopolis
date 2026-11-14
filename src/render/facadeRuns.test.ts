import { describe, it, expect } from "vitest";
import { facadeGeometry } from "./facadeGeometry";
import { lobbyHalls } from "./lobbyHalls";
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

/**
 * A tall lobby hall (#308) rises through the stories above its floor, and the
 * fire escapes climb past them the way they climb past a normal floor. The
 * catalog gives every lobby one story, so the hall's height comes from the
 * engine's `lobbyHeights()` quads (`[floor, x0, x1, height]`).
 */
describe("the facade's runs beside a tall lobby hall", () => {
  it("hangs escapes on every raised story of a 3-story sky lobby", () => {
    const units = [...tiles(29, 100, 139), ...tiles(30, 100, 139, "lobby"), ...tiles(33, 100, 139)];
    const { runs } = facadeGeometry(units, 33, MODERN, lobbyHalls([30, 100, 139, 3]));
    for (const f of [30, 31, 32]) expect(runs.get(f)).toEqual([{ min: 100, max: 140 }]);
    expect(runs.get(33)).toEqual([{ min: 100, max: 140 }]);
  });

  it("raises only the hall's own columns in a split tower", () => {
    // Floor 45: a 2-story hall on the left tower, a 3-story hall in the
    // middle tower, and a one-story lobby on the right tower.
    const units = [...tiles(45, 10, 29, "lobby"), ...tiles(45, 50, 89, "lobby"), ...tiles(45, 120, 139, "lobby")];
    const { runs } = facadeGeometry(units, 47, MODERN, lobbyHalls([45, 10, 29, 2, 45, 50, 89, 3]));
    expect(runs.get(45)).toEqual([
      { min: 10, max: 30 },
      { min: 50, max: 90 },
      { min: 120, max: 140 },
    ]);
    expect(runs.get(46)).toEqual([
      { min: 10, max: 30 },
      { min: 50, max: 90 },
    ]);
    expect(runs.get(47)).toEqual([{ min: 50, max: 90 }]);
  });

  it("hangs escapes on the side of a taller hall that stands past a shorter one", () => {
    // A 3-story hall joined to a one-story hall: the raised stories end at
    // the tall hall's own edge, where the revolving-door wall stands.
    const units = [...tiles(30, 100, 119, "lobby"), ...tiles(30, 120, 139, "lobby")];
    const { runs } = facadeGeometry(units, 32, MODERN, lobbyHalls([30, 120, 139, 3]));
    expect(runs.get(30)).toEqual([{ min: 100, max: 140 }]);
    expect(runs.get(31)).toEqual([{ min: 120, max: 140 }]);
    expect(runs.get(32)).toEqual([{ min: 120, max: 140 }]);
  });

  it("keeps a lobby one story when no tall hall covers it", () => {
    const { runs } = facadeGeometry(tiles(30, 100, 139, "lobby"), 30, MODERN);
    expect(runs.has(31)).toBe(false);
  });
});
