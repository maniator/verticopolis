import { describe, it, expect } from "vitest";
import { clampCameraY, SKY_HEADROOM_FLOORS } from "../cameraBounds";
import { FLOOR, TILE } from "../scale";
import {
  MAP_LINES_BELOW_LOWEST_FLOOR,
  blockRect,
  dragCenter,
  extentFloors,
  fitLayout,
  lineToMapY,
  mapExtent,
  mapPointToCenter,
  mapXToTile,
  mapYToLine,
  rectContains,
  sameRect,
  snappedBlock,
  tileToMapX,
  viewportRect,
  type MapCamera,
  type MapWorld,
} from "./geometry";

const WORLD: MapWorld = { lotWidth: 375, minFloor: -9, maxFloor: 100 };

function layoutFor(world: MapWorld = WORLD, w = 375, h = 330) {
  return fitLayout(mapExtent(world, SKY_HEADROOM_FLOORS), w, h);
}

describe("mapExtent", () => {
  it("spans the lot, the sky headroom above the top floor and the ground below the lowest", () => {
    const e = mapExtent(WORLD, SKY_HEADROOM_FLOORS);
    expect(e.leftTile).toBe(0);
    expect(e.width).toBe(375);
    expect(e.topLine).toBe(100 + SKY_HEADROOM_FLOORS);
    expect(e.bottomLine).toBe(-9 - MAP_LINES_BELOW_LOWEST_FLOOR);
    expect(extentFloors(e)).toBe(e.topLine - e.bottomLine);
  });

  it("stays finite and non-degenerate for bad input", () => {
    const e = mapExtent({ lotWidth: Number.NaN, minFloor: Number.NaN, maxFloor: Number.POSITIVE_INFINITY }, Number.NaN);
    expect(Number.isFinite(e.width) && e.width > 0).toBe(true);
    expect(Number.isFinite(e.topLine) && Number.isFinite(e.bottomLine)).toBe(true);
    expect(extentFloors(e)).toBeGreaterThanOrEqual(1);
  });

  it("never lets the top floor sit below the bottom floor", () => {
    const e = mapExtent({ lotWidth: 10, minFloor: 5, maxFloor: 1 }, 0);
    expect(e.topLine).toBeGreaterThanOrEqual(e.bottomLine);
  });
});

describe("fitLayout", () => {
  it("fills the box exactly with independent scales", () => {
    const l = layoutFor(WORLD, 300, 200);
    expect(l.width).toBe(300);
    expect(l.height).toBe(200);
    expect(l.pxPerTile * 375).toBeCloseTo(300);
    expect(l.pxPerFloor * extentFloors(l.extent)).toBeCloseTo(200);
  });

  it("falls back to a 1 pixel box for a bad box", () => {
    const l = fitLayout(mapExtent(WORLD, 0), 0, Number.NaN);
    expect(l.width).toBe(1);
    expect(l.height).toBe(1);
    expect(Number.isFinite(l.pxPerTile) && l.pxPerTile > 0).toBe(true);
    expect(Number.isFinite(l.pxPerFloor) && l.pxPerFloor > 0).toBe(true);
  });
});

