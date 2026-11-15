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
 * Cost: built only with the draw list (a tower edit, a band crossed, a new
 * box), one pass over the runs, rooms and tall halls, and a walk of each
 * floor's few spans (sorted only on a floor a hall or a tall room adds to). Rows that repeat floor over floor join into one
 * rectangle, so a tower pair 70 floors tall adds one rectangle per gap.
 */
import type { FacilityKind } from "../../shared/types";
import { floorsFor, type MapSource } from "./drawList";
import { lineToMapY, tileToMapX, type MapLayout, type MapRect } from "./geometry";

/** The narrowest a gap between buildings draws, in CSS pixels. The window
 *  multiplies it by the device pixel ratio. */
export const MAP_MIN_GAP_CSS_PX = 4;

/** A hand-built extent taller than any world is held to this many floors. */
const MAX_ROWS = 4096;

/** What the gaps are found from: the draw list's own source. */
export type MapGapSource = Pick<MapSource, "structure" | "rooms" | "floorsOf" | "tallLobbies">;

/** One floor's built spans, as tile columns `[from, to)`, flat. */
type Spans = number[];

/** Each floor's spans, by the floor's row from the map's bottom line. */
interface FloorSpans {
  readonly rows: Array<Spans | undefined>;
  readonly lowest: number;
}

function addSpan(byFloor: FloorSpans, floor: number, from: number, to: number): void {
  const row = floor - byFloor.lowest;
  // A floor off the map (or not a whole number) draws no gap.
  if (!(row >= 0 && row < byFloor.rows.length && Number.isInteger(row) && Number.isFinite(from) && Number.isFinite(to) && to > from)) return;
  const list = byFloor.rows[row];
  if (list) list.push(from, to);
  else byFloor.rows[row] = [from, to];
}

/** Sort a floor's spans by their start, in place, and join the ones that
 *  touch or overlap. Returns how many numbers of `flat` now hold the joined
 *  `[from, to)` pairs. A floor holds a few spans, and the view lists its runs
 *  left to right, so the insertion sort moves only what a hall or a tall room
 *  added. */
function joinSpans(flat: Spans): number {
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
 * The gaps between buildings for a source and a layout, as map rectangles in
 * device pixels, each at least `minPx` wide where the buildings beside it
 * leave room. A gap off the map, or a source entry with a coordinate that is
 * not finite, is skipped; nothing throws on odd input.
 */
export function buildMapGaps(layout: MapLayout, source: MapGapSource, minPx: number): MapRect[] {
  // The floors the map shows: the one under its bottom line up to the one
  // on its top line.
  const lowest = Math.floor(layout.extent.bottomLine);
  const rows = Math.max(0, Math.ceil(layout.extent.topLine) - lowest + 1);
  const byFloor: FloorSpans = { rows: new Array<Spans | undefined>(Number.isFinite(rows) ? Math.min(rows, MAX_ROWS) : 0), lowest };
  for (const run of source.structure) {
    if (!(run.count >= 1)) continue;
    addSpan(byFloor, run.floor, run.x, run.x + run.width * run.count);
  }
  // A tall hall's raised stories have no tiles of their own.
  for (const hall of source.tallLobbies()) {
    for (let story = 0; story < hall.height; story++) addSpan(byFloor, hall.floor + story, hall.x0, hall.x1 + 1);
  }
  // A room stands on its bottom floor's tiles, which the runs above already
  // hold, so only the upper floors of a room taller than one floor add a span.
  const heights = new Map<FacilityKind, number>();
  for (const room of source.rooms) {
    const floors = floorsFor(source, room.kind, heights);
    for (let story = 1; story < floors; story++) addSpan(byFloor, room.floor + story, room.x, room.x + room.width);
  }

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
