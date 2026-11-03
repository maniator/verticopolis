import { describe, it, expect } from "vitest";
import { SKY_HEADROOM_FLOORS } from "../cameraBounds";
import { FLOOR, TILE } from "../scale";
import { dragCenter, fitLayout, mapExtent, mapPointToCenter, type MapCamera, type MapWorld } from "./geometry";
import {
  CLASSIC_BODY_CSS,
  MODERN_BAND_FLOORS,
  MODERN_MIN_FLOORS,
  edgeBand,
  modernExtent,
  sameExtent,
  themeExtent,
  viewPlacement,
} from "./extent";

const WORLD: MapWorld = { lotWidth: 375, minFloor: -9, maxFloor: 100 };
const SKY = SKY_HEADROOM_FLOORS;
const built = (lowestFloor: number, highestFloor: number) => ({ lowestFloor, highestFloor });

/** A camera centered on a floor line, `floors` tall at zoom 1. */
function camAt(line: number, floors = 14, tiles = 100, tile = 187): MapCamera {
  return { posX: tile * TILE, posY: -line * FLOOR, zoom: 1, viewWidth: tiles * TILE, viewHeight: floors * FLOOR };
}

describe("modernExtent (the banded crop)", () => {
  it("runs from one ground floor under the lowest floor to the top plus sky, rounded up to a band", () => {
    const e = modernExtent(WORLD, built(-2, 45), SKY);
    expect(e.bottomLine).toBe(-4);
    expect(e.topLine % MODERN_BAND_FLOORS).toBe(0);
    expect(e.topLine).toBeGreaterThanOrEqual(45 + SKY);
    expect(e.topLine - MODERN_BAND_FLOORS).toBeLessThan(45 + SKY);
    expect(e.width).toBe(375);
  });

  it("keeps the extent while the tower grows inside a band, and changes it when a band is crossed", () => {
    // With 7 floors of sky the top line is the tower's top plus 7, so going from
    // floor 43 to 44 takes it from line 50 to 51 and into the next band.
    expect(SKY).toBe(7);
    const crossings = [43, 53, 63];
    for (let top = 40; top < 70; top++) {
      const a = modernExtent(WORLD, built(1, top), SKY);
      const b = modernExtent(WORLD, built(1, top + 1), SKY);
      expect(sameExtent(a, b), `top ${top}`).toBe(!crossings.includes(top));
    }
    expect(modernExtent(WORLD, built(1, 43), SKY).topLine).toBe(50);
    expect(modernExtent(WORLD, built(1, 44), SKY).topLine).toBe(60);
  });

  it("is at least the minimum height for a small tower, with its top still on the band grid", () => {
    for (const [lo, hi] of [[1, 1], [1, 3], [1, 13], [0, 3], [-9, 1], [-9, 13]]) {
      const e = modernExtent(WORLD, built(lo, hi), SKY);
      expect(e.topLine - e.bottomLine, `${lo}..${hi}`).toBeGreaterThanOrEqual(MODERN_MIN_FLOORS);
      expect(e.topLine % MODERN_BAND_FLOORS, `${lo}..${hi}`).toBe(0);
    }
  });

  it("does not rescale a small tower on every floor it adds", () => {
    const tops = new Set<number>();
    for (let hi = 1; hi <= 13; hi++) tops.add(modernExtent(WORLD, built(1, hi), SKY).topLine);
    expect([...tops]).toEqual([30]);
  });

  it("includes basements: digging deeper moves the bottom and nothing else", () => {
    const shallow = modernExtent(WORLD, built(1, 20), SKY);
    const deep = modernExtent(WORLD, built(-9, 20), SKY);
    expect(deep.bottomLine).toBe(-11);
    expect(shallow.bottomLine).toBe(-1);
    expect(deep.topLine).toBe(shallow.topLine);
    expect(deep.width).toBe(shallow.width);
    // On a small tower too, where the minimum height holds the top up, down to B10.
    for (let lo = 1; lo >= -9; lo--) {
      expect(modernExtent(WORLD, built(lo, 3), SKY).topLine, `lowest ${lo}`).toBe(modernExtent(WORLD, built(1, 3), SKY).topLine);
    }
  });

  it("never goes past the world, and a full tower matches the Classic span", () => {
    const full = modernExtent(WORLD, built(-9, 100), SKY);
    expect(sameExtent(full, mapExtent(WORLD, SKY))).toBe(true);
    const beyond = modernExtent(WORLD, built(-50, 400), SKY);
    expect(sameExtent(beyond, mapExtent(WORLD, SKY))).toBe(true);
  });

  it("reads a missing or broken built range as a ground-floor tower", () => {
    const ground = modernExtent(WORLD, built(1, 1), SKY);
    expect(sameExtent(modernExtent(WORLD, null, SKY), ground)).toBe(true);
    expect(sameExtent(modernExtent(WORLD, built(NaN, Infinity), SKY), ground)).toBe(true);
    expect(sameExtent(modernExtent(WORLD, built(5, 2), SKY), modernExtent(WORLD, built(5, 5), SKY))).toBe(true);
  });
});

