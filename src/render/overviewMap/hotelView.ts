/**
 * The overview MAP window's Hotel view (#343 S6, #1617): hotel rooms that need
 * housekeeping paint in red over the Edit map, as the original's Hotel tab
 * marks its dirty rooms. Everything else stays as the Edit view draws it.
 *
 * A room's state moves without a revision change, so the window cannot key
 * this on the draw list. Instead the hotel rooms and their rectangles are
 * collected once per rebuild (`buildHotelMarks`, one pass over the rooms, the
 * per-command tier), and `HotelWatch.check` reads their states again once per
 * game hour (one pass over the hotel rooms, the per-hour tier). Nothing here
 * runs on a frame where neither happened.
 *
 * Both game modes tell dirty from infested by lightness and by pattern, in the
 * Map's one look (owner, 2026-11-04). Color is not the only cue: each red is
 * dark enough to stand 3:1 against the hotel colors it covers, a room big
 * enough to carry a pattern gets a hatch, and the legend counts the rooms in
 * words.
 */
import type { FacilityKind, UnitState } from "../../shared/types";
import type { UnitView } from "../../simport/view";
import { floorsFor } from "./drawList";
import { snappedBlock, type MapLayout, type MapRect } from "./geometry";
import { MIN_PATTERN_SIDE, type MapPaintContext, type PatternSource } from "./paint";
import { KIND_GROUP, type MapKindStyle } from "./style";

/** Why a hotel room shows in the Hotel view. */
export type HousekeepingNeed = "dirty" | "infested";

/** The room states the Hotel view marks, and what each one means there.
 *  `dirty` waits for housekeeping; `infested` was left dirty too long. */
const NEED_OF_STATE: Readonly<Partial<Record<UnitState, HousekeepingNeed>>> = {
  dirty: "dirty",
  infested: "infested",
};

/** What a room's state asks of housekeeping, or null for a room that is fine. */
export function housekeepingNeed(state: UnitState): HousekeepingNeed | null {
  return Object.prototype.hasOwnProperty.call(NEED_OF_STATE, state) ? (NEED_OF_STATE[state] ?? null) : null;
}

/** Whether a kind is a hotel room (the style table's `hotels` group). */
export function isHotelKind(kind: FacilityKind): boolean {
  return Object.prototype.hasOwnProperty.call(KIND_GROUP, kind) && KIND_GROUP[kind] === "hotels";
}

/** How the Hotel view paints each need: two reds a step apart in lightness,
 *  each with its own pattern. */
export const HOTEL_VIEW_STYLE: Readonly<Record<HousekeepingNeed, MapKindStyle>> = {
  dirty: { fill: "#a01010", pattern: "grid" },
  infested: { fill: "#4a0606", pattern: "checker" },
};

/** The Hotel view's legend entries, in order, one per need. Each lists the
 *  needs it counts. */
export const HOTEL_LEGEND: ReadonlyArray<{ readonly label: string; readonly style: MapKindStyle; readonly needs: ReadonlyArray<HousekeepingNeed> }> = [
  { label: "Dirty", style: HOTEL_VIEW_STYLE.dirty, needs: ["dirty"] },
  { label: "Infested", style: HOTEL_VIEW_STYLE.infested, needs: ["infested"] },
];

/** The room fields the Hotel view reads. `state` is read live each hour. */
export type HotelRoom = Pick<UnitView, "kind" | "floor" | "x" | "width" | "state">;

/** A hotel room and where it sits on the map. */
export interface HotelRoomMark {
  readonly room: Pick<HotelRoom, "state">;
  readonly rect: MapRect;
}

/** Every hotel room that can be drawn on `layout`, with its rectangle, in the
 *  rooms' order. One pass over the rooms; call it when the draw list rebuilds. */
export function buildHotelMarks(layout: MapLayout, rooms: ReadonlyArray<HotelRoom>, floorsOf: (kind: FacilityKind) => number): HotelRoomMark[] {
  const heights = new Map<FacilityKind, number>();
  const source = { floorsOf };
  const marks: HotelRoomMark[] = [];
  for (const room of rooms) {
    if (!isHotelKind(room.kind)) continue;
    const rect = snappedBlock(layout, room.x, room.width, room.floor, floorsFor(source, room.kind, heights));
    if (rect) marks.push({ room, rect });
  }
  return marks;
}

/**
 * The hotel rooms the Hotel view watches, with the state each had when last
 * read. `check` reads them all again and says whether any changed, so the
 * window repaints only then; the counts feed the legend.
 */
export class HotelWatch {
  private marks: ReadonlyArray<HotelRoomMark> = [];
  private seen: Array<HousekeepingNeed | null> = [];
  private pending = true;
  private readonly count: Record<HousekeepingNeed, number> = { dirty: 0, infested: 0 };

  /** Watch a new set of rooms. The next `check` reads them and answers true. */
  watch(marks: ReadonlyArray<HotelRoomMark>): void {
    this.marks = marks;
    this.seen = [];
    this.pending = true;
  }

  /** Read every watched room's state again. True when what the view shows
   *  changed since the last call (or the rooms are new). One pass over the
   *  hotel rooms. */
  check(): boolean {
    // New rooms answer true even when there are none, so the legend's count
    // still drops to 0.
    let changed = this.pending;
    this.pending = false;
    if (this.seen.length !== this.marks.length) this.seen = new Array<HousekeepingNeed | null>(this.marks.length).fill(null);
    this.count.dirty = 0;
    this.count.infested = 0;
    for (let i = 0; i < this.marks.length; i++) {
      const need = housekeepingNeed(this.marks[i].room.state);
      if (need) this.count[need]++;
      if (this.seen[i] === need) continue;
      this.seen[i] = need;
      changed = true;
    }
    return changed;
  }

  /** How many rooms showed each need at the last `check`. */
  rooms(need: HousekeepingNeed): number {
    return this.count[need];
  }

  /** How many rooms are watched. */
  get size(): number {
    return this.marks.length;
  }

  /** The watched room at `i`, in the rooms' order. */
  markAt(i: number): HotelRoomMark {
    return this.marks[i];
  }

  /** What the room at `i` showed at the last `check`: its need, or null. */
  needAt(i: number): HousekeepingNeed | null {
    return this.seen[i] ?? null;
  }

  /** Forget the rooms (the window closed or the view changed). */
  clear(): void {
    this.watch([]);
  }
}

/**
 * Paint the rooms the watch last found needing housekeeping over the tower
 * layer, in the view's style. A room too small for a pattern paints
 * plain. Returns how many `fillRect` calls it took.
 */
export function paintHotelMarks(ctx: MapPaintContext, watch: HotelWatch, patterns: PatternSource): number {
  let fills = 0;
  let last: string | CanvasPattern | null = null;
  for (let i = 0; i < watch.size; i++) {
    const need = watch.needAt(i);
    if (!need) continue;
    const mark = watch.markAt(i);
    const style = HOTEL_VIEW_STYLE[need];
    const small = mark.rect.w < MIN_PATTERN_SIDE || mark.rect.h < MIN_PATTERN_SIDE;
    const fill = patterns.get(style.fill, small ? "solid" : style.pattern);
    if (fill !== last) {
      ctx.fillStyle = fill;
      last = fill;
    }
    ctx.fillRect(mark.rect.x, mark.rect.y, mark.rect.w, mark.rect.h);
    fills++;
  }
  return fills;
}
