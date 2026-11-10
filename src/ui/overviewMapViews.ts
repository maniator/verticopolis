/**
 * The overview MAP window's views (#343 S6): the tab row, the selected view
 * and what each view adds to the tower layer. The game always builds them
 * (`wireOverviewMap`); a window built without them (a unit-test rig) has no
 * tab row and draws the Edit view alone. Eval and Pricing show the Edit map
 * under a "coming soon" note until S8 gives them their painters.
 *
 * Cost (SPEC CAP-6, the S6 hot-path record): the window asks `due` once per
 * open frame. With the Edit view selected, or Eval or Pricing, it is a
 * boolean.
 * With the Hotel view selected it is the same plus two identity compares and
 * the game hour; only when the hour turns does it read the hotel rooms' states
 * again (one pass over the hotel rooms, `HotelWatch.check`), and the tower
 * layer repaints only when what it shows changed. The hotel rooms and their
 * rectangles are collected again only when the draw list rebuilds or the view
 * is chosen. A closed window never asks.
 *
 * Switching views never pauses the game (the original's tinted views do;
 * whether ours should is a check on the PC reference, parity plan item 7).
 */
import type { FacilityKind } from "../engine/types";
import type { MapLayout } from "../render/overviewMap/geometry";
import { buildHotelMarks, HotelWatch, paintHotelMarks, type HotelRoom } from "../render/overviewMap/hotelView";
import type { MapPaintContext, PatternSource } from "../render/overviewMap/paint";
import { DEFAULT_MAP_VIEW, mapViewEntry, type MapViewId } from "../render/overviewMap/views";
import type { MapDom } from "./overviewMapDom";
import { HotelLegend, MapViewNote } from "./overviewMapLegend";
import { MapTabs } from "./overviewMapTabs";

/** Game minutes in an hour: the Hotel view reads its rooms once per hour. */
export const MINUTES_PER_GAME_HOUR = 60;

/** The game hour a clock reading falls in, or -1 for a reading that is not a
 *  finite number (so a bad clock never reads as a new hour on every frame). */
export function gameHour(minutes: number): number {
  return Number.isFinite(minutes) ? Math.floor(minutes / MINUTES_PER_GAME_HOUR) : -1;
}

export interface MapViewsDeps {
  /** The view's own rooms array (never a copy made per call): its identity
   *  says when the rooms changed, and each entry's `state` is live. */
  rooms(): ReadonlyArray<HotelRoom>;
  /** The game clock, in minutes since the start. */
  minutes(): number;
  /** A kind's height in floors (the catalog the view binds). */
  floorsOf(kind: FacilityKind): number;
}

export class OverviewMapViews {
  private tabs: MapTabs | null = null;
  private legend: HotelLegend | null = null;
  private note: MapViewNote | null = null;
  /** A view was chosen: the next frame repaints whatever it shows. */
  private chosen = false;
  private readonly watch = new HotelWatch();
  private watchLayout: MapLayout | null = null;
  private watchRooms: unknown = null;
  private hour = -1;

  constructor(private readonly deps: MapViewsDeps) {}

  /** Put the tab row under the title bar, and the legend and the note in
   *  the body. */
  mount(dom: Pick<MapDom, "root" | "title" | "body">): void {
    const doc = dom.root.ownerDocument;
    this.tabs = new MapTabs(doc, dom.body, () => this.viewChosen());
    this.legend = new HotelLegend(doc);
    this.note = new MapViewNote(doc);
    dom.title.after(this.tabs.list);
    dom.body.append(this.legend.root, this.note.root);
  }

  /** The selected view. */
  get selected(): MapViewId {
    return this.tabs?.selected ?? DEFAULT_MAP_VIEW;
  }

  /**
   * Called once per open frame, after the draw list's sync. True when the
   * tower layer must repaint for the selected view: it was just chosen, or the
   * Hotel view's rooms changed. `rebuilt` says the draw list was rebuilt (the
   * window repaints anyway), so the Hotel view collects its rooms again.
   */
  due(layout: MapLayout, rebuilt: boolean): boolean {
    const chosen = this.chosen;
    this.chosen = false;
    if (this.selected !== "hotel") return chosen;
    return this.hotelDue(layout, rebuilt || chosen) || chosen;
  }

  /** Paint what the selected view adds over a freshly painted tower layer.
   *  Returns how many rooms it painted, so the window can draw the shafts
   *  over them again. */
  paintOver(ctx: MapPaintContext, patterns: PatternSource): number {
    return this.selected === "hotel" ? paintHotelMarks(ctx, this.watch, patterns) : 0;
  }

  /** Whether the Hotel view shows something new: its rooms were collected
   *  again, or the game hour turned and a room's need changed. */
  private hotelDue(layout: MapLayout, fresh: boolean): boolean {
    const rooms = this.deps.rooms();
    const hour = gameHour(this.deps.minutes());
    if (fresh || layout !== this.watchLayout || rooms !== this.watchRooms) {
      this.watchLayout = layout;
      this.watchRooms = rooms;
      this.watch.watch(buildHotelMarks(layout, rooms, this.deps.floorsOf));
    } else if (hour === this.hour) {
      return false;
    }
    this.hour = hour;
    const changed = this.watch.check();
    if (changed) this.legend?.count(this.watch);
    return changed;
  }

  private viewChosen(): void {
    this.chosen = true;
    const hotel = this.selected === "hotel";
    this.legend?.setShown(hotel);
    this.note?.show(mapViewEntry(this.selected)?.comingSoon);
    // Another view holds no hotel rooms.
    if (!hotel) this.release();
  }

  /** Let go of the watched hotel rooms (the window closed, or another view is
   *  shown), so an old tower's rooms are not held. The next `due` collects
   *  them again. */
  release(): void {
    this.watch.clear();
    this.watchLayout = null;
    this.watchRooms = null;
  }
}
