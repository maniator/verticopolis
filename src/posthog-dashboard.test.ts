import { describe, expect, it } from "vitest";
import {
  planAdditions,
  runSteps,
  bottomRow,
  buildInsights,
} from "../scripts/posthog-dashboard.mjs";

const tile = (
  name: string,
  sm?: { x: number; y: number; w: number; h: number },
  extra: object = {},
) => ({
  insight: { name },
  layouts: sm ? { sm } : {},
  ...extra,
});

describe("posthog-dashboard planAdditions (add-only sync)", () => {
  it("adds only the missing overview tiles, full width below the lowest tile, and leaves the rest alone", () => {
    const specs = [
      { name: "Kept as the owner made it", overview: true, query: null },
      { name: "New table", overview: true, query: null },
      { name: "Not for the overview", query: null },
    ];
    const tiles = [
      tile("Kept as the owner made it", { x: 0, y: 0, w: 6, h: 4 }),
      tile("Another of his", { x: 6, y: 4, w: 6, h: 3 }),
    ];
    const plan = planAdditions(specs, tiles, new Set());
    expect(plan.onDashboard).toEqual(["Kept as the owner made it"]);
    expect(plan.elsewhere).toEqual([]);
    expect(plan.add.map((a) => a.spec.name)).toEqual(["New table"]);
    expect(plan.add[0].layout).toEqual({ x: 0, y: 7, w: 12, h: 5 });
  });

  it("skips a tile whose name an insight elsewhere in the project already uses, so nothing is rewritten or doubled", () => {
    const plan = planAdditions(
      [{ name: "Used elsewhere", overview: true, query: null }],
      [],
      new Set(["Used elsewhere"]),
    );
    expect(plan.add).toEqual([]);
    expect(plan.elsewhere).toEqual(["Used elsewhere"]);
  });

  it("stacks several new tiles one under another, using a spec's own height", () => {
    const specs = [
      { name: "First", overview: true, height: 6, query: null },
      { name: "Second", overview: true, query: null },
    ];
    const plan = planAdditions(
      specs,
      [tile("His", { x: 0, y: 0, w: 12, h: 2 })],
      new Set(),
    );
    expect(plan.add.map((a) => a.layout)).toEqual([
      { x: 0, y: 2, w: 12, h: 6 },
      { x: 0, y: 8, w: 12, h: 5 },
    ]);
  });

  it("reads the bottom from laid-out, live tiles only", () => {
    const tiles = [
      tile("Placed", { x: 0, y: 10, w: 12, h: 4 }),
      tile("No box yet"),
      tile("Deleted", { x: 0, y: 40, w: 12, h: 4 }, { deleted: true }),
    ];
    expect(bottomRow(tiles)).toBe(14);
    expect(bottomRow([])).toBe(0);
  });

  it("never adds a tile an earlier run added, even after the owner renames it", () => {
    const specs = [
      {
        name: "Session FPS by tower size and speed",
        overview: true,
        shortId: "CvqJXbSp",
        query: null,
      },
    ];
    const renamed = [
      tile("FPS by tower size (renamed by the owner)", {
        x: 0,
        y: 0,
        w: 12,
        h: 5,
      }),
    ];
    const plan = planAdditions(specs, renamed, new Set());
    expect(plan.add).toEqual([]);
    expect(plan.added).toEqual(["Session FPS by tower size and speed"]);
  });

  it("offers only the tiles marked for the overview from the real spec list, never the full set", () => {
    const all = buildInsights({ newGame: 1 });
    const overview = all.filter((s) => s.overview);
    expect(overview.length).toBeLessThan(all.length);
    const fresh = overview.map((s) => ({ ...s, shortId: undefined }));
    const plan = planAdditions(
      [...all.filter((s) => !s.overview), ...fresh],
      [],
      new Set(),
    );
    expect(plan.add.map((a) => a.spec.name)).toEqual(
      overview.map((s) => s.name),
    );
    expect(plan.add.map((a) => a.spec.name)).toContain(
      "Session FPS by tower size and speed",
    );
    expect(plan.add.map((a) => a.spec.name)).toContain(
      "Engine cost per game hour by version, tower size and speed",
    );
  });

  it("adds nothing for the real spec list today, because both overview tiles carry the short id of the insight a run made", () => {
    const plan = planAdditions(buildInsights({ newGame: 1 }), [], new Set());
    expect(plan.add).toEqual([]);
    expect(plan.added).toEqual([
      "Session FPS by tower size and speed",
      "Engine cost per game hour by version, tower size and speed",
    ]);
  });

  it("lets --update-view rewrite the view on a run with no tile to add, and writes no tile or action then", () => {
    const plan = planAdditions(buildInsights({ newGame: 1 }), [], new Set());
    expect(plan.add).toEqual([]);
    expect(runSteps(plan, true)).toEqual({
      tiles: false,
      action: false,
      view: true,
    });
    expect(runSteps(plan, false)).toEqual({
      tiles: false,
      action: false,
      view: false,
    });
  });

  it("checks the action and the view whenever there is a tile to add", () => {
    const plan = planAdditions(
      [{ name: "New table", overview: true, query: null }],
      [],
      new Set(),
    );
    expect(runSteps(plan, false)).toEqual({
      tiles: true,
      action: true,
      view: true,
    });
  });
});
