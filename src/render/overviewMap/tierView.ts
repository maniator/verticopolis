/**
 * The overview MAP window's Eval and Pricing views (#343 S8, #1618, #1619):
 * each room the engine rates paints over the Edit map in its tier's color, as
 * the original's tinted tabs do. The engine decides every tier (`roomTiers`,
 * read through `RoomTierReader`), so nothing here compares a score or a
 * price: it matches the engine's rows to the view's rooms, places them on the
 * map and paints them.
 *
 * One read carries both views, so a switch between Eval and Pricing reads
 * nothing. `TierMarks.take` copies a read's rows (one pass over the rows) and
 * `TierMarks.place` matches them to the rooms and finds their rectangles (one
 * pass over the rooms); both run only on the triggers the window's views
 * controller names, never on a steady frame.
 *
 * Both game modes use the same look (owner, 2026-11-04). Color is not the only
 * cue: the tiers of one view differ in pattern too, a room big enough to carry
 * a pattern gets it, and the legend counts the rooms in words. A room the
 * engine lists with no evaluation (Eval) or with no rent level or No Rate
 * (Pricing) keeps its Edit look.
 */
import type { FacilityKind } from "../../shared/types";
import type { EvalTier, RentTier, RoomTiers } from "../../simport/roomTiers";
import type { UnitView } from "../../simport/view";
import { floorsFor } from "./drawList";
import { snappedBlock, type MapLayout, type MapRect } from "./geometry";
import { MIN_PATTERN_SIDE, type MapPaintContext, type PatternSource } from "./paint";
import type { MapKindStyle } from "./style";

/** The views this file paints. */
export type TierViewId = "eval" | "pricing";

/** How the Eval view paints each evaluation, after the original's three
 *  swatches (Excellent cyan, Good olive yellow, Terrible red). An unrated room
 *  is not painted. */
export const EVAL_VIEW_STYLE: Readonly<Record<EvalTier, MapKindStyle | null>> = {
  unrated: null,
  terrible: { fill: "#b01818", pattern: "grid" },
  good: { fill: "#9a9a1c", pattern: "diagonal" },
  excellent: { fill: "#1aa6b8", pattern: "solid" },
};

/** How the Pricing view paints each rent level, after the original's four
 *  swatches (High red, Average olive, Low green, Very Low cyan). A room with
 *  no rent level, or one taken off the market (No Rate), is not painted. */
export const RENT_VIEW_STYLE: Readonly<Record<RentTier, MapKindStyle | null>> = {
  unpriced: null,
  noRate: null,
  veryLow: { fill: "#1aa6b8", pattern: "checker" },
  low: { fill: "#2a8a3a", pattern: "diagonal" },
  average: { fill: "#7a7a24", pattern: "solid" },
  high: { fill: "#b01818", pattern: "grid" },
};

/** One legend entry: its label and the tier it counts. */
export interface TierLegendEntry<T extends string> {
  readonly label: string;
  readonly tier: T;
  readonly style: MapKindStyle;
}

function entry<T extends string>(label: string, tier: T, styles: Readonly<Record<T, MapKindStyle | null>>): TierLegendEntry<T> {
  const style = styles[tier];
  if (!style) throw new Error(`the ${tier} tier has no style`);
  return { label, tier, style };
}

/** The Eval legend, best first, as in the original. */
export const EVAL_LEGEND: ReadonlyArray<TierLegendEntry<EvalTier>> = [
  entry("Excellent", "excellent", EVAL_VIEW_STYLE),
  entry("Good", "good", EVAL_VIEW_STYLE),
  entry("Terrible", "terrible", EVAL_VIEW_STYLE),
];

/** The Pricing legend, highest first, as in the original. */
export const PRICING_LEGEND: ReadonlyArray<TierLegendEntry<RentTier>> = [
  entry("High", "high", RENT_VIEW_STYLE),
  entry("Average", "average", RENT_VIEW_STYLE),
  entry("Low", "low", RENT_VIEW_STYLE),
  entry("Very Low", "veryLow", RENT_VIEW_STYLE),
];

/** The room fields the tier views read. */
export type TierRoom = Pick<UnitView, "id" | "kind" | "floor" | "x" | "width">;

/**
 * The rows of the last read, and where each matched room sits on the map.
 * The rows are the engine's; the rectangles are found again whenever the
 * rooms or the layout change, so a room removed since the read drops out
 * and a moved layout moves the marks.
 */
export class TierMarks {
  private ids: number[] = [];
  private floors: number[] = [];
  private xs: number[] = [];
  private evals: EvalTier[] = [];
  private rents: RentTier[] = [];
  /** Matched rows: their rectangles and their row numbers, in room order. */
  private rects: MapRect[] = [];
  private rows: number[] = [];
  private readonly evalCount = new Map<EvalTier, number>();
  private readonly rentCount = new Map<RentTier, number>();

