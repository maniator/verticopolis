/**
 * What the overview MAP window (#343) spans, and where the main view sits
 * against it. Pure, like `geometry.ts`, so the window only calls it.
 *
 * The map shows a banded crop of the built tower (SPEC, Constraints), in both
 * game modes (owner, 2026-11-04): from one floor of ground under the lowest
 * built floor to the top built floor plus the sky headroom, with the top
 * rounded up to the next band of `MAP_BAND_FLOORS` floors, at least
 * `MAP_MIN_FLOORS` tall, and never past the world's top or bottom. Across, it
 * is the whole lot plus a margin of `mapSideMarginTiles` on each side, so it
 * does reach past the world there: a tower built from edge to edge does not
 * touch the map's sides (as the main view shows sky beside the lot). Building
 * inside a band leaves the extent alone, so the map does not rescale on every
 * new floor. The camera clamp still covers the whole world, so the view can
 * sit above the crop; `viewPlacement` says when.
 */
import { FLOOR } from "../scale";
import { MAP_LINES_BELOW_LOWEST_FLOOR, mapExtent, viewportRect, type MapCamera, type MapExtent, type MapLayout, type MapRect, type MapWorld } from "./geometry";

/** The crop's top rounds up to a multiple of this many floor lines. */
export const MAP_BAND_FLOORS = 10;

/** The crop is at least this many floors tall, unless the world itself is
 *  shorter (the crop never goes past the world's top). */
export const MAP_MIN_FLOORS = 30;

/** The margin beside the lot on each side, as a share of the lot's width. */
export const MAP_SIDE_MARGIN_SHARE = 0.04;

/** The margin beside a lot of `lotWidth` tiles on each side, in whole tiles:
 *  `MAP_SIDE_MARGIN_SHARE` of the lot rounded up, so any lot gets at least one
 *  tile. A width that is not a positive finite number gets one tile. */
export function mapSideMarginTiles(lotWidth: number): number {
  if (!(Number.isFinite(lotWidth) && lotWidth > 0)) return 1;
  return Math.max(1, Math.ceil(lotWidth * MAP_SIDE_MARGIN_SHARE));
}

/** The floors the tower has built, as `SimView.tower` reports them. */
export interface BuiltFloors {
  readonly lowestFloor: number;
  readonly highestFloor: number;
}

/**
 * The banded crop for a world and the floors built in it, with the side
 * margins. A missing range, or a lowest floor that is not finite, reads as the
 * ground floor; a top that is not finite, or under the lowest, reads as the
 * lowest; a range outside the world is held inside it. So a bad view still
 * gives a usable map. A lot so wide that the margins would take the width
 * past a finite number gets no margin, so the extent always has a finite,
 * positive width and `fitLayout` reads it as it is.
 */
export function bandedExtent(world: MapWorld, built: BuiltFloors | null, skyFloors: number): MapExtent {
  const whole = mapExtent(world, skyFloors);
  // The same sky `mapExtent` used (it reads a bad value as no sky), so the world's
  // top floor below falls out of `whole` exactly.
  const sky = Math.max(0, Number.isFinite(skyFloors) ? skyFloors : 0);
  const worldLowest = whole.bottomLine + MAP_LINES_BELOW_LOWEST_FLOOR;
  const worldHighest = whole.topLine - sky;
  const lowest = withinWorld(built?.lowestFloor, 1, worldLowest, worldHighest);
  const highest = Math.max(lowest, withinWorld(built?.highestFloor, lowest, worldLowest, worldHighest));
  const bottomLine = lowest - MAP_LINES_BELOW_LOWEST_FLOOR;
  // Both candidates for the top sit on the band grid, so a small tower that the
  // minimum height holds up does not rescale one floor at a time either. The
  // minimum is measured from the ground's bottom line (or the crop's, if that is
  // higher), so digging basements under a small tower never lowers the top.
  const groundBottom = 1 - MAP_LINES_BELOW_LOWEST_FLOOR;
  const minTop = toBand(Math.max(bottomLine, groundBottom) + MAP_MIN_FLOORS);
  const topLine = Math.min(whole.topLine, Math.max(toBand(highest + sky), minTop));
  // `whole.width` is the lot as `mapExtent` trusts it (a bad width reads as 1).
  const margin = mapSideMarginTiles(whole.width);
  const width = whole.width + 2 * margin;
  if (!(Number.isFinite(width) && width > 0)) return { leftTile: 0, width: whole.width, topLine, bottomLine };
  return { leftTile: -margin, width, topLine, bottomLine };
}

