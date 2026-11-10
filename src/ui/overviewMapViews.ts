/**
 * The overview MAP window's views (#343 S6, S8 and S9): the View dropdown,
 * the selected view and what each view adds to the tower layer. The game always builds
 * them (`wireOverviewMap`); a window built without them (a unit-test rig) has
 * no View dropdown and draws the Edit view alone.
 *
 * Cost (SPEC CAP-6, the S6 and S8 hot-path records): the window asks `due`
 * once per open frame. With the Edit view selected it is a boolean.
 *
 * With the Hotel view selected it is the same plus two identity compares and
 * the game hour; only when the hour turns does it read the hotel rooms' states
 * again (one pass over the hotel rooms, `HotelWatch.check`), and the tower
 * layer repaints only when what it shows changed. The hotel rooms and their
 * rectangles are collected again only when the draw list rebuilds or the view
 * is chosen.
 *
 * With Eval or Pricing selected it is the same boolean, two identity compares
 * and the game hour. The engine's tiers (`roomTiers`, one call and one pass
 * over the rooms in the engine) are read at most once a frame, and only when
 * a trigger set the one dirty flag: the view chosen from another view or the
 * window opened on it, a new game hour, a move of the rooms (a build, a
 * removal, a load, an undo or redo), or `towerTouched` (every applied rent
 * command or emergency answer, and a swap). A move of the rooms during a drag
 * that edits the tower waits for the end of the gesture. A switch between
 * Eval and Pricing reads nothing, since one read carries both. Matching the
 * rows to the rooms is one pass over the rooms, on a read or when the rooms
 * or the layout change, and a read that found nothing new repaints nothing.
 * Any room state the steps change (a score the hourly satisfaction pass
 * moved, a move-in, a fire) shows at most one game hour late.
 *
 * With Traffic or Occupancy selected it is the same boolean, the game hour
 * and two revision reads (the tower's, and on Traffic the meal overlay's).
 * The engine's heat cells (`floorHeatmap`, one call) are read only when the
 * view was chosen, the hour turned or a revision moved (the triggers the
 * old main-view tint used; a move of the tower's revision during an editing
 * drag waits for its end) or on `towerTouched`, and placing them is one pass over the floors, on a
 * read that found something new or a new layout. A closed window never asks.
 *
 * Switching views never pauses the game (the original's tinted views do;
 * whether ours should is a check on the PC reference, parity plan item 7).
 */
import type { FacilityKind } from "../engine/types";
import { NO_GESTURE } from "../game/appHistory";
import { NO_ROOM_TIERS, type RoomTiers } from "../simport/roomTiers";
import type { MapLayout } from "../render/overviewMap/geometry";
import { buildHotelMarks, HOTEL_LEGEND, HotelWatch, paintHotelMarks, type HotelRoom } from "../render/overviewMap/hotelView";
import type { MapPaintContext, PatternSource } from "../render/overviewMap/paint";
import { EVAL_LEGEND, paintTierMarks, PRICING_LEGEND, TierMarks, type TierRoom, type TierViewId } from "../render/overviewMap/tierView";
import { DEFAULT_MAP_VIEW, type MapViewId } from "../render/overviewMap/views";
import { HEAT_MODE_OF_VIEW, HeatMarks, OCCUPANCY_LEGEND, paintHeatMarks, TRAFFIC_LEGEND, type HeatCellView, type HeatViewId } from "../render/overviewMap/heatView";
import type { HeatmapMode } from "../engine/sim/constants";
import type { MapDom } from "./overviewMapDom";
import { MapLegend } from "./overviewMapLegend";
import { MapViewPicker } from "./overviewMapPicker";

/** Game minutes in an hour: the Hotel view reads its rooms once per hour. */
export const MINUTES_PER_GAME_HOUR = 60;

/** The game hour a clock reading falls in, or -1 for a reading that is not a
 *  finite number (so a bad clock never reads as a new hour on every frame). */
export function gameHour(minutes: number): number {
  return Number.isFinite(minutes) ? Math.floor(minutes / MINUTES_PER_GAME_HOUR) : -1;
}

/** Whether a view paints the engine's tiers. */
export function isTierView(view: MapViewId): view is TierViewId {
  return view === "eval" || view === "pricing";
}

/** Whether a view paints the engine's heat cells. */
export function isHeatView(view: MapViewId): view is HeatViewId {
  return view === "traffic" || view === "occupancy";
}

/** What the Traffic and Occupancy views read from the engine. */
export interface MapHeatSource {
  /** The engine's heat cells for `mode` (`floorHeatmap`). */
  cells(mode: HeatmapMode): ReadonlyArray<HeatCellView>;
  /** The tower's revision: it moves on every build and removal. */
  towerRevision(): number;
  /** The meal overlay's revision: it moves as diners come and go, which
   *  moves the congestion. */
  mealRevision(): number;
}

/** A room as the views read it. */
export type MapViewRoom = HotelRoom & TierRoom;

