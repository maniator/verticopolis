import { describe, it, expect } from "vitest";
import { FLOOR, TILE } from "../render/scale";
import { fitLayout, mapPointToCenter, rectContains, tileToMapX, viewportRect, type MapCamera, type MapExtent } from "../render/overviewMap/geometry";
import { cameraCenter, clientToMap, grabRect, isKeyboardClick, isPrimaryPress, keyTarget, MAP_KEY, MAP_KEY_STEP_SHARE, noButtonHeld, passesMapKey } from "./overviewMapInput";

const EXTENT: MapExtent = { leftTile: 0, width: 375, topLine: 107, bottomLine: -11 };
/** A camera centered on tile 100, floor 20, seeing 80 tiles by 16 floors. */
const CAM: MapCamera = { posX: 100 * TILE, posY: -20 * FLOOR, zoom: 2, viewWidth: 160 * TILE, viewHeight: 32 * FLOOR };

describe("overview map pointer rules", () => {
  it("scales a pointer from CSS pixels to the backing store", () => {
    const box = { left: 10, top: 20, width: 200, height: 288 };
    expect(clientToMap(box, { width: 400, height: 576 }, 110, 164)).toEqual({ x: 200, y: 288 });
  });

  it("reads a canvas with no box yet as a scale of 1, never NaN", () => {
    expect(clientToMap({ left: 0, top: 0, width: 0, height: 0 }, { width: 400, height: 576 }, 5, 6)).toEqual({ x: 5, y: 6 });
  });

  it("grows a small view mark to a touch target about its center", () => {
    expect(grabRect({ x: 50, y: 50, w: 10, h: 4 }, 44)).toEqual({ x: 33, y: 30, w: 44, h: 44 });
    expect(grabRect({ x: 0, y: 0, w: 60, h: 50 }, 44)).toEqual({ x: 0, y: 0, w: 60, h: 50 });
  });

  it("leaves an empty view mark empty, so it grabs nothing", () => {
    const empty = { x: 5, y: 5, w: 0, h: 10 };
    expect(grabRect(empty, 44)).toBe(empty);
    expect(grabRect({ x: 5, y: 5, w: 10, h: 10 }, Number.NaN)).toEqual({ x: 5, y: 5, w: 10, h: 10 });
  });
});

describe("overview map keys", () => {
  it("reads the camera's center in the units applyView takes", () => {
    expect(cameraCenter(CAM)).toEqual({ tile: 100, floor: 20 });
    expect(cameraCenter({ ...CAM, posX: Number.NaN, posY: Number.POSITIVE_INFINITY })).toEqual({ tile: 0, floor: 0 });
  });

  it("moves a quarter of the visible span per arrow, and the whole span with Shift", () => {
    expect(MAP_KEY_STEP_SHARE).toBe(0.25);
    expect(keyTarget(MAP_KEY.left, false, CAM, EXTENT)).toEqual({ tile: 80, floor: 20 });
    expect(keyTarget(MAP_KEY.right, false, CAM, EXTENT)).toEqual({ tile: 120, floor: 20 });
    expect(keyTarget(MAP_KEY.up, false, CAM, EXTENT)).toEqual({ tile: 100, floor: 24 });
    expect(keyTarget(MAP_KEY.down, false, CAM, EXTENT)).toEqual({ tile: 100, floor: 16 });
    expect(keyTarget(MAP_KEY.up, true, CAM, EXTENT)).toEqual({ tile: 100, floor: 36 });
  });

  it("goes to the top and the bottom of the map with Home and End", () => {
    expect(keyTarget(MAP_KEY.top, false, CAM, EXTENT)).toEqual({ tile: 100, floor: 107 });
    expect(keyTarget(MAP_KEY.bottom, false, CAM, EXTENT)).toEqual({ tile: 100, floor: -11 });
  });

  it("moves at least a tile and a floor on a camera with no viewport yet", () => {
    const blank = { ...CAM, viewWidth: 0, viewHeight: Number.NaN, zoom: 0 };
    expect(keyTarget(MAP_KEY.left, false, blank, EXTENT)).toEqual({ tile: 99, floor: 20 });
    expect(keyTarget(MAP_KEY.up, false, blank, EXTENT)).toEqual({ tile: 100, floor: 21 });
  });

  it("answers no other key", () => {
    for (const key of ["Enter", " ", "a", "PageUp", "Escape"]) expect(keyTarget(key, false, CAM, EXTENT), key).toBeNull();
  });
});

