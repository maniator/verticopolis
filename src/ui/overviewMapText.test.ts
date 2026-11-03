import { describe, it, expect } from "vitest";
import { SKY_HEADROOM_FLOORS } from "../render/cameraBounds";
import { FLOOR, TILE } from "../render/scale";
import { modernExtent, viewPlacement } from "../render/overviewMap/extent";
import { fitLayout } from "../render/overviewMap/geometry";
import { builtFloorCounts, mapSummary, viewSentence } from "./overviewMapText";

const on = (centerFloor: number) => ({ outside: "none" as const, centerFloor });

describe("builtFloorCounts", () => {
  it("counts floor 1 up as above ground and floor 0 down as basements", () => {
    expect(builtFloorCounts({ lowestFloor: 1, highestFloor: 1 })).toEqual({ above: 1, basements: 0 });
    expect(builtFloorCounts({ lowestFloor: -2, highestFloor: 42 })).toEqual({ above: 42, basements: 3 });
    expect(builtFloorCounts({ lowestFloor: 0, highestFloor: 0 })).toEqual({ above: 0, basements: 1 });
  });

  it("reads a range that is not finite as the ground floor, as the map does", () => {
    expect(builtFloorCounts({ lowestFloor: NaN, highestFloor: Infinity })).toEqual({ above: 1, basements: 0 });
  });

  it("reads a top under the bottom as the bottom, and counts a basement-only range", () => {
    expect(builtFloorCounts({ lowestFloor: 5, highestFloor: 2 })).toEqual({ above: 1, basements: 0 });
    expect(builtFloorCounts({ lowestFloor: -3, highestFloor: -1 })).toEqual({ above: 0, basements: 3 });
    // A top that is not finite reads as the lowest floor, as the crop reads it.
    expect(builtFloorCounts({ lowestFloor: -5, highestFloor: NaN })).toEqual({ above: 0, basements: 1 });
    // Only the floors in the range count.
    expect(builtFloorCounts({ lowestFloor: 5, highestFloor: 5 })).toEqual({ above: 1, basements: 0 });
  });
});

const TOWER = { lowestFloor: -9, highestFloor: 40 };

describe("viewSentence", () => {
  it("names the floor with the basement grammar", () => {
    expect(viewSentence(on(12), TOWER)).toBe("The view is at floor 12.");
    expect(viewSentence(on(0), TOWER)).toBe("The view is at floor B1.");
  });

  it("names the sky above the top floor and the ground below the lowest instead of floors that do not exist", () => {
    expect(viewSentence(on(46), TOWER)).toBe("The view is above the top floor, 40.");
    expect(viewSentence(on(-10), TOWER)).toBe("The view is below the lowest floor, B10.");
  });

  it("says when the view is past the map's edge", () => {
    expect(viewSentence({ outside: "above", centerFloor: 87 }, TOWER)).toBe("The view is above the top floor, 40, past the top of the map.");
    expect(viewSentence({ outside: "below", centerFloor: -9 }, TOWER)).toBe("The view is at floor B10, past the bottom of the map.");
  });

  it("says nothing for a camera whose position is unknown", () => {
    expect(viewSentence({ outside: "none", centerFloor: null }, TOWER)).toBe("");
  });
});

describe("mapSummary", () => {
  it("gives the tower's size, then where the view is", () => {
    expect(mapSummary({ lowestFloor: -2, highestFloor: 42 }, on(12))).toBe(
      "Tower map: 42 floors above ground and 3 basements. The view is at floor 12.",
    );
    expect(mapSummary({ lowestFloor: 1, highestFloor: 1 }, on(1))).toBe("Tower map: 1 floor above ground. The view is at floor 1.");
    expect(mapSummary({ lowestFloor: 0, highestFloor: 5 }, on(3))).toBe(
      "Tower map: 5 floors above ground and 1 basement. The view is at floor 3.",
    );
    expect(mapSummary({ lowestFloor: 1, highestFloor: 5 }, { outside: "none", centerFloor: null })).toBe("Tower map: 5 floors above ground.");
  });

  it("reports the camera's floor from a real placement above a Modern crop", () => {
    const built = { lowestFloor: 1, highestFloor: 30 };
    const layout = fitLayout(modernExtent({ lotWidth: 375, minFloor: -9, maxFloor: 100 }, built, SKY_HEADROOM_FLOORS), 150, 300);
    const p = viewPlacement(layout, { posX: 187 * TILE, posY: -95.5 * FLOOR, zoom: 1, viewWidth: 1000, viewHeight: 14 * FLOOR });
    expect(p.outside).toBe("above");
    expect(mapSummary(built, p)).toBe("Tower map: 30 floors above ground. The view is above the top floor, 30, past the top of the map.");
  });
});