/** A floor line rounded up onto the band grid. */
function toBand(line: number): number {
  return Math.ceil(line / MAP_BAND_FLOORS) * MAP_BAND_FLOORS;
}

function withinWorld(n: number | undefined, fallback: number, lo: number, hi: number): number {
  const v = n !== undefined && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(lo, Math.min(hi, v));
}

/** Whether two extents are the same, so the window rebuilds its layout only when
 *  a band is crossed. */
export function sameExtent(a: MapExtent, b: MapExtent): boolean {
  return a.leftTile === b.leftTile && a.width === b.width && a.topLine === b.topLine && a.bottomLine === b.bottomLine;
}

/** Where the main view sits against the map's extent. */
export type ViewOutside = "none" | "above" | "below";

export interface ViewPlacement {
  /** The visible area clipped to the map (see `viewportRect`). */
  readonly rect: MapRect;
  /** Whether any of the view lies past the map's top or bottom edge (true too
   *  when all of it does). The lot's sides are not counted: the camera clamp
   *  keeps the view's center on the lot, and `rect` is clipped to the sides on
   *  its own. */
  readonly clipped: boolean;
  /** Whether the whole view lies past one edge, so `rect` has no height and
   *  the window draws the edge band with a chevron instead. */
  readonly outside: ViewOutside;
  /** The floor line the view's center falls on (floor `f` spans the lines
   *  `f - 1`, exclusive, to `f`), or null when the camera's position is not a
   *  finite number. It can be past the built floors (in the sky or the ground);
   *  the text summary says so. */
  readonly centerFloor: number | null;
}

/**
 * The view against the map. A camera the clamp lets sit in the sky above the
 * crop is `outside: "above"`. The camera is read the way `viewportRect` reads
 * it (a bad zoom is 1, a bad position 0, a bad viewport size 0), so `outside`
 * and `rect` agree: a view outside has a `rect` with no height.
 */
export function viewPlacement(layout: MapLayout, cam: MapCamera): ViewPlacement {
  const rect = viewportRect(layout, cam);
  const zoom = Number.isFinite(cam.zoom) && cam.zoom > 0 ? cam.zoom : 1;
  const posY = Number.isFinite(cam.posY) ? cam.posY : 0;
  const halfFloors = Math.max(0, Number.isFinite(cam.viewHeight) ? cam.viewHeight : 0) / 2 / zoom / FLOOR;
  const centerLine = -posY / FLOOR;
  const viewTop = centerLine + halfFloors;
  const viewBottom = centerLine - halfFloors;
  const { topLine, bottomLine } = layout.extent;
  // A view with height is outside when its clipped rectangle has none and the
  // view reaches past an edge, so the two can never disagree by a rounding
  // error at an edge; its center says which side. (A view thinner than float
  // precision inside the map has no rectangle either, and stays on the map.) A
  // view with no height that sits exactly on an edge line is on the map.
  const clipped = viewTop > topLine || viewBottom < bottomLine;
  let outside: ViewOutside = "none";
  if (halfFloors > 0) {
    if (!(rect.h > 0) && clipped) outside = centerLine >= (topLine + bottomLine) / 2 ? "above" : "below";
  } else if (viewBottom > topLine) outside = "above";
  else if (viewTop < bottomLine) outside = "below";
  return {
    rect,
    clipped,
    outside,
    // The line's ceiling is the floor it falls on; `|| 0` turns -0 into 0.
    centerFloor: Number.isFinite(cam.posY) ? Math.ceil(centerLine) || 0 : null,
  };
}

/**
 * The band drawn on the map's edge when the whole view lies past it: the view's
 * horizontal span (at least `minWidth` so it can be seen, and at least a pixel
 * each way unless the map itself is smaller), `thickness` tall,
 * against the top edge for a view above the map and the bottom edge for one
 * below. Null when the view is on the map.
 */
export function edgeBand(layout: MapLayout, placement: ViewPlacement, thickness: number, minWidth = thickness): MapRect | null {
  if (placement.outside === "none") return null;
  // At least a pixel each way, whatever the caller asks for.
  const atLeastOne = (n: number) => (Number.isFinite(n) && n > 1 ? n : 1);
  const h = Math.min(layout.height, atLeastOne(thickness));
  const spanW = Number.isFinite(placement.rect.w) ? placement.rect.w : 0;
  const spanX = Number.isFinite(placement.rect.x) ? placement.rect.x : 0;
  const w = Math.min(layout.width, Math.max(atLeastOne(minWidth), spanW));
  const x = Math.max(0, Math.min(layout.width - w, spanX + spanW / 2 - w / 2));
  return { x, y: placement.outside === "above" ? 0 : layout.height - h, w, h };
}
