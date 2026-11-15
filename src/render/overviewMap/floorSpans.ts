/**
 * Each floor's built spans as the overview MAP's draw list meets them
 * (`buildMapDrawList` fills one while it walks the runs, the tall lobby halls
 * and the rooms, so finding the gaps between buildings costs no walk of its
 * own). `gaps.ts` reads it.
 *
 * A span is a column range `[from, to)` of built space on one floor: a floor
 * or lobby run, a raised story of a tall hall, or an upper floor of a room
 * taller than one floor. A span that starts where the floor's last one ended
 * extends it in place, so a floor the view lists left to right as one
 * building stays one span, and `split` stays false for a tower with no gap
 * anywhere.
 */
import type { MapLayout } from "./geometry";

/** A hand-built extent taller than any world is held to this many floors. */
const MAX_ROWS = 4096;

export class FloorSpans {
  /** Each floor's spans, flat `[from, to, from, to, ...]`, by the floor's row
   *  counted from `lowest`. */
  readonly rows: Array<number[] | undefined>;
  /** The floor of row 0: the one under the map's bottom line. */
  readonly lowest: number;
  /** Whether any floor holds more than one span. Without that there is no gap. */
  split = false;

  constructor(layout: MapLayout) {
    this.lowest = Math.floor(layout.extent.bottomLine);
    const rows = Math.ceil(layout.extent.topLine) - this.lowest + 1;
    this.rows = new Array<number[] | undefined>(Number.isFinite(rows) && rows > 0 ? Math.min(rows, MAX_ROWS) : 0);
  }

  /** Record built space at columns `[from, to)` on `floor`. A floor off the
   *  map, or a value that is not finite, records nothing. */
  add(floor: number, from: number, to: number): void {
    const row = floor - this.lowest;
    if (!(row >= 0 && row < this.rows.length && Number.isInteger(row) && Number.isFinite(from) && to > from && Number.isFinite(to))) return;
    const list = this.rows[row];
    if (!list) {
      this.rows[row] = [from, to];
    } else if (list[list.length - 1] === from) {
      list[list.length - 1] = to;
    } else {
      list.push(from, to);
      this.split = true;
    }
  }
}
