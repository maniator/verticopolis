/**
 * Puts the overview MAP window (#343) into the game: builds it in `#stage`,
 * feeds it the view, the bound world and the camera, moves the camera through
 * the renderer's own clamp (`applyView`, which keeps the zoom), and follows the
 * phone breakpoint. The window lives beside the app in a weak map, so the app
 * class carries no field for it.
 *
 * Players do not see it yet: until the last slice ships (SPEC, Constraints),
 * the window is built only in a dev serve or a tooling build, and only when the
 * page's address carries `?map`. In a player build (neither dev nor tooling)
 * the gate is always false, so no player page ever builds the window.
 */
import type { GameApp } from "../main";
import type { FacilityKind } from "../engine/types";
import { findViewKind } from "../presentation/viewKinds";
import { FLOOR, TILE } from "../render/scale";
import type { MapTheme } from "../render/overviewMap/style";
import { browserStorage } from "../ui/overviewMapPrefs";
import { OverviewMapWindow, type MutableMapCamera, type OverviewMapSource } from "../ui/overviewMapWindow";
import { viewWorld, viewWorldBound } from "../presentation/viewWorld";

/** The address flag that shows the window before it ships. */
export const MAP_PREVIEW_FLAG = "map";

const windows = new WeakMap<GameApp, OverviewMapWindow>();

/** Whether this page shows the window: a dev serve or a tooling build whose
 *  address carries the preview flag, with any value or none. */
export function mapPreviewOn(search: string): boolean {
  if (!(import.meta.env.DEV || __TOOLING_BUILD__)) return false;
  return new URLSearchParams(search).has(MAP_PREVIEW_FLAG);
}

/** A kind's height in floors from the catalog the view binds (CAP-7). */
function floorsOf(kind: FacilityKind): number {
  return findViewKind(kind)?.floors ?? 1;
}

/** Build the window for `app` when the page shows it, once (a second call
 *  does nothing). Call after the engine exists. */
export function wireOverviewMap(app: GameApp): void {
  if (windows.has(app) || !mapPreviewOn(window.location.search)) return;
  const stage = document.getElementById("stage");
  if (!stage) return;
  // One source object, refilled each frame, so reading the tower allocates
  // nothing. The world is the one the view and the camera clamp are bound to.
  const source: { -readonly [K in keyof OverviewMapSource]: OverviewMapSource[K] } = {
    view: app.reader,
    world: { lotWidth: 1, minFloor: 0, maxFloor: 0 },
    theme: "classic",
  };
  const win = new OverviewMapWindow({
    stage,
    source: () => {
      // Nothing to draw until the scene has bound the world.
      if (!viewWorldBound()) return null;
      source.view = app.reader;
      source.world = viewWorld();
      source.theme = app.reader.header.mode satisfies MapTheme;
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
  });
  app.mobileMq.addEventListener("change", () => win.layoutChanged());
  windows.set(app, win);
  // The browser perf test reaches the window here (`e2e/overviewMapPerf.spec.ts`), in
  // a dev serve or a tooling build only, like the `window.game` handle. The
  // check stays when the preview flag goes.
  if (import.meta.env.DEV || __TOOLING_BUILD__) (window as unknown as { overviewMap?: OverviewMapWindow }).overviewMap = win;
}

/** Bring the window up to date for this frame. A page without it, or a closed
 *  window, returns at once. */
export function tickOverviewMap(app: GameApp): void {
  windows.get(app)?.frame();
}
