/**
 * The overview MAP window's Traffic and Occupancy views (#343 S9, #1727):
 * each floor paints over the Edit map in the color of its band, from the
 * engine's congestion or occupancy (`floorHeatmap`, the cells the sidebar's
 * Floor heatmap drew over the main view before the Map took it over). The
 * engine decides every severity, 0 good to 1 bad; this file only sorts each
 * floor into one of three bands, places it and paints it.
 *
 * The bands split the severity in thirds, the way the old tint's ramp did
 * (green, amber at two thirds, red). On the Traffic view two thirds is where
 * the engine puts its churn point, the congestion where tenants start to
 * leave (`CONGESTION_AMBER_SEVERITY`), so a "Jammed" floor is one past it.
 * Color is not the only cue: the bands differ in pattern too, a floor row big
 * enough to carry a pattern gets it, and the legend counts the floors in
 * words. Both game modes use the same look.
 *
 * The cells are read once per game hour, on a change of the tower's revision
 * (a build or a removal), and on the Traffic view on a change of the meal
 * overlay's revision too, the triggers the old tint used (`OverviewMapViews`
 * holds them). `HeatMarks.take` copies a read (one pass over the cells) and
 * `HeatMarks.place` finds the rectangles (one pass over the kept floors).
 */
import type { HeatCell, HeatmapMode } from "../../engine/sim/constants";
import { snappedBlock, type MapLayout, type MapRect } from "./geometry";
import { MIN_PATTERN_SIDE, type MapPaintContext, type PatternSource } from "./paint";
import type { MapKindStyle } from "./style";

/** The views this file paints. */
export type HeatViewId = "traffic" | "occupancy";

/** The engine's heat mode each view paints. */
export const HEAT_MODE_OF_VIEW: Readonly<Record<HeatViewId, HeatmapMode>> = {
  traffic: "congestion",
  occupancy: "occupancy",
};

/** A floor's band: good, middling or bad. */
export type HeatBand = "good" | "middling" | "bad";

/** The severity a floor reads as middling from, and as bad from. On the
 *  Traffic view the bad line is the engine's churn point. */
export const HEAT_MIDDLING_FROM = 1 / 3;
export const HEAT_BAD_FROM = 2 / 3;

/** A cell's band. A severity that is not a number reads good, as the old
 *  tint's ramp read it. */
export function heatBand(severity: number): HeatBand {
  if (severity >= HEAT_BAD_FROM) return "bad";
  if (severity >= HEAT_MIDDLING_FROM) return "middling";
  return "good";
}

/** How each band paints, the same in both views: green, amber and red, as
 *  the old tint's ramp, each with its own pattern and at least 3:1 against
 *  the Map's sky and ground, since a floor's row runs to the tower's edge. */
export const HEAT_VIEW_STYLE: Readonly<Record<HeatBand, MapKindStyle>> = {
  good: { fill: "#2f8f46", pattern: "solid" },
  middling: { fill: "#c27c12", pattern: "diagonal" },
  bad: { fill: "#d23c3c", pattern: "grid" },
};

/** One legend entry: its label and the band it counts. */
export interface HeatLegendEntry {
  readonly label: string;
  readonly band: HeatBand;
  readonly style: MapKindStyle;
}

function entry(label: string, band: HeatBand): HeatLegendEntry {
  return { label, band, style: HEAT_VIEW_STYLE[band] };
}

/** The Traffic legend, clearest first. It counts floors. */
export const TRAFFIC_LEGEND: ReadonlyArray<HeatLegendEntry> = [entry("Clear", "good"), entry("Busy", "middling"), entry("Jammed", "bad")];

/** The Occupancy legend, fullest first. It counts floors with rooms that
 *  take tenants or guests. */
export const OCCUPANCY_LEGEND: ReadonlyArray<HeatLegendEntry> = [entry("Mostly full", "good"), entry("Half full", "middling"), entry("Mostly empty", "bad")];

