import { describe, it, expect } from "vitest";
import { SKY_HEADROOM_FLOORS } from "../cameraBounds";
import { FLOOR, TILE } from "../scale";
import { dragCenter, fitLayout, mapExtent, mapPointToCenter, type MapCamera, type MapWorld } from "./geometry";
import { MAP_BAND_FLOORS, MAP_MIN_FLOORS, MAP_SIDE_MARGIN_SHARE, bandedExtent, edgeBand, mapSideMarginTiles, sameExtent, viewPlacement } from "./extent";

const WORLD: MapWorld = { lotWidth: 375, minFloor: -9, maxFloor: 100 };
const SKY = SKY_HEADROOM_FLOORS;
const built = (lowestFloor: number, highestFloor: number) => ({ lowestFloor, highestFloor });

/** A camera centered on a floor line, `floors` tall at zoom 1. */
function camAt(line: number, floors = 14, tiles = 100, tile = 187): MapCamera {
  return { posX: tile * TILE, posY: -line * FLOOR, zoom: 1, viewWidth: tiles * TILE, viewHeight: floors * FLOOR };
}

describe("bandedExtent (the banded crop)", () => {
  it("runs from one ground floor under the lowest floor to the top plus sky, rounded up to a band", () => {
    const e = bandedExtent(WORLD, built(-2, 45), SKY);
    expect(e.bottomLine).toBe(-4);
    expect(e.topLine % MAP_BAND_FLOORS).toBe(0);
    expect(e.topLine).toBeGreaterThanOrEqual(45 + SKY);
    expect(e.topLine - MAP_BAND_FLOORS).toBeLessThan(45 + SKY);
    expect(e.leftTile).toBe(-15);
    expect(e.width).toBe(375 + 2 * 15);
  });

  it("leaves a margin beside the lot on each side, a small share of its width in whole tiles", () => {
    expect(mapSideMarginTiles(375)).toBe(Math.ceil(375 * MAP_SIDE_MARGIN_SHARE));
    expect(mapSideMarginTiles(375)).toBe(15);
    expect(mapSideMarginTiles(100)).toBe(4);
    // A tiny lot still gets a tile on each side, and so does a width that is not a number.
    expect(mapSideMarginTiles(1)).toBe(1);
    for (const bad of [NaN, Infinity, 0, -5]) expect(mapSideMarginTiles(bad), String(bad)).toBe(1);
    for (const lotWidth of [1, 40, 375, 1000]) {
      const e = bandedExtent({ ...WORLD, lotWidth }, built(1, 30), SKY);
      const margin = mapSideMarginTiles(lotWidth);
      expect(e.leftTile, `lot ${lotWidth}`).toBe(-margin);
      // The lot sits in the middle: as much map past its right edge as before its left.
      expect(e.leftTile + e.width - lotWidth, `lot ${lotWidth}`).toBe(margin);
    }
    // A broken lot width reads as one tile, as the whole-world extent reads it.
    expect(bandedExtent({ ...WORLD, lotWidth: NaN }, built(1, 3), SKY)).toMatchObject({ leftTile: -1, width: 3 });
  });

  it("drops the margin for a lot so wide that it would take the width past a finite number", () => {
    const e = bandedExtent({ ...WORLD, lotWidth: Number.MAX_VALUE }, built(1, 3), SKY);
    expect(e.leftTile).toBe(0);
    expect(e.width).toBe(Number.MAX_VALUE);
    // `fitLayout` keeps it as it is, so the layout's extent and the model's key agree.
    expect(sameExtent(fitLayout(e, 100, 100).extent, e)).toBe(true);
  });

  it("reads an infinite lot width as one tile, so the extent stays finite", () => {
    const e = bandedExtent({ ...WORLD, lotWidth: Infinity }, built(1, 3), SKY);
    expect(Number.isFinite(e.width) && Number.isFinite(e.leftTile)).toBe(true);
    expect(sameExtent(fitLayout(e, 100, 100).extent, e)).toBe(true);
  });

  it("does not change its margin as the tower grows, so building never rescales the map across", () => {
    const widths = new Set<number>();
    for (let top = 1; top <= 100; top += 7) widths.add(bandedExtent(WORLD, built(1, top), SKY).width);
    expect([...widths]).toEqual([375 + 30]);
  });

  it("keeps the extent while the tower grows inside a band, and changes it when a band is crossed", () => {
    // With 7 floors of sky the top line is the tower's top plus 7, so going from
    // floor 43 to 44 takes it from line 50 to 51 and into the next band.
    expect(SKY).toBe(7);
    const crossings = [43, 53, 63];
    for (let top = 40; top < 70; top++) {
      const a = bandedExtent(WORLD, built(1, top), SKY);
      const b = bandedExtent(WORLD, built(1, top + 1), SKY);
      expect(sameExtent(a, b), `top ${top}`).toBe(!crossings.includes(top));
    }
    expect(bandedExtent(WORLD, built(1, 43), SKY).topLine).toBe(50);
    expect(bandedExtent(WORLD, built(1, 44), SKY).topLine).toBe(60);
  });

  it("is at least the minimum height for a small tower, with its top still on the band grid", () => {
    for (const [lo, hi] of [[1, 1], [1, 3], [1, 13], [0, 3], [-9, 1], [-9, 13]]) {
      const e = bandedExtent(WORLD, built(lo, hi), SKY);
      expect(e.topLine - e.bottomLine, `${lo}..${hi}`).toBeGreaterThanOrEqual(MAP_MIN_FLOORS);
      expect(e.topLine % MAP_BAND_FLOORS, `${lo}..${hi}`).toBe(0);
    }
  });

  it("does not rescale a small tower on every floor it adds", () => {
    const tops = new Set<number>();
    for (let hi = 1; hi <= 13; hi++) tops.add(bandedExtent(WORLD, built(1, hi), SKY).topLine);
    expect([...tops]).toEqual([30]);
  });

  it("includes basements: digging deeper moves the bottom and nothing else", () => {
    const shallow = bandedExtent(WORLD, built(1, 20), SKY);
    const deep = bandedExtent(WORLD, built(-9, 20), SKY);
    expect(deep.bottomLine).toBe(-11);
    expect(shallow.bottomLine).toBe(-1);
    expect(deep.topLine).toBe(shallow.topLine);
    expect(deep.width).toBe(shallow.width);
    // On a small tower too, where the minimum height holds the top up, down to B10.
    for (let lo = 1; lo >= -9; lo--) {
      expect(bandedExtent(WORLD, built(lo, 3), SKY).topLine, `lowest ${lo}`).toBe(bandedExtent(WORLD, built(1, 3), SKY).topLine);
    }
  });

  it("never goes past the world's top or bottom: a full tower spans the whole world's floors", () => {
    const whole = mapExtent(WORLD, SKY);
    for (const b of [built(-9, 100), built(-50, 400)]) {
      const e = bandedExtent(WORLD, b, SKY);
      expect({ topLine: e.topLine, bottomLine: e.bottomLine }).toEqual({ topLine: whole.topLine, bottomLine: whole.bottomLine });
    }
  });

  it("reads a missing or broken built range as a ground-floor tower", () => {
    const ground = bandedExtent(WORLD, built(1, 1), SKY);
    expect(sameExtent(bandedExtent(WORLD, null, SKY), ground)).toBe(true);
    expect(sameExtent(bandedExtent(WORLD, built(NaN, Infinity), SKY), ground)).toBe(true);
    expect(sameExtent(bandedExtent(WORLD, built(5, 2), SKY), bandedExtent(WORLD, built(5, 5), SKY))).toBe(true);
  });
});