  /** Keep a read's rows (one pass over them). The read itself may be let go.
   *  True when the rows differ from the ones kept before, so a read that
   *  found nothing new needs no repaint. */
  take(tiers: RoomTiers): boolean {
    const n = tiers.size;
    let changed = n !== this.ids.length;
    if (changed) {
      this.ids = new Array<number>(n);
      this.floors = new Array<number>(n);
      this.xs = new Array<number>(n);
      this.evals = new Array<EvalTier>(n);
      this.rents = new Array<RentTier>(n);
    }
    for (let i = 0; i < n; i++) {
      const id = tiers.id(i);
      const floor = tiers.floor(i);
      const x = tiers.x(i);
      const evalTier = tiers.evalTier(i);
      const rentTier = tiers.rentTier(i);
      if (!changed && this.ids[i] === id && this.floors[i] === floor && this.xs[i] === x && this.evals[i] === evalTier && this.rents[i] === rentTier) continue;
      changed = true;
      this.ids[i] = id;
      this.floors[i] = floor;
      this.xs[i] = x;
      this.evals[i] = evalTier;
      this.rents[i] = rentTier;
    }
    return changed;
  }

  /**
   * Match the kept rows to `rooms` and place each matched room on `layout`.
   * The rows are a subsequence of the rooms, in their order, so the walk goes
   * in lockstep; a row whose id the walk does not find before the rooms run
   * out (a revision number can repeat, #1296) stops it there, and that row
   * and the rest match through `byId`, the view's own id index for these
   * rooms (`SimView.tower.getUnit`). A row no room has, or
   * whose room now stands somewhere else (a kept read placed on rooms that
   * moved since), is dropped and keeps its Edit look until the next read.
   * One pass over the rooms at most.
   */
  place(
    layout: MapLayout,
    rooms: ReadonlyArray<TierRoom>,
    byId: (id: number) => TierRoom | undefined,
    floorsOf: (kind: FacilityKind) => number,
  ): void {
    const heights = new Map<FacilityKind, number>();
    const source = { floorsOf };
    this.rects = [];
    this.rows = [];
    this.evalCount.clear();
    this.rentCount.clear();
    let next = 0;
    let inStep = true;
    for (let row = 0; row < this.ids.length; row++) {
      const id = this.ids[row];
      let room: TierRoom | undefined;
      if (inStep) {
        while (next < rooms.length && rooms[next].id !== id) next++;
        if (next < rooms.length) room = rooms[next++];
        else inStep = false;
      }
      if (!inStep) room = byId(id);
      if (!room || room.floor !== this.floors[row] || room.x !== this.xs[row]) continue;
      const rect = snappedBlock(layout, room.x, room.width, room.floor, floorsFor(source, room.kind, heights));
      if (!rect) continue;
      this.rects.push(rect);
      this.rows.push(row);
      this.evalCount.set(this.evals[row], (this.evalCount.get(this.evals[row]) ?? 0) + 1);
      this.rentCount.set(this.rents[row], (this.rentCount.get(this.rents[row]) ?? 0) + 1);
    }
  }

  /** How many placed rooms show `tier` in the Eval view. */
  evalRooms(tier: EvalTier): number {
    return this.evalCount.get(tier) ?? 0;
  }

  /** How many placed rooms show `tier` in the Pricing view. */
  rentRooms(tier: RentTier): number {
    return this.rentCount.get(tier) ?? 0;
  }

  /** How many rows the last read kept. */
  get rowCount(): number {
    return this.ids.length;
  }

  /** How many rooms are placed on the map. */
  get size(): number {
    return this.rects.length;
  }

  /** The style the placed room at `i` paints with in `view`, or null. */
  styleAt(i: number, view: TierViewId): MapKindStyle | null {
    const row = this.rows[i];
    return view === "eval" ? EVAL_VIEW_STYLE[this.evals[row]] : RENT_VIEW_STYLE[this.rents[row]];
  }

  /** The placed room's rectangle at `i`. */
  rectAt(i: number): MapRect {
    return this.rects[i];
  }

  /** Forget the rows and the rooms (the window closed or another view is
   *  shown). */
  clear(): void {
    this.ids = [];
    this.floors = [];
    this.xs = [];
    this.evals = [];
    this.rents = [];
    this.rects = [];
    this.rows = [];
    this.evalCount.clear();
    this.rentCount.clear();
  }
}

/**
 * Paint the placed rooms over the tower layer in `view`'s styles. A room too
 * small for a pattern paints plain, and a room the view does not rate keeps
 * its Edit look. Returns how many `fillRect` calls it took.
 */
export function paintTierMarks(ctx: MapPaintContext, marks: TierMarks, view: TierViewId, patterns: PatternSource): number {
  let fills = 0;
  let last: string | CanvasPattern | null = null;
  // Each style's two fills, asked of the pattern source once per repaint.
  const resolved = new Map<MapKindStyle, readonly [string | CanvasPattern, string | CanvasPattern]>();
  for (let i = 0; i < marks.size; i++) {
    const style = marks.styleAt(i, view);
    if (!style) continue;
    let pair = resolved.get(style);
    if (!pair) {
      pair = [patterns.get(style.fill, style.pattern), patterns.get(style.fill, "solid")];
      resolved.set(style, pair);
    }
    const rect = marks.rectAt(i);
    const small = rect.w < MIN_PATTERN_SIDE || rect.h < MIN_PATTERN_SIDE;
    const fill = small ? pair[1] : pair[0];
    if (fill !== last) {
      ctx.fillStyle = fill;
      last = fill;
    }
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    fills++;
  }
  return fills;
}