describe("an extent with a margin beside the lot", () => {
  // Ten tiles of margin each side of the 375-tile lot, one map pixel per tile.
  const MARGIN = 10;
  const whole = mapExtent(WORLD, SKY_HEADROOM_FLOORS);
  const padded = fitLayout({ ...whole, leftTile: -MARGIN, width: 375 + 2 * MARGIN }, 375 + 2 * MARGIN, 330);

  it("puts the lot's first tile the margin in from the left edge, and maps back exactly", () => {
    expect(tileToMapX(padded, 0)).toBe(MARGIN);
    expect(tileToMapX(padded, 375)).toBe(375 + MARGIN);
    expect(tileToMapX(padded, -MARGIN)).toBe(0);
    for (const tile of [-MARGIN, -3.5, 0, 187.25, 375, 375 + MARGIN]) expect(mapXToTile(padded, tileToMapX(padded, tile))).toBeCloseTo(tile, 9);
    expect(blockRect(padded, 0, 9, 1).x).toBe(MARGIN);
    expect(snappedBlock(padded, 366, 9, 1, 1)!.x + 9).toBe(375 + MARGIN);
  });

  it("aims a point in the margin at a tile past the lot, and the map's edges at the margin's", () => {
    expect(mapPointToCenter(padded, 0, 100).tile).toBe(-MARGIN);
    expect(mapPointToCenter(padded, -50, 100).tile).toBe(-MARGIN);
    expect(mapPointToCenter(padded, padded.width + 50, 100).tile).toBe(375 + MARGIN);
    expect(mapPointToCenter(padded, MARGIN, 100).tile).toBe(0);
  });

  it("draws the part of a view that reaches into the margin, and clips it at the map's edge", () => {
    // A view 100 tiles wide centered on tile 0 shows 50 tiles of sky left of the lot, 10 of them on the map.
    const cam: MapCamera = { posX: 0, posY: -20 * FLOOR, zoom: 1, viewWidth: 100 * TILE, viewHeight: 14 * FLOOR };
    const r = viewportRect(padded, cam);
    expect(r.x).toBe(0);
    expect(r.w).toBeCloseTo(50 + MARGIN, 9);
    const right = viewportRect(padded, { ...cam, posX: 375 * TILE });
    expect(right.x).toBeCloseTo(375 + MARGIN - 50, 9);
    expect(right.x + right.w).toBeCloseTo(padded.width, 9);
  });

  it("lets a drag carry the view into the margin and no further", () => {
    const start = { tile: 5, floor: 20 };
    expect(dragCenter(padded, start, { x: 100, y: 100 }, { x: 80, y: 100 }).tile).toBe(-MARGIN);
    expect(dragCenter(padded, { tile: 370, floor: 20 }, { x: 100, y: 100 }, { x: 130, y: 100 }).tile).toBe(375 + MARGIN);
    // A start already past the margin is never pushed further out.
    expect(dragCenter(padded, { tile: -40, floor: 20 }, { x: 100, y: 100 }, { x: 90, y: 100 }).tile).toBe(-40);
  });
});

describe("world and map transforms", () => {
  const l = layoutFor();

  it("puts tile 0 at the left edge and the lot's last tile edge at the right", () => {
    expect(tileToMapX(l, 0)).toBe(0);
    expect(tileToMapX(l, 375)).toBeCloseTo(l.width);
  });

  it("puts the top line at y 0 and the bottom line at the map's bottom", () => {
    expect(lineToMapY(l, l.extent.topLine)).toBe(0);
    expect(lineToMapY(l, l.extent.bottomLine)).toBeCloseTo(l.height);
  });

  it("round-trips tiles and lines", () => {
    for (const t of [0, 1, 187.5, 374, 375]) expect(mapXToTile(l, tileToMapX(l, t))).toBeCloseTo(t);
    for (const f of [-11, -9, 0, 1, 50, 100, l.extent.topLine]) expect(mapYToLine(l, lineToMapY(l, f))).toBeCloseTo(f);
  });

  it("places the ground floor directly above B1 with no gap (basement origin)", () => {
    const ground = blockRect(l, 0, 10, 1);
    const b1 = blockRect(l, 0, 10, 0);
    expect(ground.y + ground.h).toBeCloseTo(b1.y);
    expect(b1.h).toBeCloseTo(l.pxPerFloor);
  });

  it("leaves one floor of ground under the deepest basement, as the camera clamp does", () => {
    const b10 = blockRect(l, 0, 1, -9);
    expect(b10.y + b10.h).toBeCloseTo(l.height - l.pxPerFloor);
  });

  it("sizes a multi-floor block from its lowest floor up", () => {
    const hall = blockRect(l, 100, 28, 100, 5);
    expect(hall.h).toBeCloseTo(5 * l.pxPerFloor);
    expect(hall.y).toBeCloseTo(lineToMapY(l, 104));
    expect(hall.w).toBeCloseTo(28 * l.pxPerTile);
  });

  it("treats a non-positive floor count as one floor and a bad width as zero", () => {
    expect(blockRect(l, 0, 4, 1, 0).h).toBeCloseTo(l.pxPerFloor);
    expect(blockRect(l, 0, Number.NaN, 1).w).toBe(0);
  });

  it("answers a finite value for non-finite input", () => {
    expect(Number.isFinite(tileToMapX(l, Number.NaN))).toBe(true);
    expect(Number.isFinite(lineToMapY(l, Number.POSITIVE_INFINITY))).toBe(true);
    expect(Number.isFinite(mapXToTile(l, Number.NaN))).toBe(true);
    expect(Number.isFinite(mapYToLine(l, Number.NaN))).toBe(true);
  });
});