describe("overview map input on a crop with a margin left of the lot", () => {
  // The banded crop of the 375-tile lot: 15 tiles of margin each side, so tile 0 sits 15 tiles in from the map's left edge.
  const CROP: MapExtent = { leftTile: -15, width: 405, topLine: 30, bottomLine: -1 };
  // One backing pixel per tile and ten per floor, shown at a third of that across and half of it down.
  const layout = fitLayout(CROP, 405, 310);
  const box = { left: 10, top: 20, width: 135, height: 155 };

  it("turns a pointer at the canvas's left edge into the margin's first tile, and one 15 tiles in into tile 0", () => {
    const edge = clientToMap(box, layout, 10, 20 + 77.5);
    expect(edge).toEqual({ x: 0, y: 155 });
    expect(mapPointToCenter(layout, edge.x, edge.y).tile).toBe(-15);
    const lotEdge = clientToMap(box, layout, 10 + 5, 20);
    expect(lotEdge.x).toBe(15);
    expect(mapPointToCenter(layout, lotEdge.x, lotEdge.y).tile).toBe(0);
  });

  it("reads a camera centered in the margin as a tile below 0, unclamped", () => {
    expect(cameraCenter({ ...CAM, posX: -10 * TILE }).tile).toBe(-10);
  });

  it("steps across the margin's left edge by the visible span, leaving the clamp to the renderer", () => {
    const atLotEdge = { ...CAM, posX: 0 };
    expect(keyTarget(MAP_KEY.left, false, atLotEdge, CROP)).toEqual({ tile: -20, floor: 20 });
    // The horizontal step does not read the extent at all, and Home and End read only its top and bottom.
    expect(keyTarget(MAP_KEY.left, false, atLotEdge, CROP)).toEqual(keyTarget(MAP_KEY.left, false, atLotEdge, EXTENT));
    expect(keyTarget(MAP_KEY.top, false, atLotEdge, CROP)).toEqual({ tile: 0, floor: 30 });
    expect(keyTarget(MAP_KEY.bottom, false, atLotEdge, CROP)).toEqual({ tile: 0, floor: -1 });
  });

  it("grabs a view mark clipped at the map's left edge by its area in the margin", () => {
    // A view 20 tiles wide centered on tile -10 reaches 5 tiles past the map's left edge: 15 tiles of it are on the map.
    const mark = viewportRect(layout, { posX: -10 * TILE, posY: -20 * FLOOR, zoom: 1, viewWidth: 20 * TILE, viewHeight: 4 * FLOOR });
    expect(mark).toMatchObject({ x: 0, w: 15 });
    const area = grabRect(mark, 44);
    expect(area.x + area.w / 2).toBe(mark.x + mark.w / 2);
    expect(rectContains(area, tileToMapX(layout, -12), mark.y + mark.h / 2)).toBe(true);
    expect(rectContains(area, tileToMapX(layout, 40), mark.y + mark.h / 2)).toBe(false);
  });
});

describe("overview map pass-through keys", () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  it("lets zoom, the speed digits, Tab, the Space pan key and any shortcut reach the game", () => {
    for (const k of ["+", "=", "-", "_", "0", "1", "2", "3", "Tab", " ", "Spacebar"]) expect(passesMapKey(key(k)), k).toBe(true);
    expect(passesMapKey(key("z", { ctrlKey: true }))).toBe(true);
    expect(passesMapKey(key("z", { metaKey: true }))).toBe(true);
  });

  it("keeps the building, bulldozing and cursor keys on the map", () => {
    for (const k of ["Enter", "Delete", "Backspace", "x", "w", "a", "c", "ArrowLeft"]) expect(passesMapKey(key(k)), k).toBe(false);
  });
});

describe("overview map pointer and click facts", () => {
  it("names the primary button, an empty button set and a keyboard click", () => {
    expect(isPrimaryPress({ button: 0 })).toBe(true);
    expect(isPrimaryPress({ button: 1 })).toBe(false);
    expect(noButtonHeld({ buttons: 0 })).toBe(true);
    expect(noButtonHeld({ buttons: 1 })).toBe(false);
    expect(isKeyboardClick({ detail: 0 })).toBe(true);
    expect(isKeyboardClick({ detail: 1 })).toBe(false);
  });
});