describe("themeExtent", () => {
  it("gives Classic the whole world whatever is built, and Modern the crop", () => {
    for (const b of [null, built(1, 3), built(-9, 100)]) {
      expect(sameExtent(themeExtent("classic", WORLD, b, SKY), mapExtent(WORLD, SKY))).toBe(true);
    }
    expect(sameExtent(themeExtent("modern", WORLD, built(1, 3), SKY), modernExtent(WORLD, built(1, 3), SKY))).toBe(true);
  });

  it("puts the Classic world close to the retail scale in the retail body (the clamp's span sets it)", () => {
    const layout = fitLayout(mapExtent(WORLD, SKY), CLASSIC_BODY_CSS.width, CLASSIC_BODY_CSS.height);
    expect(layout.pxPerTile).toBeCloseTo(8 / 15, 5);
    expect(layout.pxPerFloor).toBeGreaterThan(2.3);
    expect(layout.pxPerFloor).toBeLessThan(2.6);
  });
});

describe("viewPlacement", () => {
  const modern = fitLayout(modernExtent(WORLD, built(1, 30), SKY), 150, 300);

  it("is on the map and unclipped for a view inside the crop, and names its floor", () => {
    const p = viewPlacement(modern, camAt(12));
    expect(p.outside).toBe("none");
    expect(p.clipped).toBe(false);
    expect(p.rect.h).toBeGreaterThan(0);
    expect(p.centerFloor).toBe(12);
    expect(viewPlacement(modern, camAt(11.5)).centerFloor).toBe(12);
    expect(viewPlacement(modern, camAt(0.5)).centerFloor).toBe(1);
    expect(viewPlacement(modern, camAt(-0.5)).centerFloor).toBe(0);
  });

  it("clips a view that straddles the crop's top", () => {
    const top = modern.extent.topLine;
    const p = viewPlacement(modern, camAt(top));
    expect(p.outside).toBe("none");
    expect(p.clipped).toBe(true);
    expect(p.rect.y).toBe(0);
  });

  it("is outside, above, for a view wholly in the sky over the crop", () => {
    const p = viewPlacement(modern, camAt(95));
    expect(p.outside).toBe("above");
    expect(p.rect.h).toBe(0);
    expect(p.centerFloor).toBe(95);
  });

  it("is never outside on the Classic map, even at the clamp's edges", () => {
    const classic = fitLayout(mapExtent(WORLD, SKY), 200, 288);
    const e = classic.extent;
    for (const line of [e.topLine - 7, e.bottomLine + 7]) {
      expect(viewPlacement(classic, camAt(line)).outside).toBe("none");
    }
  });

  it("is below when the whole view lies under the map", () => {
    expect(viewPlacement(modern, camAt(modern.extent.bottomLine - 20)).outside).toBe("below");
  });

  it("agrees with its rectangle for a broken camera: outside exactly when the rectangle has no height", () => {
    const cams: MapCamera[] = [
      { ...camAt(12), zoom: NaN },
      { ...camAt(12), zoom: -2 },
      { ...camAt(12), posY: NaN },
      { ...camAt(12), viewHeight: NaN },
      { ...camAt(12), viewHeight: -100 },
      { ...camAt(95), zoom: 0 },
      { ...camAt(95), zoom: 1e-9 },
    ];
    for (const c of cams) {
      const p = viewPlacement(modern, c);
      if (p.outside !== "none") expect(p.rect.h).toBe(0);
      if (p.rect.h > 0) expect(p.outside).toBe("none");
    }
    // And the converse, for views with a real height: no rectangle means outside.
    for (const line of [-40, -20, 0, 12, 29, 31, 40, 95]) {
      for (const zoom of [0.06, 0.25, 0.6, 1, 4]) {
        const p = viewPlacement(modern, { ...camAt(line), zoom });
        expect(p.outside !== "none", `line ${line} zoom ${zoom}`).toBe(p.rect.h === 0);
      }
    }
  });

  it("never leaves the view without a rectangle or a band, even a hair from an edge", () => {
    const small = fitLayout(modernExtent(WORLD, built(1, 5), SKY), 400, 300);
    const p = viewPlacement(small, { posX: 1870, posY: -1651.3186420006434, zoom: 0.7002553794847827, viewWidth: 900, viewHeight: 422 });
    expect(p.rect.h > 0 || edgeBand(small, p, 4) !== null).toBe(true);
    for (let zoom = 0.25; zoom <= 4; zoom *= 2) {
      for (let h = 300; h <= 1600; h += 50) {
        const half = h / 2 / zoom;
        for (const line of [small.extent.topLine, small.extent.bottomLine]) {
          for (const posY of [-line * FLOOR - half, -line * FLOOR + half]) {
            const q = viewPlacement(small, { posX: 1870, posY, zoom, viewWidth: 900, viewHeight: h });
            expect(q.outside !== "none", `zoom ${zoom} h ${h} posY ${posY}`).toBe(q.rect.h === 0);
          }
        }
      }
    }
  });

  it("covers the whole crop for a zoomed-out view taller than it", () => {
    // 900 px at zoom 0.1 shows 200 floors around line 89: all of this 41-floor crop (lines -1 to 40).
    const p = viewPlacement(modern, { posX: 187 * TILE, posY: -89 * FLOOR, zoom: 0.1, viewWidth: 900, viewHeight: 900 });
    expect(p.outside).toBe("none");
    expect(p.rect.y).toBe(0);
    expect(p.rect.h).toBeCloseTo(modern.height, 5);
    // Zoomed out over the top: 80 floors around line 67 reach down to line 27,
    // so the rectangle is the crop from line 27 to its top.
    const q = viewPlacement(modern, { posX: 187 * TILE, posY: -67 * FLOOR, zoom: 0.25, viewWidth: 900, viewHeight: 80 * FLOOR * 0.25 });
    expect(q.outside).toBe("none");
    expect(q.rect.y).toBe(0);
    expect(q.rect.h).toBeCloseTo((modern.extent.topLine - 27) * modern.pxPerFloor, 5);
  });

  it("keeps a view thinner than float precision inside the map on the map", () => {
    const p = viewPlacement(modern, { ...camAt(12), posY: -12 * FLOOR + 0.3, viewHeight: 1e-14 });
    expect(p.outside).toBe("none");
    expect(p.clipped).toBe(false);
  });

  it("counts a view with no height sitting exactly on an edge line as on the map", () => {
    expect(viewPlacement(modern, { ...camAt(modern.extent.topLine), viewHeight: 0 }).outside).toBe("none");
    expect(viewPlacement(modern, { ...camAt(modern.extent.bottomLine), viewHeight: 0 }).outside).toBe("none");
    expect(viewPlacement(modern, { ...camAt(modern.extent.topLine + 1), viewHeight: 0 }).outside).toBe("above");
  });

  it("has no floor for a camera whose position is not a number", () => {
    expect(viewPlacement(modern, { ...camAt(12), posY: NaN }).centerFloor).toBeNull();
    expect(viewPlacement(modern, { ...camAt(12), posY: Infinity }).centerFloor).toBeNull();
  });
});

