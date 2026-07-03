import { describe, expect, it } from "vitest";
import { GRID } from "../engine/facilities";
import {
  STRUCTURE_BRUSH,
  announceForPlacement,
  brushTiles,
  clampTile,
  dragRunTiles,
  snapX,
  stepCursor,
} from "../ui/placement";

/** The placement helpers are pure functions of (kind, tile, floor) since the
 *  module split — these tests pin the geometry every gesture path (mouse,
 *  touch, keyboard cursor) funnels through, and the announce copy the
 *  screen-reader live region speaks, without booting the game shell. */
describe("placement helpers", () => {
  it("clampTile pins a column inside the lot", () => {
    expect(clampTile(-1)).toBe(0);
    expect(clampTile(0)).toBe(0);
    expect(clampTile(170)).toBe(170);
    expect(clampTile(GRID.width - 1)).toBe(GRID.width - 1);
    expect(clampTile(GRID.width)).toBe(GRID.width - 1);
  });

  it("snapX shifts a placement left so the facility fits the lot", () => {
    // Interior columns pass through untouched.
    expect(snapX("office", 100)).toBe(100);
    // A wide room near the right edge snaps to the last column it fits at
    // (office is 9 tiles wide), instead of failing the placement.
    expect(snapX("office", GRID.width - 1)).toBe(GRID.width - 9);
    expect(snapX("office", GRID.width - 9)).toBe(GRID.width - 9);
    // One-tile structures can reach the very last column.
    expect(snapX("floor", GRID.width - 1)).toBe(GRID.width - 1);
    // Off-lot input clamps at both ends.
    expect(snapX("office", -5)).toBe(0);
    expect(snapX("floor", GRID.width + 50)).toBe(GRID.width - 1);
  });

  it("brushTiles paints a fixed-size strip centered on the cursor", () => {
    expect(brushTiles(20)).toEqual([16, 17, 18, 19, 20, 21, 22, 23]);
    expect(brushTiles(20)).toHaveLength(STRUCTURE_BRUSH);
  });

  it("brushTiles clamps the strip at the lot edges (never off-lot tiles)", () => {
    // The strip still has STRUCTURE_BRUSH entries — edge tiles repeat, which
    // the painter tolerates (an already-built tile is skipped, not an error).
    expect(brushTiles(0)).toEqual([0, 0, 0, 0, 0, 1, 2, 3]);
    const last = GRID.width - 1;
    expect(brushTiles(last)).toEqual([last - 4, last - 3, last - 2, last - 1, last, last, last, last]);
  });

  it("dragRunTiles fills every column from the anchor to the pointer, in drag order", () => {
    expect(dragRunTiles(5, 8)).toEqual([6, 7, 8]);
    expect(dragRunTiles(8, 5)).toEqual([7, 6, 5]);
    // Pointer still on the anchor column: nothing new to fill.
    expect(dragRunTiles(5, 5)).toEqual([]);
  });

  it("dragRunTiles clamps a run that leaves the lot", () => {
    const last = GRID.width - 1;
    expect(dragRunTiles(last - 2, last + 2)).toEqual([last - 1, last, last, last]);
    expect(dragRunTiles(2, -3)).toEqual([1, 0, 0, 0, 0]);
  });

  it("stepCursor starts a fresh cursor at mid-lot on the ground floor", () => {
    expect(stepCursor(null, 0, 0)).toEqual({ tile: Math.floor(GRID.width / 2), floor: 1 });
    // The first press applies its delta too, like every later one.
    expect(stepCursor(null, 1, 1)).toEqual({ tile: Math.floor(GRID.width / 2) + 1, floor: 2 });
  });

  it("stepCursor clamps to the grid at all four bounds", () => {
    expect(stepCursor({ tile: 3, floor: 1 }, -10, 0)).toEqual({ tile: 0, floor: 1 });
    expect(stepCursor({ tile: GRID.width - 3, floor: 1 }, 10, 0)).toEqual({ tile: GRID.width - 1, floor: 1 });
    expect(stepCursor({ tile: 170, floor: GRID.maxFloor }, 0, 1)).toEqual({ tile: 170, floor: GRID.maxFloor });
    expect(stepCursor({ tile: 170, floor: GRID.minFloor }, 0, -1)).toEqual({ tile: 170, floor: GRID.minFloor });
  });

  it("announces paint outcomes, preferring the engine's reason", () => {
    expect(announceForPlacement({ what: "paint", ok: true }, "floor", 5)).toBe("Placed Floor on floor 5");
    // A refusal reason (no support, no money) passes through verbatim…
    expect(announceForPlacement({ what: "paint", ok: false, reason: "Not enough money." }, "floor", 5)).toBe(
      "Not enough money.",
    );
    // …including the already-built diagnosis paintBrush synthesizes.
    expect(
      announceForPlacement({ what: "paint", ok: false, reason: "Lobby already built here" }, "lobby", 1),
    ).toBe("Lobby already built here");
    // No reason at all still yields a spoken line, never silence.
    expect(announceForPlacement({ what: "paint", ok: false }, "lobby", 1)).toBe("Can't place Lobby here");
  });

  it("announces flight outcomes with the two-floor span", () => {
    expect(announceForPlacement({ what: "flight", ok: true, reason: "" }, "stairs", 3)).toBe(
      "Stairway built, floors 3 to 4",
    );
    expect(
      announceForPlacement({ what: "flight", ok: false, reason: "Escalator unlocks at 2★." }, "escalator", 3),
    ).toBe("Escalator unlocks at 2★.");
  });

  it("announces room outcomes", () => {
    expect(announceForPlacement({ what: "room", ok: true }, "office", 2)).toBe("Placed Office");
    expect(announceForPlacement({ what: "room", ok: false }, "office", 2)).toBe("Can't place Office here");
  });
});
