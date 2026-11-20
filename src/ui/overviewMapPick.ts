/**
 * What a tap on the overview MAP opens: the card of the room under it, or on
 * the Traffic view the card of a shaft serving the floor under it. The Map
 * draws a room a pixel or two wide, so a tap that misses every room takes the
 * nearest one within `reach`. A shaft is one that carries passengers. One
 * pass over the rooms or the shafts, only on a tap, with no allocation per
 * room.
 *
 * The Edit view opens nothing: a tap there only moves the view, as in the
 * original.
 */
import type { FacilityKind } from "@verticopolis/engine/model/types";
import {
  lineToMapY,
  mapYToLine,
  tileToMapX,
  type MapLayout,
} from "@verticopolis/components/render/overviewMap/geometry";
import type { MapViewId } from "@verticopolis/components/render/overviewMap/views";
import { MAP_TAP_SLOP_CSS, MAP_TOUCH_TARGET_CSS } from "@verticopolis/components/windows/overviewMapInput";

/** A room as the pick reads it. */
export interface MapPickRoom {
  readonly id: number;
  readonly kind: FacilityKind;
  readonly floor: number;
  readonly x: number;
  readonly width: number;
}

/** A shaft as the pick reads it. */
export interface MapPickShaft {
  readonly id: number;
  readonly kind: FacilityKind;
  readonly x: number;
  readonly width: number;
  readonly bottom: number;
  readonly top: number;
}

/** What the tap opens: the same shape the world's own pick gives. */
export interface MapPicked {
  readonly type: "unit" | "transport";
  readonly id: number;
  readonly kind: FacilityKind;
}

export interface MapPickInput {
  readonly view: MapViewId;
  readonly layout: MapLayout;
  /** The tap, in map pixels. */
  readonly x: number;
  readonly y: number;
  /** How far from a room a tap may land and still open it, in map pixels. */
  readonly reach: number;
  readonly rooms: ReadonlyArray<MapPickRoom>;
  readonly shafts: ReadonlyArray<MapPickShaft>;
  /** A kind's height in floors. */
  floorsOf(kind: FacilityKind): number;
}

/** How far from a room a tap may land and still open it, in map pixels at
 *  `px` map pixels per CSS pixel: half a touch target for a finger, which
 *  covers more of the map, and the tap slop for a mouse or pen. */
export function tapReach(pointerType: string, px: number): number {
  return (pointerType === "touch" ? MAP_TOUCH_TARGET_CSS / 2 : MAP_TAP_SLOP_CSS) * px;
}

/** The kinds the Map draws as the tower's frame, which have no card. */
function isFrame(kind: FacilityKind): boolean {
  return kind === "floor" || kind === "lobby";
}

/** How far a point is from a rectangle on one axis: 0 inside it. */
function gap(p: number, start: number, size: number): number {
  if (p < start) return start - p;
  const end = start + size;
  return p > end ? p - end : 0;
}

/** How far a point is from a block of `width` tiles from tile `x` and `floors`
 *  floors up from `floor`, in map pixels: `blockRect`'s rectangle, worked out
 *  in place so a tap allocates nothing per room. */
function blockDistance(
  layout: MapLayout,
  px: number,
  py: number,
  block: { x: number; width: number; floor: number },
  floors: number,
): number {
  const rows = Math.max(1, floors);
  const w = Math.max(0, block.width) * layout.pxPerTile;
  const across = gap(px, tileToMapX(layout, block.x), w);
  const down = gap(py, lineToMapY(layout, block.floor + rows - 1), rows * layout.pxPerFloor);
  return Math.hypot(across, down);
}

/** The room under the tap, or the nearest one within `reach`; the first in
 *  the rooms' order wins a tie. */
function pickRoom(input: MapPickInput): MapPicked | null {
  const reach = Number.isFinite(input.reach) && input.reach > 0 ? input.reach : 0;
  let best: MapPickRoom | null = null;
  let bestDistance = Infinity;
  for (const room of input.rooms) {
    if (isFrame(room.kind)) continue;
    const d = blockDistance(input.layout, input.x, input.y, room, input.floorsOf(room.kind));
    if (d <= reach && d < bestDistance) {
      best = room;
      bestDistance = d;
      if (d === 0) break;
    }
  }
  return best ? { type: "unit", id: best.id, kind: best.kind } : null;
}

/** The floor a map y falls on: the top edge of floor `f` is line `f`. */
export function mapFloorAt(layout: MapLayout, y: number): number {
  return Math.ceil(mapYToLine(layout, y));
}

/** The passenger shaft serving the tapped floor that stands nearest the tap
 *  across the floor; the first in the shafts' order wins a tie. A Traffic color covers
 *  the whole floor, so any distance across it counts. */
function pickShaft(input: MapPickInput): MapPicked | null {
  const floor = mapFloorAt(input.layout, input.y);
  let best: MapPickShaft | null = null;
  let bestDistance = Infinity;
  for (const shaft of input.shafts) {
    // A service elevator carries staff only, so it never eases a jam.
    if (shaft.kind === "elevatorService" || floor < shaft.bottom || floor > shaft.top) continue;
    const d = gap(input.x, tileToMapX(input.layout, shaft.x), Math.max(0, shaft.width) * input.layout.pxPerTile);
    if (d < bestDistance) {
      best = shaft;
      bestDistance = d;
      if (d === 0) break;
    }
  }
  return best ? { type: "transport", id: best.id, kind: best.kind } : null;
}

/** What a tap on the Map opens on its selected view, or null for nothing. */
export function mapPick(input: MapPickInput): MapPicked | null {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return null;
  switch (input.view) {
    case "edit":
      return null;
    case "traffic":
      return pickShaft(input);
    default:
      return pickRoom(input);
  }
}
