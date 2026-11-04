/**
 * Pure geometry for the overview MAP window (#343): the transforms between the
 * world's tile and floor coordinates and the map's pixels, and the camera
 * rectangle drawn on it. No canvas, no Excalibur, no DOM, so it is unit-tested
 * on its own and the window code only calls it.
 *
 * Coordinates, as the renderer and the save use them:
 * - tile `t` spans world x `[t * TILE, (t + 1) * TILE]`;
 * - floor `f` spans world y `[-f * FLOOR, -f * FLOOR + FLOOR]`, so a floor's top
 *   edge is the "line" `f` and its bottom edge is the line `f - 1` (floor 1 is
 *   the ground, floor 0 is B1, floor -9 is B10);
 * - the camera is saved as its center: `{ tile: pos.x / TILE, floor: -pos.y / FLOOR }`.
 *
 * Map space has its origin at the top-left, x to the right and y downward, and
 * its unit is the DEVICE pixel: the window builds its layout from the canvas's
 * backing-store size (CSS size times `devicePixelRatio`), so snapping to whole
 * map pixels is snapping to whole device pixels at any ratio. `mapExtent` is
 * the whole world: the lot across, and vertically the same span the camera is
 * allowed to see (sky above the top floor, one floor of ground below the
 * deepest basement). The map draws the banded crop (`extent.ts`), which adds a
 * margin beside the lot (an extent may start left of tile 0) and is shorter, so
 * a camera can sit wholly or partly above or below it: `viewportRect` clips the
 * rectangle to the map and `viewPlacement` says which edge it passed.
 */
import { FLOOR, TILE } from "../scale";

/** The map's bottom edge, as floor lines counted down from `minFloor` (the
 *  lowest floor's top edge is line `minFloor`, its bottom edge `minFloor - 1`).
 *  The value 2 matches the bottom clamp in `clampCameraY` (`cameraBounds.ts`,
 *  `-(minFloor - 2) * floorPx`) and leaves one floor of ground under the
 *  lowest floor. */
export const MAP_LINES_BELOW_LOWEST_FLOOR = 2;

/** The world the map covers: the lot's width and its buildable floor range. */
export interface MapWorld {
  readonly lotWidth: number;
  readonly minFloor: number;
  readonly maxFloor: number;
}

/** What the map spans, in world units: `width` tiles across from the tile
 *  `leftTile` at its left edge (below 0 when the map leaves a margin beside the
 *  lot), and `topLine` and `bottomLine` are floor lines (the top edge of floor
 *  `n` is line `n`). */
export interface MapExtent {
  readonly leftTile: number;
  readonly width: number;
  readonly topLine: number;
  readonly bottomLine: number;
}

/** A layout: the extent plus the pixels per tile and per floor, and the size in
 *  pixels those scales give. */
export interface MapLayout {
  readonly extent: MapExtent;
  readonly pxPerTile: number;
  readonly pxPerFloor: number;
  readonly width: number;
  readonly height: number;
}

/** A rectangle in map pixels. */
export interface MapRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The camera as the renderer holds it: world-pixel center, zoom, and the
 *  viewport size in screen pixels. */
export interface MapCamera {
  readonly posX: number;
  readonly posY: number;
  readonly zoom: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
}

/** A camera center in the units the save stores. */
export interface MapCameraCenter {
  readonly tile: number;
  readonly floor: number;
}

