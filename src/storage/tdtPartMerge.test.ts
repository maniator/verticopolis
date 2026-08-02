import { describe, expect, it } from "vitest";
import { mergeParts, type PartRecord } from "./tdtPartMerge";

/**
 * `mergeParts` is pure graph logic over a tower's multi-story parts, and the
 * defect it grew this guard for came from a real 1994 save: two recycling
 * centers built flush on B2 imported as ONE double-width center, losing a
 * building. The import path covers the same shape end to end, but the invariant
 * belongs at this tier too, where the cluster rules can be exercised directly.
 */
const part = (floor: number, left: number, right: number, typeId = 21): PartRecord => ({
  kind: "recycling",
  typeId,
  floor,
  left,
  right,
  construction: false,
});

describe("mergeParts", () => {
  it("keeps flush neighbors apart when a building below chains them together", () => {
    // B4 center at x 107 spans two stories, so its upper part overlaps BOTH of
    // the flush B2 centers one floor up. All six parts therefore land in one
    // cluster, and splitting that cluster by FLOOR alone left x 92 and x 112,
    // which never overlap each other, fused into a single 40-wide unit.
    const merged = mergeParts([
      part(-3, 107, 127),
      part(-2, 107, 127, 20),
      part(-1, 92, 112),
      part(0, 92, 112, 20),
      part(-1, 112, 132),
      part(0, 112, 132, 20),
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.map((m) => `${m.left}@${m.floor}`).sort()).toEqual(["107@-3", "112@-1", "92@-1"].sort());
    for (const m of merged) expect(m.right - m.left).toBe(20);
  });

  it("still merges one building's own stories", () => {
    const merged = mergeParts([part(-1, 92, 112), part(0, 92, 112, 20)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ floor: -1, topFloor: 0, left: 92, right: 112 });
  });

  it("anchors a merged unit at its LOWEST story whatever order the parts arrive in", () => {
    // The base floor is folded with min rather than taken from the first part,
    // so a caller that hands the upper story first cannot place the building a
    // floor off.
    const merged = mergeParts([part(0, 92, 112, 20), part(-1, 92, 112)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].floor).toBe(-1);
    expect(merged[0].topFloor).toBe(0);
  });

  it("keeps two same-kind buildings on far-apart floors separate", () => {
    const merged = mergeParts([part(-6, 100, 120), part(-5, 100, 120, 20), part(-3, 100, 120), part(-2, 100, 120, 20)]);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.floor).sort((a, b) => a - b)).toEqual([-6, -3]);
  });
});
