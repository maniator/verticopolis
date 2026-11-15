/**
 * The open air between buildings on the overview MAP (#343): a column of
 * tiles on a floor with built space on both sides of it and nothing in it (no
 * floor or lobby tile, no room, no raised story of a tall lobby hall). Two
 * Modern towers on one lot, or a tower whose upper floors step apart, leave
 * such gaps, and the main view shows sky through them.
 *
 * The map packs the whole lot into a small box, often under one pixel per
 * tile, so a gap of a few tiles drew as a one-pixel seam, or as nothing, and
 * the buildings read as one block. Each gap is kept at least `minPx` map
 * pixels wide here, centered on the real gap, by taking the extra pixels from
 * the buildings beside it (each keeps a pixel of its own, so a narrow
 * building between two gaps never vanishes). A gap that is already wide
 * enough keeps its true width, and every gap shows at least one pixel. The map's scale is unchanged, so the camera
 * rectangle and a press on the map still land where they did.
 *
 * The window clears these rectangles after the rooms and before the shafts,
 * so the map's backdrop (sky above the ground line, earth below it) shows
 * through, and a shaft standing beside a gap still draws whole.
 *
 * Cost: no walk of its own. The draw list's walk records each floor's spans
 * (`FloorSpans`, a few numbers a floor); a tower in one piece stops there.
 * Otherwise one walk of the floors that hold two spans or more, sorting a
 * floor's few spans only where a hall or a tall room added one out of order.
 * Rows that repeat floor over floor join into one rectangle, so a tower pair
 * 70 floors tall adds one rectangle per gap.
 */
import { buildMapDrawList, type MapSource } from "./drawList";
import { FloorSpans } from "./floorSpans";
import { lineToMapY, tileToMapX, type MapLayout, type MapRect } from "./geometry";

/** The narrowest a gap between buildings draws, in CSS pixels. The window
 *  multiplies it by the device pixel ratio. */
export const MAP_MIN_GAP_CSS_PX = 4;

/** No gap: what a tower in one piece answers. */
const NO_GAPS: readonly MapRect[] = Object.freeze([]);

/** What `buildMapGaps` finds the gaps from: the draw list's own source. */
export type MapGapSource = Pick<MapSource, "structure" | "rooms" | "floorsOf" | "tallLobbies">;

/** Sort a floor's spans by their start, in place, and join the ones that
 *  touch or overlap. Returns how many numbers of `flat` now hold the joined
 *  `[from, to)` pairs. A floor holds a few spans, and the view lists its runs
 *  left to right, so the insertion sort moves only what a hall or a tall room
 *  added. */
function joinSpans(flat: number[]): number {
  for (let i = 2; i < flat.length; i += 2) {
    const from = flat[i];
    const to = flat[i + 1];
    let at = i;
    while (at > 0 && flat[at - 2] > from) {
      flat[at] = flat[at - 2];
      flat[at + 1] = flat[at - 1];
      at -= 2;
    }
    flat[at] = from;
    flat[at + 1] = to;
  }
  let n = 0;
  for (let i = 0; i < flat.length; i += 2) {
    if (n > 0 && flat[i] <= flat[n - 1]) {
      flat[n - 1] = Math.max(flat[n - 1], flat[i + 1]);
    } else {
      flat[n] = flat[i];
      flat[n + 1] = flat[i + 1];
      n += 2;
    }
  }
  return n;
}

/**
 * The gaps between buildings on a source alone: the draw list's walk with
 * `FloorSpans`, then `mapGaps`. The window's model takes the two steps itself,
 * so it walks the tower once.
 */
export function buildMapGaps(layout: MapLayout, source: MapGapSource, minPx: number): readonly MapRect[] {
  const spans = new FloorSpans(layout);
  buildMapDrawList(layout, { ...source, transports: [] }, spans);
  return mapGaps(layout, spans, minPx);
}

/**
 * The gaps between buildings in the spans the draw list recorded, as map
 * rectangles in device pixels, each at least `minPx` wide where the buildings
 * beside it leave room. A tower with no floor of two spans answers at once.
 * Sorts each floor's spans in place.
 */
export function mapGaps(layout: MapLayout, byFloor: FloorSpans, minPx: number): readonly MapRect[] {
  if (!byFloor.split) return NO_GAPS;
  const lowest = byFloor.lowest;
  // Every gap shows, a pixel wide at the least.
  const need = Number.isFinite(minPx) && minPx > 1 ? Math.ceil(minPx) : 1;
  const mapW = Math.max(1, Math.floor(layout.width));
  const mapH = Math.max(1, Math.floor(layout.height));
  /** Rectangles still open for joining, by their columns, with the floor
   *  they last reached. */
  const open = new Map<number, { rect: { x: number; y: number; w: number; h: number }; floor: number }>();
  const out: MapRect[] = [];
  for (let row = 0; row < byFloor.rows.length; row++) {
    const spans = byFloor.rows[row];
    // A gap needs two spans; one span is one building.
    if (!spans || spans.length < 4) continue;
    const count = joinSpans(spans);
    const floor = row + lowest;
    const top = Math.round(lineToMapY(layout, floor));
    const bottom = Math.round(lineToMapY(layout, floor - 1));
    if (bottom <= 0 || top >= mapH) continue;
    const y0 = Math.max(0, top);
    const y1 = Math.min(mapH, Math.max(bottom, y0 + 1));
    for (let i = 2; i < count; i += 2) {
      // In whole map pixels: the building on the left, the gap, the building
      // on the right, each rounded the way the draw list rounds a block.
      const leftStart = Math.round(tileToMapX(layout, spans[i - 2]));
      const gapStart = Math.round(tileToMapX(layout, spans[i - 1]));
      const gapEnd = Math.round(tileToMapX(layout, spans[i]));
      const rightEnd = Math.round(tileToMapX(layout, spans[i + 1]));
      const short = Math.max(0, need - (gapEnd - gapStart));
      // A building gives at most what leaves it a pixel even when gaps on both
      // of its sides take their share.
      const leftSpare = Math.max(0, Math.floor((gapStart - leftStart - 1) / 2));
      const rightSpare = Math.max(0, Math.floor((rightEnd - gapEnd - 1) / 2));
      let fromRight = Math.min(Math.floor(short / 2), rightSpare);
      const fromLeft = Math.min(short - fromRight, leftSpare);
      fromRight = Math.min(short - fromLeft, rightSpare);
      const left = Math.max(0, gapStart - fromLeft);
      const right = Math.min(mapW, gapEnd + fromRight);
      if (right <= left) continue;
      const key = left * (mapW + 1) + right;
      const held = open.get(key);
      // Floors go bottom to top. The floor under this one held the same
      // columns: grow that rectangle up over this row instead of starting
      // another.
      if (held && held.floor === floor - 1 && held.rect.y === y1) {
        held.rect.h += held.rect.y - y0;
        held.rect.y = y0;
        held.floor = floor;
        continue;
      }
      const rect = { x: left, y: y0, w: right - left, h: y1 - y0 };
      open.set(key, { rect, floor });
      out.push(rect);
    }
  }
  return out;
}