describe("map clicks and drags on a Modern crop", () => {
  const modern = fitLayout(modernExtent(WORLD, built(1, 30), SKY), 150, 300);
  const { topLine, bottomLine } = modern.extent;

  it("aims a click only inside the crop, even past its edges", () => {
    expect(mapPointToCenter(modern, 75, -50).floor).toBe(topLine);
    expect(mapPointToCenter(modern, 75, 1e6).floor).toBe(bottomLine);
    expect(mapPointToCenter(modern, 75, 0).floor).toBe(topLine);
    const mid = mapPointToCenter(modern, 75, 150);
    expect(mid.floor).toBeGreaterThan(bottomLine);
    expect(mid.floor).toBeLessThan(topLine);
  });

  it("drags a rectangle clipped by the crop's top sideways without pulling it down", () => {
    const start = { tile: 187, floor: topLine + 3 };
    const moved = dragCenter(modern, start, { x: 75, y: 2 }, { x: 95, y: 2 });
    expect(moved.floor).toBe(start.floor);
    expect(moved.tile).toBeGreaterThan(start.tile);
  });
});

describe("edgeBand", () => {
  const modern = fitLayout(modernExtent(WORLD, built(1, 30), SKY), 150, 300);

  it("is null for a view on the map", () => {
    expect(edgeBand(modern, viewPlacement(modern, camAt(12)), 4)).toBeNull();
  });

  it("sits on the top edge under the view's span for a view above the map", () => {
    const p = viewPlacement(modern, camAt(95));
    const band = edgeBand(modern, p, 4);
    expect(band).not.toBeNull();
    expect(band!.y).toBe(0);
    expect(band!.h).toBe(4);
    // The camera is 100 tiles wide around tile 187.
    expect(band!.x).toBeCloseTo(137 * modern.pxPerTile, 5);
    expect(band!.w).toBeCloseTo(100 * modern.pxPerTile, 5);
  });

  it("stays finite for a placement whose rectangle is not", () => {
    const p = viewPlacement(modern, camAt(95));
    const band = edgeBand(modern, { ...p, rect: { x: NaN, y: 0, w: NaN, h: 0 } }, 4)!;
    for (const v of [band.x, band.y, band.w, band.h]) expect(Number.isFinite(v)).toBe(true);
  });

  it("is at least a pixel each way for a thickness or width that is not a positive number", () => {
    const p = viewPlacement(modern, camAt(95));
    for (const t of [NaN, 0, -3, Infinity]) {
      const band = edgeBand(modern, p, t, t)!;
      for (const v of [band.x, band.y, band.w, band.h]) expect(Number.isFinite(v)).toBe(true);
      expect(band.h).toBeGreaterThanOrEqual(1);
      expect(band.w).toBeGreaterThanOrEqual(1);
    }
  });

  it("sits on the bottom edge for a view below, is never narrower than asked, and stays on the map", () => {
    const p = viewPlacement(modern, camAt(modern.extent.bottomLine - 20, 14, 2, 375));
    const band = edgeBand(modern, p, 4, 12)!;
    expect(band.y).toBe(modern.height - 4);
    expect(band.w).toBe(12);
    expect(band.x + band.w).toBeLessThanOrEqual(modern.width);
    expect(band.x).toBeGreaterThanOrEqual(0);
  });
});