describe("sameExtent", () => {
  it("tells extents apart by their left edge too", () => {
    const e = bandedExtent(WORLD, built(1, 3), SKY);
    expect(sameExtent(e, { ...e })).toBe(true);
    expect(sameExtent(e, { ...e, leftTile: 0 })).toBe(false);
    expect(sameExtent(e, { ...e, width: e.width + 1 })).toBe(false);
  });
});

describe("viewPlacement", () => {
  const crop = fitLayout(bandedExtent(WORLD, built(1, 30), SKY), 150, 300);

  it("is on the map and unclipped for a view inside the crop, and names its floor", () => {
    const p = viewPlacement(crop, camAt(12));
    expect(p.outside).toBe("none");
    expect(p.clipped).toBe(false);
    expect(p.rect.h).toBeGreaterThan(0);
    expect(p.centerFloor).toBe(12);
    expect(viewPlacement(crop, camAt(11.5)).centerFloor).toBe(12);
    expect(viewPlacement(crop, camAt(0.5)).centerFloor).toBe(1);
    expect(viewPlacement(crop, camAt(-0.5)).centerFloor).toBe(0);
  });

  it("clips a view that straddles the crop's top", () => {
    const top = crop.extent.topLine;
    const p = viewPlacement(crop, camAt(top));
    expect(p.outside).toBe("none");
    expect(p.clipped).toBe(true);
    expect(p.rect.y).toBe(0);
  });

  it("is outside, above, for a view wholly in the sky over the crop", () => {
    const p = viewPlacement(crop, camAt(95));
    expect(p.outside).toBe("above");
    expect(p.rect.h).toBe(0);
    expect(p.centerFloor).toBe(95);
  });

  it("clips a view at the margin's outer edges, not the lot's, and does not count the sides as clipped", () => {
    expect(crop.extent).toMatchObject({ leftTile: -15, width: 405 });
    // 100 tiles wide around tile 0: tiles -50 to 50, of which -15 to 50 are on the map.
    const left = viewPlacement(crop, camAt(12, 14, 100, 0));
    expect(left.rect.x).toBe(0);
    expect(left.rect.w).toBeCloseTo(65 * crop.pxPerTile, 9);
    expect(left.clipped).toBe(false);
    // And around the lot's last edge: tiles 325 to 390 are on the map.
    const right = viewPlacement(crop, camAt(12, 14, 100, 375));
    expect(right.rect.x).toBeCloseTo(340 * crop.pxPerTile, 9);
    expect(right.rect.x + right.rect.w).toBeCloseTo(crop.width, 9);
    expect(right.clipped).toBe(false);
  });

  it("is below when the whole view lies under the map", () => {
    expect(viewPlacement(crop, camAt(crop.extent.bottomLine - 20)).outside).toBe("below");
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
      const p = viewPlacement(crop, c);
      if (p.outside !== "none") expect(p.rect.h).toBe(0);
      if (p.rect.h > 0) expect(p.outside).toBe("none");
    }
    // And the converse, for views with a real height: no rectangle means outside.
    for (const line of [-40, -20, 0, 12, 29, 31, 40, 95]) {
      for (const zoom of [0.06, 0.25, 0.6, 1, 4]) {
        const p = viewPlacement(crop, { ...camAt(line), zoom });
        expect(p.outside !== "none", `line ${line} zoom ${zoom}`).toBe(p.rect.h === 0);
      }
    }
  });

  it("never leaves the view without a rectangle or a band, even a hair from an edge", () => {
    const small = fitLayout(bandedExtent(WORLD, built(1, 5), SKY), 400, 300);
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
    const p = viewPlacement(crop, { posX: 187 * TILE, posY: -89 * FLOOR, zoom: 0.1, viewWidth: 900, viewHeight: 900 });
    expect(p.outside).toBe("none");
    expect(p.rect.y).toBe(0);
    expect(p.rect.h).toBeCloseTo(crop.height, 5);
    // Zoomed out over the top: 80 floors around line 67 reach down to line 27,
    // so the rectangle is the crop from line 27 to its top.
    const q = viewPlacement(crop, { posX: 187 * TILE, posY: -67 * FLOOR, zoom: 0.25, viewWidth: 900, viewHeight: 80 * FLOOR * 0.25 });
    expect(q.outside).toBe("none");
    expect(q.rect.y).toBe(0);
    expect(q.rect.h).toBeCloseTo((crop.extent.topLine - 27) * crop.pxPerFloor, 5);
  });

  it("keeps a view thinner than float precision inside the map on the map", () => {
    const p = viewPlacement(crop, { ...camAt(12), posY: -12 * FLOOR + 0.3, viewHeight: 1e-14 });
    expect(p.outside).toBe("none");
    expect(p.clipped).toBe(false);
  });

  it("counts a view with no height sitting exactly on an edge line as on the map", () => {
    expect(viewPlacement(crop, { ...camAt(crop.extent.topLine), viewHeight: 0 }).outside).toBe("none");
    expect(viewPlacement(crop, { ...camAt(crop.extent.bottomLine), viewHeight: 0 }).outside).toBe("none");
    expect(viewPlacement(crop, { ...camAt(crop.extent.topLine + 1), viewHeight: 0 }).outside).toBe("above");
  });

  it("has no floor for a camera whose position is not a number", () => {
    expect(viewPlacement(crop, { ...camAt(12), posY: NaN }).centerFloor).toBeNull();
    expect(viewPlacement(crop, { ...camAt(12), posY: Infinity }).centerFloor).toBeNull();
  });
});