export interface MapViewsDeps {
  /** The view's own rooms array (never a copy made per call): its identity
   *  says when the rooms changed, and each entry's `state` is live. */
  rooms(): ReadonlyArray<MapViewRoom>;
  /** The game clock, in minutes since the start. */
  minutes(): number;
  /** A kind's height in floors (the catalog the view binds). */
  floorsOf(kind: FacilityKind): number;
  /** The engine's room tiers (`RoomTierReader`, one per app). Without it
   *  Eval and Pricing paint nothing. */
  readonly tiers?: { read(): RoomTiers } | null;
  /** The view's own id index for `rooms()` (`SimView.tower.getUnit`). */
  roomById(id: number): MapViewRoom | undefined;
  /** The engine's heat cells. Without it Traffic and Occupancy paint
   *  nothing. */
  readonly heat?: MapHeatSource | null;
  /** The undo gesture under way (`AppHistory.gesture`): a build or bulldoze
   *  drag, a shaft extend, or `NO_GESTURE` (0) while none is open. */
  gesture?(): number;
}

export class OverviewMapViews {
  private picker: MapViewPicker | null = null;
  private legends: Partial<Record<MapViewId, MapLegend>> = {};
  /** A view was chosen: the next frame repaints whatever it shows. */
  private chosen = false;
  private readonly watch = new HotelWatch();
  private watchLayout: MapLayout | null = null;
  private watchRooms: unknown = null;
  private hour = -1;
  private readonly tierMarks = new TierMarks();
  /** The one dirty flag of the tier views: the next Eval or Pricing frame
   *  reads the engine's tiers. It starts set. */
  private tierDirty = true;
  /** The rooms moved during this gesture: read once it is no longer the one
   *  under way. `NO_GESTURE` while nothing is held. */
  private tierHeld = NO_GESTURE;
  private tierRooms: unknown = null;
  private tierLayout: MapLayout | null = null;
  private tierHour = -1;
  private readonly heatMarks = new HeatMarks();
  /** What the kept heat cells were read for: the view (null when none is
   *  kept, or `towerTouched` asked for a read), the hour and the revisions. */
  private heatView: HeatViewId | null = null;
  private heatHour = -1;
  private heatTower = Number.NaN;
  private heatMeal = Number.NaN;
  private heatLayout: MapLayout | null = null;

  constructor(private readonly deps: MapViewsDeps) {}

  /** Put the View dropdown under the title bar, and the legends in the body. */
  mount(dom: Pick<MapDom, "root" | "title" | "body">): void {
    const doc = dom.root.ownerDocument;
    this.picker = new MapViewPicker(doc, () => this.viewChosen());
    this.legends = {
      eval: new MapLegend(doc, "eval", EVAL_LEGEND),
      pricing: new MapLegend(doc, "pricing", PRICING_LEGEND),
      hotel: new MapLegend(doc, "hotel", HOTEL_LEGEND),
      traffic: new MapLegend(doc, "traffic", TRAFFIC_LEGEND),
      occupancy: new MapLegend(doc, "occupancy", OCCUPANCY_LEGEND),
    };
    dom.title.after(this.picker.root);
    for (const legend of Object.values(this.legends)) dom.body.append(legend.root);
  }

  /** The selected view. */
  get selected(): MapViewId {
    return this.picker?.selected ?? DEFAULT_MAP_VIEW;
  }

  /** How far down the body the selected view's legend reaches, in CSS
   *  pixels, or 0 for a view with none (Edit). `width` is the body's width
   *  in any unit, so a new width measures again. Constant work on a steady
   *  frame. */
  legendReserve(width: number): number {
    return this.legends[this.selected]?.reach(width) ?? 0;
  }

  /** Something the tier or heat views show may have changed with no move of
   *  the rooms or the revision (an applied rent command or emergency answer,
   *  or a swap, whose new tower can repeat the old one's revision and hour):
   *  the next Eval, Pricing, Traffic or Occupancy frame reads again. The kept
   *  cells stay, so a read that finds them unchanged repaints nothing.
   *  Constant work. */
  towerTouched(): void {
    this.tierDirty = true;
    this.heatView = null;
  }

  /**
   * Called once per open frame, after the draw list's sync. True when the
   * tower layer must repaint for the selected view: it was just chosen, or
   * what the view shows changed. `rebuilt` says the draw list was rebuilt
   * (the window repaints anyway), so the view places its rooms again.
   */
  due(layout: MapLayout, rebuilt: boolean): boolean {
    const chosen = this.chosen;
    this.chosen = false;
    const view = this.selected;
    if (view === "hotel") return this.hotelDue(layout, rebuilt || chosen) || chosen;
    if (isTierView(view)) return this.tierDue(layout) || chosen;
    if (isHeatView(view)) return this.heatDue(layout, view) || chosen;
    return chosen;
  }

  /** Paint what the selected view adds over a freshly painted tower layer.
   *  Returns how many rooms it painted, so the window can draw the shafts
   *  over them again. */
  paintOver(ctx: MapPaintContext, patterns: PatternSource): number {
    const view = this.selected;
    if (view === "hotel") return paintHotelMarks(ctx, this.watch, patterns);
    if (isTierView(view)) return paintTierMarks(ctx, this.tierMarks, view, patterns);
    if (isHeatView(view)) return paintHeatMarks(ctx, this.heatMarks, patterns);
    return 0;
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
    if (changed) this.legends.hotel?.count((i) => HOTEL_LEGEND[i].needs.reduce((sum, need) => sum + this.watch.rooms(need), 0));
    return changed;
  }