/** A finite positive number, or `fallback`. */
function positive(n: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** A finite number, or `fallback`. */
function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The extent the map spans for a world. `skyFloors` is the camera's sky
 * headroom above the top floor (`SKY_HEADROOM_FLOORS` in `cameraBounds.ts`); it
 * is a parameter so this module imports no sprite code.
 */
export function mapExtent(world: MapWorld, skyFloors: number): MapExtent {
  const width = positive(world.lotWidth, 1);
  const minFloor = finite(world.minFloor, 0);
  const maxFloor = Math.max(minFloor, finite(world.maxFloor, minFloor));
  const sky = Math.max(0, finite(skyFloors, 0));
  return { leftTile: 0, width, topLine: maxFloor + sky, bottomLine: minFloor - MAP_LINES_BELOW_LOWEST_FLOOR };
}

/** Floors the extent spans from top to bottom. Always at least 1. */
export function extentFloors(extent: MapExtent): number {
  const span = extent.topLine - extent.bottomLine;
  return Number.isFinite(span) ? Math.max(1, span) : 1;
}

/**
 * A layout that fills a box of `boxWidth` by `boxHeight` pixels exactly, with
 * the tile and floor scales set independently (the map is a schematic with its
 * own proportions). A non-finite or non-positive box falls back to 1 pixel so
 * the scales stay finite and positive.
 */
export function fitLayout(extent: MapExtent, boxWidth: number, boxHeight: number): MapLayout {
  const width = positive(boxWidth, 1);
  const height = positive(boxHeight, 1);
  // A hand-built extent is trusted no further than `mapExtent` would trust a
  // world: a width that is not a positive finite number reads as one tile
  // starting at tile 0 (a left edge set back for a margin would leave that one
  // tile wholly in the margin), an upside-down span reads as one floor, and a
  // left edge that is not finite reads as tile 0.
  const widthOk = Number.isFinite(extent.width) && extent.width > 0;
  const tiles = widthOk ? extent.width : 1;
  const leftTile = widthOk ? finite(extent.leftTile, 0) : 0;
  const floors = extentFloors(extent);
  return {
    extent: { leftTile, width: tiles, topLine: extent.topLine, bottomLine: extent.bottomLine },
    pxPerTile: width / tiles,
    pxPerFloor: height / floors,
    width,
    height,
  };
}

// ---- world <-> map ------------------------------------------------------

/** Map x of a tile's left edge (tiles may be fractional: the camera's center is). */
export function tileToMapX(layout: MapLayout, tile: number): number {
  return (finite(tile, 0) - layout.extent.leftTile) * layout.pxPerTile;
}

/** Map y of a floor line: the top edge of floor `line` (a floor's bottom edge is
 *  `line - 1`). */
export function lineToMapY(layout: MapLayout, line: number): number {
  return (layout.extent.topLine - finite(line, layout.extent.topLine)) * layout.pxPerFloor;
}

/** The tile a map x falls on, as a fractional tile (not rounded or clamped). */
export function mapXToTile(layout: MapLayout, x: number): number {
  return layout.extent.leftTile + finite(x, 0) / layout.pxPerTile;
}

/** The floor line a map y falls on (not rounded or clamped). */
export function mapYToLine(layout: MapLayout, y: number): number {
  return layout.extent.topLine - finite(y, 0) / layout.pxPerFloor;
}

/** The map rectangle of a block: `x` and `width` in tiles, `floor` its lowest
 *  floor, `floors` how many floors tall it is (at least 1). */
export function blockRect(layout: MapLayout, x: number, width: number, floor: number, floors = 1): MapRect {
  const rows = Math.max(1, floors);
  return {
    x: tileToMapX(layout, x),
    y: lineToMapY(layout, floor + rows - 1),
    w: Math.max(0, finite(width, 0)) * layout.pxPerTile,
    h: rows * layout.pxPerFloor,
  };
}

/**
 * The map rectangle of a block, snapped to whole pixels for painting, or null
 * when the block cannot be drawn: any input is not a finite number, the width
 * or floor count is not positive, or the block lies wholly off the map.
 *
 * Both edges of each axis come from the same tile or floor line, so two blocks
 * that share an edge round it the same way and leave no seam. A block is never
 * thinner than one pixel and is clamped into the map, so a narrow shaft in the
 * last column or the bottom row still shows.
 */
export function snappedBlock(layout: MapLayout, x: number, width: number, floor: number, floors: number): MapRect | null {
  if (![x, width, floor, floors].every(Number.isFinite) || width <= 0 || floors < 1) return null;
  const mapW = Math.max(1, Math.floor(layout.width));
  const mapH = Math.max(1, Math.floor(layout.height));
  const rawLeft = tileToMapX(layout, x);
  const rawRight = tileToMapX(layout, x + width);
  const rawTop = lineToMapY(layout, floor + floors - 1);
  const rawBottom = lineToMapY(layout, floor - 1);
  // Off the map by the exact edges, before rounding can push a block that is
  // inside the last column or row onto the border.
  if (rawRight <= 0 || rawLeft >= layout.width || rawBottom <= 0 || rawTop >= layout.height) return null;
  const left = Math.round(rawLeft);
  const right = Math.round(rawRight);
  const top = Math.round(rawTop);
  const bottom = Math.round(rawBottom);
  const x0 = clamp(left, 0, mapW - 1);
  const y0 = clamp(top, 0, mapH - 1);
  const x1 = clamp(right, x0 + 1, mapW);
  const y1 = clamp(bottom, y0 + 1, mapH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---- the camera rectangle ----------------------------------------------

/**
 * The visible area on the map, in map pixels, from the camera's world-pixel
 * center and the viewport. It is clipped to the map, so a camera that sees past
 * the lot edge (or past the sky) shows the part that is on the map. A
 * non-positive zoom reads as 1, as `clampCameraY` reads it.
 */
export function viewportRect(layout: MapLayout, cam: MapCamera): MapRect {
  const zoom = positive(cam.zoom, 1);
  const halfW = positive(cam.viewWidth, 0) / 2 / zoom;
  const halfH = positive(cam.viewHeight, 0) / 2 / zoom;
  const posX = finite(cam.posX, 0);
  const posY = finite(cam.posY, 0);
  const { extent } = layout;
  // Clip in world units, before the transforms: a tiny zoom or a huge viewport
  // can overflow the edges to Infinity, which the transforms would read as 0,
  // and a view taller than a cropped map must still cover all of it.
  const mapRight = extent.leftTile + extent.width;
  const leftTile = clamp((posX - halfW) / TILE, extent.leftTile, mapRight);
  const rightTile = clamp((posX + halfW) / TILE, extent.leftTile, mapRight);
  const topLine = clamp(-(posY - halfH) / FLOOR, extent.bottomLine, extent.topLine);
  const bottomLine = clamp(-(posY + halfH) / FLOOR, extent.bottomLine, extent.topLine);
  const x0 = clamp(tileToMapX(layout, leftTile), 0, layout.width);
  const x1 = clamp(tileToMapX(layout, rightTile), 0, layout.width);
  const y0 = clamp(lineToMapY(layout, topLine), 0, layout.height);
  const y1 = clamp(lineToMapY(layout, bottomLine), 0, layout.height);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Whether two rectangles are the same to within `eps` map pixels (half a
 *  device pixel by default), so the window can skip a repaint when the camera
 *  has not visibly moved. */
export function sameRect(a: MapRect | null, b: MapRect | null, eps = 0.5): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.w - b.w) <= eps && Math.abs(a.h - b.h) <= eps;
}

// ---- map -> camera ------------------------------------------------------

/**
 * The camera center for a point on the map, in the units `setCamera` and the
 * save use. The point is clamped onto the map first, so a click or drag that
 * leaves the map edge aims at the edge. A point in the margin beside the lot
 * returns a tile in the margin (below 0, or past the lot's width). The
 * renderer's own clamp still applies when the camera moves, and may keep the
 * center further in than the point asks for: the camera cannot show past the
 * sky or the ground, and `clamp` in `towerInputCamera.ts` holds its center
 * between tile 0 and the lot's width, so a center asked for in the margin
 * lands on the lot's nearer edge.
 */
export function mapPointToCenter(layout: MapLayout, mx: number, my: number): MapCameraCenter {
  // NaN has no side to aim at and reads as the map's center; an infinite value
  // clamps onto the edge it points to.
  const x = Number.isNaN(mx) ? layout.width / 2 : clamp(mx, 0, layout.width);
  const y = Number.isNaN(my) ? layout.height / 2 : clamp(my, 0, layout.height);
  return { tile: mapXToTile(layout, x), floor: mapYToLine(layout, y) };
}

/**
 * The camera center while the viewport rectangle is dragged. `start` is the
 * camera's center when the drag began (the real camera; the rectangle is
 * clipped to the map), `grab` is where on the map the pointer went
 * down. The center moves by the pointer's travel since then, so the rectangle
 * does not jump to the pointer when the drag starts. The result is kept on the
 * map, except that a start outside it (a camera above the crop) is never
 * pulled in or pushed further out by the drag: it moves only by the travel back
 * toward the map. A non-finite grab or pointer reads as "no travel" on that axis.
 *
 * The renderer clamps the camera after each move, so at a clamp edge the
 * rectangle can stop short of the pointer. The caller reads the camera again
 * for each move instead of accumulating from `start` forever if it wants the
 * rectangle to follow the pointer back off the edge.
 */
export function dragCenter(
  layout: MapLayout,
  start: MapCameraCenter,
  grab: { readonly x: number; readonly y: number },
  pointer: { readonly x: number; readonly y: number },
): MapCameraCenter {
  const dx = Number.isFinite(grab.x) && Number.isFinite(pointer.x) ? pointer.x - grab.x : 0;
  const dy = Number.isFinite(grab.y) && Number.isFinite(pointer.y) ? pointer.y - grab.y : 0;
  const { extent } = layout;
  const tile0 = finite(start.tile, 0);
  const floor0 = finite(start.floor, extent.topLine);
  // A start already past an edge (a camera in the sky above the crop) stays
  // where it is: the result may not go further out than the start, and is not
  // pulled onto the map by a move along the other axis.
  return {
    tile: clamp(tile0 + dx / layout.pxPerTile, Math.min(extent.leftTile, tile0), Math.max(extent.leftTile + extent.width, tile0)),
    floor: clamp(floor0 - dy / layout.pxPerFloor, Math.min(extent.bottomLine, floor0), Math.max(extent.topLine, floor0)),
  };
}

/** Whether a map point lies inside a rectangle (edges included). An empty
 *  rectangle (no width or no height) contains nothing; the caller widens a
 *  small rectangle for touch before asking. */
export function rectContains(rect: MapRect, x: number, y: number): boolean {
  if (!(rect.w > 0) || !(rect.h > 0)) return false;
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}