/** The cell fields the views read. */
export type HeatCellView = Pick<HeatCell, "floor" | "minX" | "maxX" | "severity">;

/** The floors of the last read with their bands, and where each sits on the
 *  map. The rectangles are found again when the layout changes. */
export class HeatMarks {
  private floors: number[] = [];
  private lefts: number[] = [];
  private rights: number[] = [];
  private bands: HeatBand[] = [];
  /** Placed floors: their rectangles and their bands, in the read's order. */
  private rects: MapRect[] = [];
  private placedBands: HeatBand[] = [];
  private readonly count: Record<HeatBand, number> = { good: 0, middling: 0, bad: 0 };

  /** Keep a read's cells (one pass over them). True when what they show
   *  differs from the cells kept before, so a read that found nothing new
   *  needs no repaint. */
  take(cells: ReadonlyArray<HeatCellView>): boolean {
    const n = cells.length;
    let changed = n !== this.floors.length;
    if (changed) {
      this.floors = new Array<number>(n);
      this.lefts = new Array<number>(n);
      this.rights = new Array<number>(n);
      this.bands = new Array<HeatBand>(n);
    }
    for (let i = 0; i < n; i++) {
      const cell = cells[i];
      const band = heatBand(cell.severity);
      if (!changed && this.floors[i] === cell.floor && this.lefts[i] === cell.minX && this.rights[i] === cell.maxX && this.bands[i] === band) continue;
      changed = true;
      this.floors[i] = cell.floor;
      this.lefts[i] = cell.minX;
      this.rights[i] = cell.maxX;
      this.bands[i] = band;
    }
    return changed;
  }

  /** Place the kept floors on `layout` and count them by band. One pass over
   *  the kept floors; a floor off the map is left out. */
  place(layout: MapLayout): void {
    this.rects = [];
    this.placedBands = [];
    this.count.good = 0;
    this.count.middling = 0;
    this.count.bad = 0;
    for (let i = 0; i < this.floors.length; i++) {
      const rect = snappedBlock(layout, this.lefts[i], this.rights[i] - this.lefts[i] + 1, this.floors[i], 1);
      if (!rect) continue;
      this.rects.push(rect);
      this.placedBands.push(this.bands[i]);
      this.count[this.bands[i]]++;
    }
  }

  /** How many placed floors are in `band`. */
  floorsIn(band: HeatBand): number {
    return this.count[band];
  }

  /** How many floors are placed on the map. */
  get size(): number {
    return this.rects.length;
  }

  /** The placed floor's band at `i`. */
  bandAt(i: number): HeatBand {
    return this.placedBands[i];
  }

  /** The placed floor's rectangle at `i`. */
  rectAt(i: number): MapRect {
    return this.rects[i];
  }

  /** Forget the floors (the window closed or another view is shown). */
  clear(): void {
    this.take([]);
    this.rects = [];
    this.placedBands = [];
    this.count.good = 0;
    this.count.middling = 0;
    this.count.bad = 0;
  }
}

/**
 * Paint the placed floors over the tower layer in their bands' styles. A row
 * too small for a pattern paints plain. Returns how many `fillRect` calls it
 * took.
 */
export function paintHeatMarks(ctx: MapPaintContext, marks: HeatMarks, patterns: PatternSource): number {
  let fills = 0;
  let last: string | CanvasPattern | null = null;
  for (let i = 0; i < marks.size; i++) {
    const style = HEAT_VIEW_STYLE[marks.bandAt(i)];
    const rect = marks.rectAt(i);
    const small = rect.w < MIN_PATTERN_SIDE || rect.h < MIN_PATTERN_SIDE;
    const fill = patterns.get(style.fill, small ? "solid" : style.pattern);
    if (fill !== last) {
      ctx.fillStyle = fill;
      last = fill;
    }
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    fills++;
  }
  return fills;
}
