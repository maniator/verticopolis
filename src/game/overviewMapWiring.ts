/**
 * Puts the overview MAP window (#343) into the game: builds it in `#stage`,
 * feeds it the view, the bound world and the camera, moves the camera through
 * the renderer's own clamp (`applyView`, which keeps the zoom), and follows the
 * phone breakpoint. The window lives beside the app in a weak map, so the app
 * class carries no field for it. Every page builds it (SPEC, CAP-1): it opens
 * by default on desktop and starts closed behind the Map pill on a phone.
 * The window always carries its View dropdown (S6 to S9). The Eval and
 * Pricing views read the engine's room tiers through one reader built on the
 * app's port, which stays the same engine object for the page life, and the
 * Traffic and Occupancy views read its heat cells through the renderer's sim.
 * The player drags the window by its title bar, and the spot they choose is
 * kept per layout class (`ui/overviewMapSpot.ts`).
 */
import type { GameApp } from "../main";
import type { FacilityKind } from "../shared/types";
import { findViewKind } from "../presentation/viewKinds";
import { NO_ROOM_TIERS, RoomTierReader, type RoomTiers } from "../simport/roomTiers";
import { FLOOR, TILE } from "../render/scale";
import { browserStorage, type MapLayoutClass } from "../ui/overviewMapPrefs";
import { rememberMapSpot, storedMapSpot } from "../ui/overviewMapSpot";
import { MovableWindow } from "../ui/movableWindow";
import { MOVABLE_TITLE } from "./movableWindows";
import { OverviewMapWindow, type MutableMapCamera, type OverviewMapSource } from "../ui/overviewMapWindow";
import { OverviewMapViews, type MapHeatSource } from "../ui/overviewMapViews";
import { viewWorld, viewWorldBound } from "../presentation/viewWorld";
import { engineTrapped, noteEngineThrow } from "./engineFault";
import { isEngineStopped } from "./interactionState";

const windows = new WeakMap<GameApp, OverviewMapWindow>();
const mapViews = new WeakMap<GameApp, OverviewMapViews>();

/** A kind's height in floors from the catalog the view binds (CAP-7). */
function floorsOf(kind: FacilityKind): number {
  return findViewKind(kind)?.floors ?? 1;
}

/** The tier read with the frame loop's engine guards, since the window can
 *  also read from a click (opening it, picking a view): no read once the
 *  engine stopped or trapped, and a trap the read hits is reported as one. */
function guardedTiers(reader: RoomTierReader): { read(): RoomTiers } {
  return {
    read: () => {
      if (engineTrapped() || isEngineStopped()) return NO_ROOM_TIERS;
      try {
        return reader.read();
      } catch (error) {
        if (noteEngineThrow(error)) return NO_ROOM_TIERS;
        throw error;
      }
    },
  };
}

/** The heat cells with the same engine guards as the tier read: no read once
 *  the engine stopped or trapped (the views then show no floors), and a trap
 *  the read hits is reported as one. */
function guardedHeat(app: GameApp): MapHeatSource {
  return {
    cells: (mode) => {
      if (engineTrapped() || isEngineStopped()) return [];
      try {
        return app.engine.sim.floorHeatmap(mode);
      } catch (error) {
        if (noteEngineThrow(error)) return [];
        throw error;
      }
    },
    towerRevision: () => app.reader.header.revision,
    mealRevision: () => app.reader.header.mealOverlayRevision,
  };
}

/** Build the window for `app`, once (a second call does nothing). Call after
 *  the engine exists. */
export function wireOverviewMap(app: GameApp): void {
  if (windows.has(app)) return;
  const stage = document.getElementById("stage");
  if (!stage) return;
  // One source object, refilled each frame, so reading the tower allocates
  // nothing. The world is the one the view and the camera clamp are bound to.
  const source: { -readonly [K in keyof OverviewMapSource]: OverviewMapSource[K] } = {
    view: app.reader,
    world: { lotWidth: 1, minFloor: 0, maxFloor: 0 },
  };
  const storage = browserStorage();
  const views = new OverviewMapViews({
    rooms: () => app.reader.rooms,
    minutes: () => app.reader.header.minutes,
    floorsOf,
    roomById: (id) => app.reader.tower.getUnit(id),
    tiers: guardedTiers(new RoomTierReader(app.enginePort)),
    heat: guardedHeat(app),
    gesture: () => app.undoGesture(),
  });
  mapViews.set(app, views);
  const win = new OverviewMapWindow({
    stage,
    source: () => {
      // Nothing to draw until the scene has bound the world.
      if (!viewWorldBound()) return null;
      source.view = app.reader;
      source.world = viewWorld();
      return source;
    },
    readCamera: (out: MutableMapCamera) => {
      // The camera's one small object per call is the renderer's own read.
      const view = app.engine.viewState();
      out.posX = view.tile * TILE;
      out.posY = -view.floor * FLOOR;
      out.zoom = view.zoom ?? 1;
      out.viewWidth = app.engine.viewWidth;
      out.viewHeight = app.engine.viewHeight;
    },
    moveCamera: (center) => app.engine.applyView({ tile: center.tile, floor: center.floor }),
    floorsOf,
    isPhone: () => app.mobileMq.matches,
    storage,
    views,
  });
  // The window moves by its title bar and remembers the spot per layout class.
  const layoutClass = (): MapLayoutClass => (app.mobileMq.matches ? "phone" : "desktop");
  const mover = new MovableWindow({
    win: win.root,
    title: MOVABLE_TITLE.map,
    within: stage,
    placed: (spot) => rememberMapSpot(storage, layoutClass(), spot),
  });
  const restoreSpot = () => {
    mover.reset();
    const spot = storedMapSpot(storage, layoutClass());
    if (spot) mover.moveTo(spot);
  };
  restoreSpot();
  app.mobileMq.addEventListener("change", () => {
    win.layoutChanged();
    restoreSpot();
  });
  windows.set(app, win);
  // The browser perf test reaches the window here (`e2e/overviewMapPerf.spec.ts`), in
  // a dev serve or a tooling build only, like the `window.game` handle.
  if (import.meta.env.DEV || __TOOLING_BUILD__) (window as unknown as { overviewMap?: OverviewMapWindow }).overviewMap = win;
}

/** Bring the window up to date for this frame. A page without it, or a closed
 *  window, returns at once. */
export function tickOverviewMap(app: GameApp): void {
  windows.get(app)?.frame();
}

/** Tell the Map's Eval and Pricing views that a room's score, price or
 *  presence may have changed with no move of the rooms: an applied rent
 *  command or emergency answer, or a swap. Constant work; the views read the
 *  tiers again on their next open frame. */
export function touchOverviewMap(app: GameApp): void {
  mapViews.get(app)?.towerTouched();
}
