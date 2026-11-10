/**
 * Puts the overview MAP window (#343) into the game: builds it in `#stage`,
 * feeds it the view, the bound world and the camera, moves the camera through
 * the renderer's own clamp (`applyView`, which keeps the zoom), and follows the
 * phone breakpoint. The window lives beside the app in a weak map, so the app
 * class carries no field for it. Every page builds it (SPEC, CAP-1): it opens
 * by default on desktop and starts closed behind the Map pill on a phone.
 * The window always carries its view tabs (S6 to S9). Eval and Pricing show
 * a "coming soon" note until S8 (SPEC, Constraints).
 */
import type { GameApp } from "../main";
import type { FacilityKind } from "../engine/types";
import { findViewKind } from "../presentation/viewKinds";
import { FLOOR, TILE } from "../render/scale";
import { browserStorage } from "../ui/overviewMapPrefs";
import { OverviewMapWindow, type MutableMapCamera, type OverviewMapSource } from "../ui/overviewMapWindow";
import { OverviewMapViews } from "../ui/overviewMapViews";
import { viewWorld, viewWorldBound } from "../presentation/viewWorld";

const windows = new WeakMap<GameApp, OverviewMapWindow>();

/** A kind's height in floors from the catalog the view binds (CAP-7). */
function floorsOf(kind: FacilityKind): number {
  return findViewKind(kind)?.floors ?? 1;
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
    storage: browserStorage(),
    views: new OverviewMapViews({ rooms: () => app.reader.rooms, minutes: () => app.reader.header.minutes, floorsOf }),
  });
  app.mobileMq.addEventListener("change", () => win.layoutChanged());
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