describe("viewportRect", () => {
  const l = layoutFor();
  // A 1280x720 viewport at zoom 1 sees 128 tiles by 16 floors.
  const cam = (tile: number, floor: number, zoom = 1): MapCamera => ({
    posX: tile * TILE,
    posY: -floor * FLOOR,
    zoom,
    viewWidth: 1280,
    viewHeight: 720,
  });

  it("is centered on the camera and sized by the visible tiles and floors", () => {
    const r = viewportRect(l, cam(187, 50));
    expect(r.w).toBeCloseTo((1280 / TILE) * l.pxPerTile);
    expect(r.h).toBeCloseTo((720 / FLOOR) * l.pxPerFloor);
    expect(r.x + r.w / 2).toBeCloseTo(tileToMapX(l, 187));
    expect(r.y + r.h / 2).toBeCloseTo(lineToMapY(l, 50));
  });

  it("halves when the zoom doubles", () => {
    const a = viewportRect(l, cam(187, 50, 1));
    const b = viewportRect(l, cam(187, 50, 2));
    expect(b.w).toBeCloseTo(a.w / 2);
    expect(b.h).toBeCloseTo(a.h / 2);
  });

  it("is clipped to the map when the view is wider than the lot", () => {
    const r = viewportRect(l, { posX: 187 * TILE, posY: 0, zoom: 0.1, viewWidth: 1280, viewHeight: 720 });
    expect(r.x).toBe(0);
    expect(r.w).toBeCloseTo(l.width);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(l.height + 1e-9);
  });

  it("reads a non-positive or non-finite zoom as 1, and a bad viewport as empty", () => {
    expect(viewportRect(l, cam(187, 50, 0))).toEqual(viewportRect(l, cam(187, 50, 1)));
    expect(viewportRect(l, cam(187, 50, Number.NaN))).toEqual(viewportRect(l, cam(187, 50, 1)));
    const empty = viewportRect(l, { posX: 0, posY: 0, zoom: 1, viewWidth: Number.NaN, viewHeight: -5 });
    expect(empty.w).toBe(0);
    expect(empty.h).toBe(0);
  });

  it("stays on the map for every camera the renderer's vertical clamp allows, with nothing clipped away", () => {
    // Zooms where the whole view fits inside the tower's span (the clamp does not pin the ground).
    for (const floor of [-9, 0, 1, 25, 60, 100, 200, -50]) {
      for (const zoom of [0.2, 0.5, 1, 3]) {
        const y = clampCameraY(-floor * FLOOR, 720, zoom, FLOOR, WORLD.minFloor, WORLD.maxFloor);
        const r = viewportRect(l, { posX: 187 * TILE, posY: y, zoom, viewWidth: 1280, viewHeight: 720 });
        const fullHeight = (720 / zoom / FLOOR) * l.pxPerFloor;
        expect(r.h, `floor ${floor} zoom ${zoom}`).toBeCloseTo(fullHeight);
        expect(r.y).toBeGreaterThanOrEqual(-1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(l.height + 1e-9);
      }
    }
  });

  it("stays on the map when the clamp pins a very zoomed-out view to the ground", () => {
    const y = clampCameraY(0, 720, 0.05, FLOOR, WORLD.minFloor, WORLD.maxFloor);
    const r = viewportRect(l, { posX: 187 * TILE, posY: y, zoom: 0.05, viewWidth: 1280, viewHeight: 720 });
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(l.height + 1e-9);
    expect(r.h).toBeGreaterThan(0);
  });

  it("covers the whole map for a camera so far out that its half sizes would overflow", () => {
    const r = viewportRect(l, { posX: 187 * TILE, posY: -50 * FLOOR, zoom: 1e-310, viewWidth: 1e308, viewHeight: 1e308 });
    expect(r).toEqual({ x: 0, y: 0, w: l.width, h: l.height });
  });

  it("covers the whole map for a view taller than the world at the lowest saved zoom", () => {
    // 1700 px at zoom 0.06 is about 630 floors, far more than the world's span.
    const y = clampCameraY(-50 * FLOOR, 1700, 0.06, FLOOR, WORLD.minFloor, WORLD.maxFloor);
    const r = viewportRect(l, { posX: 187 * TILE, posY: y, zoom: 0.06, viewWidth: 1280, viewHeight: 1700 });
    expect(r.y).toBe(0);
    expect(r.h).toBeCloseTo(l.height, 9);
  });

  it("is unclipped vertically whenever the clamp leaves room (the rectangle is the whole view)", () => {
    const y = clampCameraY(-50 * FLOOR, 720, 1, FLOOR, WORLD.minFloor, WORLD.maxFloor);
    const r = viewportRect(l, { posX: 187 * TILE, posY: y, zoom: 1, viewWidth: 1280, viewHeight: 720 });
    expect(r.h).toBeCloseTo((720 / FLOOR) * l.pxPerFloor);
  });
});

describe("sameRect and rectContains", () => {
  it("compares within a tolerance, and null only equals null", () => {
    const a = { x: 1, y: 2, w: 3, h: 4 };
    expect(sameRect(a, { ...a, x: 1.005 })).toBe(true);
    expect(sameRect(a, { ...a, x: 1.6 })).toBe(false);
    expect(sameRect(a, { ...a, w: Number.NaN })).toBe(false);
    expect(sameRect(null, null)).toBe(true);
    expect(sameRect(a, null)).toBe(false);
  });

  it("includes the edges", () => {
    const r = { x: 10, y: 10, w: 20, h: 20 };
    expect(rectContains(r, 10, 10)).toBe(true);
    expect(rectContains(r, 30, 30)).toBe(true);
    expect(rectContains(r, 31, 20)).toBe(false);
  });
});

describe("map to camera", () => {
  const l = layoutFor();

  it("turns a map point into the camera center units the save stores", () => {
    const c = mapPointToCenter(l, tileToMapX(l, 100), lineToMapY(l, 40));
    expect(c.tile).toBeCloseTo(100);
    expect(c.floor).toBeCloseTo(40);
  });

  it("clamps a point beyond the map onto its edge", () => {
    const far = mapPointToCenter(l, -50, l.height + 50);
    expect(far.tile).toBe(0);
    expect(far.floor).toBeCloseTo(l.extent.bottomLine);
    const high = mapPointToCenter(l, l.width + 50, -50);
    expect(high.tile).toBeCloseTo(375);
    expect(high.floor).toBeCloseTo(l.extent.topLine);
  });

  it("answers the map's center for a non-finite point", () => {
    const c = mapPointToCenter(l, Number.NaN, Number.NaN);
    expect(c.tile).toBeCloseTo(187.5);
    expect(Number.isFinite(c.floor)).toBe(true);
  });

  it("round-trips with the camera's saved center", () => {
    const cam: MapCamera = { posX: 123 * TILE, posY: -37 * FLOOR, zoom: 1, viewWidth: 800, viewHeight: 600 };
    const r = viewportRect(l, cam);
    const c = mapPointToCenter(l, r.x + r.w / 2, r.y + r.h / 2);
    expect(c.tile).toBeCloseTo(cam.posX / TILE);
    expect(c.floor).toBeCloseTo(-cam.posY / FLOOR);
  });
});

describe("dragCenter", () => {
  const l = layoutFor();
  const start = { tile: 100, floor: 40 };

  it("does not move the camera until the pointer does", () => {
    const c = dragCenter(l, start, { x: 50, y: 60 }, { x: 50, y: 60 });
    expect(c).toEqual(start);
  });

  it("moves the center by the pointer's travel", () => {
    const c = dragCenter(l, start, { x: 50, y: 60 }, { x: 50 + l.pxPerTile * 10, y: 60 + l.pxPerFloor * 5 });
    expect(c.tile).toBeCloseTo(110);
    expect(c.floor).toBeCloseTo(35);
  });

  it("keeps the center on the map when dragged far past an edge", () => {
    const c = dragCenter(l, start, { x: 50, y: 60 }, { x: -9999, y: 9999 });
    expect(c.tile).toBe(0);
    expect(c.floor).toBeCloseTo(l.extent.bottomLine);
  });

  it("ignores a non-finite pointer", () => {
    expect(dragCenter(l, start, { x: 5, y: 5 }, { x: Number.NaN, y: Number.NaN })).toEqual(start);
  });
});

describe("snappedBlock", () => {
  const unit = fitLayout(mapExtent(WORLD, SKY_HEADROOM_FLOORS), 375, extentFloors(mapExtent(WORLD, SKY_HEADROOM_FLOORS)) * 3);

  it("snaps both edges of each axis to whole pixels", () => {
    const half = fitLayout(mapExtent(WORLD, SKY_HEADROOM_FLOORS), 250, 300);
    const r = snappedBlock(half, 10, 9, 20, 1)!;
    for (const n of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(n)).toBe(true);
  });

  it("gives neighbors that share an edge the same pixel on that edge", () => {
    const half = fitLayout(mapExtent(WORLD, SKY_HEADROOM_FLOORS), 250, 300);
    for (let x = 0; x < 360; x += 7) {
      const a = snappedBlock(half, x, 7, 10, 1)!;
      const b = snappedBlock(half, x + 7, 7, 10, 1)!;
      expect(a.x + a.w, `x ${x}`).toBe(b.x);
    }
  });

  it("is at least one pixel on each axis, and inside the map in the last column and row", () => {
    const tiny = fitLayout(mapExtent(WORLD, SKY_HEADROOM_FLOORS), 100, 100);
    const r = snappedBlock(tiny, 374, 1, -9, 1)!;
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
    expect(r.x + r.w).toBeLessThanOrEqual(100);
    expect(r.y + r.h).toBeLessThanOrEqual(100);
  });

  it("is null when a number is not finite, the block has no size, or it lies off the map", () => {
    expect(snappedBlock(unit, Number.NaN, 4, 1, 1)).toBeNull();
    expect(snappedBlock(unit, 0, Number.POSITIVE_INFINITY, 1, 1)).toBeNull();
    expect(snappedBlock(unit, 0, 4, Number.NaN, 1)).toBeNull();
    expect(snappedBlock(unit, 0, 4, 1, Number.NaN)).toBeNull();
    expect(snappedBlock(unit, 0, 0, 1, 1)).toBeNull();
    expect(snappedBlock(unit, 0, 4, 1, 0)).toBeNull();
    expect(snappedBlock(unit, 400, 4, 1, 1)).toBeNull();
    expect(snappedBlock(unit, -10, 4, 1, 1)).toBeNull();
    expect(snappedBlock(unit, 0, 4, 9999, 1)).toBeNull();
    expect(snappedBlock(unit, 0, 4, -9999, 1)).toBeNull();
  });

  it("clips a block that hangs over the edge", () => {
    const r = snappedBlock(unit, 370, 9, 5, 1)!;
    expect(r.x + r.w).toBe(375);
    const left = snappedBlock(unit, -5, 9, 5, 1)!;
    expect(left.x).toBe(0);
  });
});

describe("hardening", () => {
  it("fitLayout reads a hand-built extent with no width or an upside-down span as one unit", () => {
    const l = fitLayout({ leftTile: 0, width: 0, topLine: 3, bottomLine: 9 }, 100, 100);
    expect(Number.isFinite(l.pxPerTile) && l.pxPerTile > 0).toBe(true);
    expect(Number.isFinite(l.pxPerFloor) && l.pxPerFloor > 0).toBe(true);
    const nan = fitLayout({ leftTile: Number.NaN, width: Number.NaN, topLine: Number.NaN, bottomLine: 0 }, 100, 100);
    expect(Number.isFinite(nan.pxPerTile) && Number.isFinite(nan.pxPerFloor)).toBe(true);
    // A left edge that is not a number reads as tile 0, so the transforms stay finite.
    expect(nan.extent.leftTile).toBe(0);
    expect(tileToMapX(nan, 0)).toBe(0);
  });

  it("fitLayout reads a hand-built margin extent with a broken width as one tile from tile 0, never one tile of margin", () => {
    for (const width of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const l = fitLayout({ leftTile: -15, width, topLine: 30, bottomLine: -1 }, 100, 100);
      expect(l.extent.leftTile, String(width)).toBe(0);
      expect(l.extent.width, String(width)).toBe(1);
      expect(tileToMapX(l, 0), String(width)).toBe(0);
      expect(tileToMapX(l, 1), String(width)).toBe(100);
    }
    // A good width keeps its left edge.
    expect(fitLayout({ leftTile: -15, width: 405, topLine: 30, bottomLine: -1 }, 405, 31).extent.leftTile).toBe(-15);
  });

  it("aims an infinite pointer at the edge it points to, and NaN at the center", () => {
    const l = layoutFor();
    const high = mapPointToCenter(l, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
    expect(high.tile).toBeCloseTo(375);
    expect(high.floor).toBeCloseTo(l.extent.topLine);
    const low = mapPointToCenter(l, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
    expect(low.tile).toBe(0);
    expect(low.floor).toBeCloseTo(l.extent.bottomLine);
  });

  it("reads a non-finite grab as no travel on that axis instead of returning NaN", () => {
    const l = layoutFor();
    const start = { tile: 100, floor: 40 };
    const c = dragCenter(l, start, { x: Number.NaN, y: Number.NaN }, { x: 50, y: 50 });
    expect(c).toEqual(start);
    const d = dragCenter(l, start, { x: Number.NaN, y: 5 }, { x: 50, y: 5 + l.pxPerFloor * 2 });
    expect(d.tile).toBe(100);
    expect(d.floor).toBeCloseTo(38);
  });

  it("does not pull a start that lies outside the map in until the pointer moves it", () => {
    const l = layoutFor();
    const out = { tile: 100, floor: l.extent.topLine + 50 };
    const still = dragCenter(l, out, { x: 5, y: 5 }, { x: 5, y: 5 });
    expect(still.floor).toBeCloseTo(out.floor);
    // A sideways move leaves the floor alone; it does not snap onto the map.
    expect(dragCenter(l, out, { x: 5, y: 5 }, { x: 40, y: 5 }).floor).toBeCloseTo(out.floor);
    // Travel away from the map goes no further out than the start.
    expect(dragCenter(l, out, { x: 5, y: 50 }, { x: 5, y: 5 }).floor).toBeCloseTo(out.floor);
    // Travel toward the map moves the center by the travel.
    const down = dragCenter(l, out, { x: 5, y: 5 }, { x: 5, y: 5 + 10 * l.pxPerFloor });
    expect(down.floor).toBeCloseTo(out.floor - 10);
    // Once back on the map, the map's edges hold it as usual.
    expect(dragCenter(l, out, { x: 5, y: 0 }, { x: 5, y: 1e6 }).floor).toBeCloseTo(l.extent.bottomLine);
  });

  it("holds nothing in an empty rectangle", () => {
    expect(rectContains({ x: 10, y: 10, w: 0, h: 5 }, 10, 12)).toBe(false);
    expect(rectContains({ x: 10, y: 10, w: 5, h: 0 }, 12, 10)).toBe(false);
  });
});