describe("map clicks and drags on the crop", () => {
  const crop = fitLayout(bandedExtent(WORLD, built(1, 30), SKY), 150, 300);
  const { topLine, bottomLine } = crop.extent;

  it("aims a click only inside the crop, even past its edges", () => {
    expect(mapPointToCenter(crop, 75, -50).floor).toBe(topLine);
    expect(mapPointToCenter(crop, 75, 1e6).floor).toBe(bottomLine);
    expect(mapPointToCenter(crop, 75, 0).floor).toBe(topLine);
    const mid = mapPointToCenter(crop, 75, 150);
    expect(mid.floor).toBeGreaterThan(bottomLine);
    expect(mid.floor).toBeLessThan(topLine);
  });

  it("aims a click in the margin beside the lot past the lot's edge, for the camera clamp to hold", () => {
    const margin = mapSideMarginTiles(WORLD.lotWidth);
    expect(mapPointToCenter(crop, 0, 150).tile).toBeCloseTo(-margin, 9);
    expect(mapPointToCenter(crop, crop.width, 150).tile).toBeCloseTo(WORLD.lotWidth + margin, 9);
    // The lot's edges are where its tiles land on the map, and back.
    const lotLeft = margin * crop.pxPerTile;
    expect(mapPointToCenter(crop, lotLeft, 150).tile).toBeCloseTo(0, 9);
    expect(mapPointToCenter(crop, crop.width - lotLeft, 150).tile).toBeCloseTo(WORLD.lotWidth, 9);
  });

  it("drags a rectangle clipped by the crop's top sideways without pulling it down", () => {
    const start = { tile: 187, floor: topLine + 3 };
    const moved = dragCenter(crop, start, { x: 75, y: 2 }, { x: 95, y: 2 });
    expect(moved.floor).toBe(start.floor);
    expect(moved.tile).toBeGreaterThan(start.tile);
  });
});