  /** Whether the Eval or Pricing view shows something new: a read found
   *  new tiers, or the rows were placed again on new rooms or a new layout. */
  private tierDue(layout: MapLayout): boolean {
    const rooms = this.deps.rooms();
    const hour = gameHour(this.deps.minutes());
    let place = layout !== this.tierLayout;
    if (hour !== this.tierHour) {
      this.tierHour = hour;
      this.tierDirty = true;
    }
    if (rooms !== this.tierRooms) {
      this.tierRooms = rooms;
      place = true;
      // A move of the rooms during an editing drag waits for its end.
      const gesture = this.deps.gesture?.() ?? NO_GESTURE;
      if (gesture !== NO_GESTURE) this.tierHeld = gesture;
      else this.tierDirty = true;
    } else if (this.tierHeld !== NO_GESTURE && this.tierHeld !== (this.deps.gesture?.() ?? NO_GESTURE)) {
      this.tierDirty = true;
    }
    if (this.tierDirty) {
      // Read first: a read that throws leaves the flag set.
      const tiers = this.deps.tiers?.read() ?? NO_ROOM_TIERS;
      this.tierDirty = false;
      this.tierHeld = NO_GESTURE;
      if (this.tierMarks.take(tiers)) place = true;
    }
    if (!place) return false;
    this.tierLayout = layout;
    this.tierMarks.place(layout, rooms, this.deps.roomById, this.deps.floorsOf);
    this.countTiers();
    return true;
  }

  /** Whether the Traffic or Occupancy view shows something new: a read
   *  found new bands, or the floors were placed again on a new layout. */
  private heatDue(layout: MapLayout, view: HeatViewId): boolean {
    const heat = this.deps.heat;
    if (!heat) return false;
    const hour = gameHour(this.deps.minutes());
    const tower = heat.towerRevision();
    // Only the congestion moves with the diners.
    const meal = view === "traffic" ? heat.mealRevision() : 0;
    let place = layout !== this.heatLayout;
    const towerMoved = tower !== this.heatTower;
    const otherMoved = view !== this.heatView || hour !== this.heatHour || meal !== this.heatMeal;
    // A build or bulldoze drag moves the revision on every pointer move: a
    // move of the revision alone waits for the drag's end, as the tiers do.
    const held = towerMoved && !otherMoved && (this.deps.gesture?.() ?? NO_GESTURE) !== NO_GESTURE;
    if ((towerMoved || otherMoved) && !held) {
      // Read first: a read that throws leaves the keys as they were.
      const cells = heat.cells(HEAT_MODE_OF_VIEW[view]);
      this.heatView = view;
      this.heatHour = hour;
      this.heatTower = tower;
      this.heatMeal = meal;
      if (this.heatMarks.take(cells)) place = true;
    }
    if (!place) return false;
    this.heatLayout = layout;
    this.heatMarks.place(layout);
    const legend = view === "traffic" ? TRAFFIC_LEGEND : OCCUPANCY_LEGEND;
    this.legends[view]?.count((i) => this.heatMarks.floorsIn(legend[i].band));
    return true;
  }

  /** Write the tier legends' counts from the placed rooms. */
  private countTiers(): void {
    const marks = this.tierMarks;
    this.legends.eval?.count((i) => marks.evalRooms(EVAL_LEGEND[i].tier));
    this.legends.pricing?.count((i) => marks.rentRooms(PRICING_LEGEND[i].tier));
  }

  private viewChosen(): void {
    this.chosen = true;
    const view = this.selected;
    for (const [id, legend] of Object.entries(this.legends)) legend.setShown(id === view);
    // Another view holds none of a view's rooms.
    if (view !== "hotel") this.releaseHotel();
    if (!isTierView(view)) this.releaseTiers();
    // Traffic and Occupancy read different cells, so a switch reads again.
    this.releaseHeat();
  }

  /** Let go of every view's rooms (the window closed), so an old tower's
   *  rooms are not held. The next `due` collects them again. */
  release(): void {
    this.releaseHotel();
    this.releaseTiers();
    this.releaseHeat();
  }

  /** Drop the heat cells; the next Traffic or Occupancy frame reads them. */
  private releaseHeat(): void {
    this.heatMarks.clear();
    this.heatView = null;
    this.heatLayout = null;
    // No old counts over the next view or tower before its first read.
    this.legends.traffic?.count(() => 0);
    this.legends.occupancy?.count(() => 0);
  }

  private releaseHotel(): void {
    this.watch.clear();
    this.watchLayout = null;
    this.watchRooms = null;
  }

  /** Drop the tiers; the next Eval or Pricing frame reads them again. */
  private releaseTiers(): void {
    this.tierMarks.clear();
    this.tierDirty = true;
    this.tierHeld = NO_GESTURE;
    this.tierRooms = null;
    this.tierLayout = null;
    // No old counts over the next view or tower before its first read.
    this.countTiers();
  }
}
