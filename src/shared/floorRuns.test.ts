import { describe, expect, it } from "vitest";
import { unfoldFloorRuns } from "./floorRuns";

describe("unfoldFloorRuns", () => {
  it("unfolds a run into its tiles in place and keeps the rest", () => {
    const office = { id: 9, kind: "office", floor: 2, x: 100 };
    const units = [office, { id: 43, kind: "floor", floor: 2, x: 167, run: 3 }, { id: 46, kind: "floor", floor: 2, x: 300 }];
    expect(unfoldFloorRuns(units)).toEqual([
      office,
      { id: 43, kind: "floor", floor: 2, x: 167 },
      { id: 44, kind: "floor", floor: 2, x: 168 },
      { id: 45, kind: "floor", floor: 2, x: 169 },
      { id: 46, kind: "floor", floor: 2, x: 300 },
    ]);
  });

  it("hands back the same list when nothing is folded", () => {
    const units = [{ id: 1, kind: "lobby", floor: 1, x: 90, run: 4 }, { id: 2, kind: "floor", floor: 2, x: 90, run: 1 }];
    expect(unfoldFloorRuns(units)).toBe(units);
  });

  it("reads a run that is not a whole number of 2 or more as one tile", () => {
    for (const run of [0, 1, -3, 2.5]) {
      const units = [{ id: 5, kind: "floor", floor: 3, x: 10, run }];
      expect(unfoldFloorRuns(units)).toHaveLength(1);
    }
  });
});