describe("edgeBand", () => {
  const crop = fitLayout(bandedExtent(WORLD, built(1, 30), SKY), 150, 300);

  it("is null for a view on the map", () => {
    expect(edgeBand(crop, viewPlacement(crop, camAt(12)), 4)).toBeNull();
  });

  it("sits on the top edge under the view's span for a view above the map", () => {
    const p = viewPlacement(crop, camAt(95));
    const band = edgeBand(crop, p, 4);
    expect(band).not.toBeNull();
    expect(band!.y).toBe(0);
    expect(band!.h).toBe(4);
    // The camera is 100 tiles wide around tile 187, measured from the map's left edge in the margin.
    expect(band!.x).toBeCloseTo((137 - crop.extent.leftTile) * crop.pxPerTile, 5);
    expect(band!.w).toBeCloseTo(100 * crop.pxPerTile, 5);
  });

  it("stays finite for a placement whose rectangle is not", () => {
    const p = viewPlacement(crop, camAt(95));
    const band = edgeBand(crop, { ...p, rect: { x: NaN, y: 0, w: NaN, h: 0 } }, 4)!;
    for (const v of [band.x, band.y, band.w, band.h]) expect(Number.isFinite(v)).toBe(true);
  });

  it("is at least a pixel each way for a thickness or width that is not a positive number", () => {
    const p = viewPlacement(crop, camAt(95));
    for (const t of [NaN, 0, -3, Infinity]) {
      const band = edgeBand(crop, p, t, t)!;
      for (const v of [band.x, band.y, band.w, band.h]) expect(Number.isFinite(v)).toBe(true);
      expect(band.h).toBeGreaterThanOrEqual(1);
      expect(band.w).toBeGreaterThanOrEqual(1);
    }
  });

  it("sits on the bottom edge for a view below, is never narrower than asked, and stays on the map", () => {
    const p = viewPlacement(crop, camAt(crop.extent.bottomLine - 20, 14, 2, 375));
    const band = edgeBand(crop, p, 4, 12)!;
    expect(band.y).toBe(crop.height - 4);
    expect(band.w).toBe(12);
    expect(band.x + band.w).toBeLessThanOrEqual(crop.width);
    expect(band.x).toBeGreaterThanOrEqual(0);
  });
});
